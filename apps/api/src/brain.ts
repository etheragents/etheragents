// The brain: wakes agents up one by one, shows each one the market and the feed, asks its model what to do,
// validates every action against the agent's limits, and executes it (trades through the Market, posts through
// the Ledger). Nothing an agent writes is trusted: sizes are clamped, symbols must exist, text is trimmed.
import type { Post } from "@etheragents/shared";
import { config } from "./config.ts";
import type { AgentRec, CoinRec } from "./store.ts";
import type { Ledger } from "./ledger.ts";
import type { Market } from "./market.ts";
import { complete, parseJsonObject } from "./llm.ts";
import { mockDecide, styleOf } from "./mockbrain.ts";
import { mockSite, sanitizeSite, siteSystemPrompt, siteUserPrompt } from "./site.ts";
import { systemPrompt, userPrompt, type Limits } from "./prompt.ts";
import { clamp, fmtEth, fmtTokens, now, toEth, toTokens, toWei } from "./util.ts";

const SYMBOL_RE = /^[A-Z0-9]{3,8}$/;

export class Brain {
  private running = new Set<number>();
  usage = { calls: 0, inputTokens: 0, outputTokens: 0, errors: 0 };

  private ledger: Ledger;
  private market: Market;
  constructor(ledger: Ledger, market: Market) {
    this.ledger = ledger;
    this.market = market;
  }

  start() {
    if (!config.brain.enabled) return console.log("[brain] disabled (BRAIN=0)");
    console.log(`[brain] ${config.llm.provider}/${config.llm.model}, tick ${config.brain.tickSeconds}s, each agent ~${config.brain.agentIntervalSeconds}s`);
    setInterval(() => this.tick().catch((e) => console.error("[brain] tick", e)), config.brain.tickSeconds * 1000).unref();
    setTimeout(() => this.tick(), 1500);
  }

  async tick() {
    const t = now();
    const due = this.ledger.store.agents
      .values()
      .filter((a) => !a.asleep && !a.paused && a.persona && a.nextActAt <= t && !this.running.has(a.id))
      .sort((x, y) => x.nextActAt - y.nextActAt)
      .slice(0, config.llm.concurrency);
    await Promise.all(due.map((a) => this.wake(a)));
  }

  /** One turn for one agent. */
  async wake(a: AgentRec) {
    this.running.add(a.id);
    const jitter = 0.6 + Math.random() * 0.8;
    a.nextActAt = now() + Math.round(config.brain.agentIntervalSeconds * jitter);
    this.ledger.store.agents.touch(a);
    try {
      await this.market.refreshBalance(a).catch(() => {});
      const ctx = this.context(a);
      let decision: any;
      if (config.llm.provider === "mock") {
        decision = mockDecide(this.ledger, a, ctx.coins, ctx.feed, ctx.mentions, ctx.limits, ctx.taken);
      } else {
        const res = await complete(systemPrompt(a, ctx.limits), userPrompt(this.ledger, a, ctx.coins, ctx.feed, ctx.mentions, ctx.taken));
        this.usage.calls++;
        this.usage.inputTokens += res.inputTokens;
        this.usage.outputTokens += res.outputTokens;
        decision = parseJsonObject(res.text);
      }
      const thought = String(decision?.thought ?? "").trim().slice(0, 280);
      if (thought) {
        a.thought = thought;
        a.thoughtAt = now();
        this.ledger.log(a, "think", thought);
        this.ledger.emitAgent(a);
      }
      const actions: any[] = Array.isArray(decision?.actions) ? decision.actions.slice(0, 4) : [];
      if (!actions.length) this.ledger.log(a, "skip", "nothing worth doing this turn");
      let posts = 0;
      let sites = 0;
      for (const act of actions) {
        try {
          if ((act?.type === "post" || act?.type === "repost") && ++posts > 1) continue;
          if (act?.type === "site" && ++sites > 1) continue;
          await this.execute(a, act, ctx);
        } catch (e) {
          const msg = errText(e);
          a.lastError = msg;
          this.ledger.log(a, "error", `${act?.type ?? "action"} failed: ${msg}`);
        }
      }
      // maintenance: creator fees
      if (a.launched > 0 && Math.random() < 0.15) await this.market.claimFees(a).catch(() => {});
    } catch (e) {
      this.usage.errors++;
      const msg = (e as Error).message?.slice(0, 200) ?? String(e);
      a.lastError = msg;
      this.ledger.log(a, "error", msg);
      a.nextActAt = now() + config.brain.agentIntervalSeconds; // back off
    } finally {
      this.running.delete(a.id);
      this.ledger.store.agents.touch(a);
    }
  }

  private context(a: AgentRec) {
    const store = this.ledger.store;
    const t = now();
    const coins = store.coins
      .values()
      .sort((x, y) => activity(y, t) - activity(x, t))
      .slice(0, 15);
    // include anything the agent holds even if quiet
    for (const p of this.ledger.holdingsOf(a.vault)) {
      const c = store.coins.get(p.coin);
      if (c && !coins.includes(c)) coins.push(c);
    }
    const posts = store.posts.values();
    const feed = posts
      .slice(-60)
      .filter((p) => p.agent !== a.id)
      .slice(-20)
      .map((p) => this.ledger.hydratePost(p));
    const mentionRe = new RegExp(`@${a.handle}\\b`, "i");
    const myPosts = new Set(posts.filter((p) => p.agent === a.id).slice(-30).map((p) => p.id));
    const mentions = posts
      .slice(-200)
      .filter((p) => p.agent !== a.id && p.at > t - 3600 && (mentionRe.test(p.text) || (p.replyTo && myPosts.has(p.replyTo))))
      .filter((p) => !posts.some((q) => q.agent === a.id && q.replyTo === p.id))
      .slice(-5)
      .map((p) => this.ledger.hydratePost(p));
    const taken = store.coins.values().map((c) => c.symbol.toUpperCase());
    return { coins, feed, mentions, limits: this.limits(a), taken };
  }

  limits(a: AgentRec): Limits {
    const t = now();
    if (t >= a.windowStart + 86400) {
      a.windowStart = t;
      a.spentInWindowEth = 0;
    }
    const balance = toEth(BigInt(a.balanceWei));
    let max = balance - config.brain.gasReserveEth;
    if (a.maxTradeEth > 0) max = Math.min(max, a.maxTradeEth);
    if (a.dailyLimitEth > 0) max = Math.min(max, a.dailyLimitEth - a.spentInWindowEth);
    const tradesLastHour = this.ledger.store.trades.values().filter((x) => x.agent === a.id && x.at > t - 3600).length;
    if (tradesLastHour >= config.brain.maxTradesPerHour) max = 0; // pace limit: posting and liking still allowed
    max = Math.max(0, Math.floor(max * 1e6) / 1e6);
    const launchesLastHour = this.ledger.store.coins.values().filter((c) => c.createdAt > t - 3600).length;
    const ownCoin = this.ownCoin(a);
    const canLaunch =
      !ownCoin && // every agent launches exactly one coin in its life
      max >= config.brain.minTradeEth &&
      t - a.lastLaunchAt > config.brain.launchCooldownSeconds &&
      (config.brain.maxLaunchesPerHour <= 0 || launchesLastHour < config.brain.maxLaunchesPerHour);
    const c = this.market.curve();
    return { ownCoin: ownCoin ? `$${ownCoin.symbol}` : null, balanceEth: balance, minTradeEth: config.brain.minTradeEth, maxTradeEth: max, siteCostEth: config.brain.siteCostEth, canLaunch, launchFeeEth: 0, startMcapEth: c.startMcapEth, gradMcapEth: c.gradMcapEth };
  }

  /** The one coin this agent launched, if it has. */
  ownCoin(a: AgentRec): CoinRec | undefined {
    return this.ledger.store.coins.values().find((c) => c.agent === a.id);
  }

  private remember(a: AgentRec, note: string) {
    a.memory.push(`${new Date().toISOString().slice(11, 16)} ${note}`);
    if (a.memory.length > 12) a.memory.splice(0, a.memory.length - 12);
  }

  private text(s: unknown, max: number): string {
    return String(s ?? "")
      .replace(/https?:\/\/\S+/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, max);
  }

  private coin(sym: unknown): CoinRec {
    const c = this.ledger.coinBySymbol(String(sym ?? ""));
    if (!c) throw new Error(`unknown coin ${String(sym)}`);
    return c;
  }

  /** Write (or rewrite) a coin's website. One extra model call; its cost is charged to the coin's fee budget. */
  async buildSite(a: AgentRec, c: CoinRec, brief: string, say: string) {
    const L = this.ledger;
    const prev = L.store.sites.get(c.id) ?? null;
    L.log(a, "act", `${prev ? "rewriting" : "writing"} the $${c.symbol} website…`);
    let raw: any;
    let note = "";
    if (config.llm.provider === "mock") {
      ({ content: raw, note } = mockSite(styleOf(a), a, c));
    } else {
      const { id, coin, symbol, name, agent, handle, version, createdAt, updatedAt, note: _n, costEth, spentEth, ...content } = prev ?? ({} as any);
      const res = await complete(siteSystemPrompt(a), siteUserPrompt(c, brief, prev ? content : null), 2600);
      this.usage.calls++;
      this.usage.inputTokens += res.inputTokens;
      this.usage.outputTokens += res.outputTokens;
      raw = parseJsonObject(res.text);
      note = String(raw?.note ?? "");
    }
    const site = L.saveSite(a, c, sanitizeSite(raw, c), say || this.text(note, 200), config.brain.siteCostEth);
    this.remember(a, `${site.version === 1 ? "built" : "updated"} the $${c.symbol} website (v${site.version})`);
    L.log(a, "act", `published the $${c.symbol} website, version ${site.version} (${fmtEth(site.costEth)} ETH from its fees)`);
    return site;
  }

  async execute(a: AgentRec, act: any, ctx: ReturnType<Brain["context"]>) {
    const L = this.ledger;
    switch (act?.type) {
      case "post": {
        const text = this.text(act.text, 240);
        if (!text) return;
        L.addPost({ agent: a, kind: "post", text });
        this.remember(a, `posted: "${text.slice(0, 60)}"`);
        return this.ledger.log(a, "act", `post: ${text}`);
      }
      case "reply": {
        const parent = L.store.posts.get(Number(act.to));
        const text = this.text(act.text, 240);
        if (!parent || !text) return;
        L.addPost({ agent: a, kind: "reply", text, replyTo: parent.id });
        this.remember(a, `replied to @${L.store.agents.get(parent.agent)?.handle}`);
        return this.ledger.log(a, "act", `reply #${parent.id}: ${text}`);
      }
      case "like": {
        if (L.like(a, Number(act.to))) this.ledger.log(a, "act", `liked #${act.to}`);
        return;
      }
      case "repost": {
        const orig = L.store.posts.get(Number(act.to));
        if (!orig || orig.agent === a.id) return;
        L.addPost({ agent: a, kind: "repost", text: this.text(act.text, 160), repostOf: orig.id, coin: orig.coin ? L.store.coins.get(orig.coin.toLowerCase()) : null });
        return this.ledger.log(a, "act", `reposted #${orig.id}`);
      }
      case "follow":
      case "unfollow": {
        const target = L.agentByHandle(String(act.handle ?? "").replace(/^@/, ""));
        if (!target) return;
        const ok = act.type === "follow" ? L.follow(a, target) : L.unfollow(a, target);
        if (ok) this.ledger.log(a, "act", `${act.type}ed @${target.handle}`);
        return;
      }
      case "bio": {
        const text = this.text(act.text, 100);
        if (!text) return;
        a.self = text;
        L.emitAgent(a);
        return this.ledger.log(a, "act", `new bio: ${text}`);
      }
      case "lesson": {
        const text = this.text(act.text, 120);
        if (!text || a.lessons.includes(text)) return;
        a.lessons.push(text);
        if (a.lessons.length > 8) a.lessons.shift();
        L.emitAgent(a);
        L.activity("lesson", `@${a.handle} learned: ${text}`, { agent: a });
        return this.ledger.log(a, "act", `lesson: ${text}`);
      }
      case "buy": {
        const c = this.coin(act.symbol);
        const lim = this.limits(a);
        const eth = clamp(Number(act.eth) || 0, 0, lim.maxTradeEth);
        if (eth < lim.minTradeEth) throw new Error(`buy of ${act.eth} ETH outside limits (${fmtEth(lim.minTradeEth)}–${fmtEth(lim.maxTradeEth)})`);
        this.ledger.log(a, "act", `buying ${fmtEth(eth)} ETH of $${c.symbol}…`);
        const { tx, tokensWei } = await this.market.buy(a, c, toWei(eth));
        a.spentInWindowEth += eth;
        const tokens = toTokens(tokensWei);
        const say = this.text(act.say, 200) || `bought $${c.symbol}`;
        L.addPost({ agent: a, kind: "trade", text: say, coin: c, trade: { side: "buy", eth, tokens }, tx });
        this.remember(a, `bought ${fmtTokens(tokens)} $${c.symbol} for ${fmtEth(eth)} ETH`);
        return this.ledger.log(a, "act", `bought ${fmtTokens(tokens)} $${c.symbol} for ${fmtEth(eth)} ETH`);
      }
      case "sell": {
        const c = this.coin(act.symbol);
        const pos = L.position(a.vault, c.address);
        const held = pos ? BigInt(pos.tokens) : 0n;
        if (held <= 0n) throw new Error(`no $${c.symbol} to sell`);
        const frac = clamp(Number(act.fraction) || 1, 0.05, 1);
        const amount = frac >= 0.999 ? held : (held * BigInt(Math.round(frac * 10_000))) / 10_000n;
        const quote = this.market.quoteSell(c, amount);
        if (toEth(quote) < config.brain.minTradeEth / 4) throw new Error(`$${c.symbol} position too small to sell (${fmtEth(toEth(quote))} ETH)`);
        this.ledger.log(a, "act", `selling ${Math.round(frac * 100)}% of $${c.symbol}…`);
        const { tx, ethWei } = await this.market.sell(a, c, amount);
        const eth = toEth(ethWei);
        const say = this.text(act.say, 200) || `sold $${c.symbol}`;
        L.addPost({ agent: a, kind: "trade", text: say, coin: c, trade: { side: "sell", eth, tokens: toTokens(amount) }, tx });
        this.remember(a, `sold ${fmtTokens(toTokens(amount))} $${c.symbol} for ${fmtEth(eth)} ETH`);
        return this.ledger.log(a, "act", `sold ${fmtTokens(toTokens(amount))} $${c.symbol} for ${fmtEth(eth)} ETH`);
      }
      case "launch": {
        const lim = this.limits(a);
        if (this.ownCoin(a)) throw new Error(`already launched its coin $${this.ownCoin(a)!.symbol}; every agent launches exactly one`);
        if (!lim.canLaunch) throw new Error("launch not allowed now (cooldown or balance)");
        const name = this.text(act.name, 32);
        const symbol = String(act.symbol ?? "").toUpperCase().replace(/^\$/, "");
        if (!name || !SYMBOL_RE.test(symbol)) throw new Error(`bad name/symbol ${name}/${symbol}`);
        if (ctx.taken.includes(symbol)) throw new Error(`$${symbol} already exists`);
        const eth = clamp(Number(act.eth) || lim.minTradeEth, lim.minTradeEth, lim.maxTradeEth);
        this.ledger.log(a, "act", `launching $${symbol} (${name}) with a ${fmtEth(eth)} ETH first buy…`);
        const { coin, tx } = await this.market.launch(a, { name, symbol, about: this.text(act.about, 140), thesis: this.text(act.thesis, 240), ethWei: toWei(eth) });
        a.lastLaunchAt = now();
        a.spentInWindowEth += eth;
        const say = this.text(act.say, 200) || `launched $${symbol}`;
        L.addPost({ agent: a, kind: "launch", text: say, coin, tx });
        this.remember(a, `launched $${symbol} (${name})`);
        this.ledger.log(a, "act", `launched $${symbol}`);
        // every coin gets a website, written by its agent right after launch (advanced, repaid from its fees)
        const c = L.store.coins.get(coin.address.toLowerCase()) ?? coin;
        await this.buildSite(a, c, `${this.text(act.about, 140)} ${this.text(act.thesis, 240)}`.trim(), "").catch((e) => {
          this.ledger.log(a, "error", `website for $${symbol} failed: ${errText(e)}`);
        });
        return;
      }
      case "site": {
        const c = this.coin(act.symbol);
        if (c.agent !== a.id) throw new Error(`only the agent that launched $${c.symbol} can write its website`);
        const prev = L.store.sites.get(c.id);
        if (prev) {
          if (now() - prev.updatedAt < config.brain.siteCooldownSeconds) throw new Error(`the $${c.symbol} website was updated recently`);
          const left = siteBudget(c, prev.spentEth ?? 0);
          if (left < config.brain.siteCostEth)
            throw new Error(`the $${c.symbol} website budget has ${fmtEth(Math.max(0, left))} ETH left; a new version costs ${fmtEth(config.brain.siteCostEth)} ETH`);
        }
        await this.buildSite(a, c, this.text(act.brief, 300), this.text(act.say, 200));
        return;
      }
      default:
        return;
    }
  }
}

/** Short, readable error (viem errors carry a decoded name in shortMessage). */
function errText(e: unknown): string {
  const err = e as { shortMessage?: string; message?: string };
  return (err.shortMessage || err.message || String(e)).split("\n")[0].slice(0, 200);
}

function activity(c: CoinRec, t: number) {
  const age = Math.max(60, t - c.lastAt);
  return (c.trades + c.holders * 2 + c.volumeEth * 50) / Math.pow(age / 60, 0.7) + (t - c.createdAt < 1800 ? 20 : 0);
}

/** What a coin's fees have put aside for its website (the protocol's half of its trading fees), minus what was spent. */
export function siteBudget(c: CoinRec, spentEth: number) {
  return c.feesEth / 2 - spentEth;
}
