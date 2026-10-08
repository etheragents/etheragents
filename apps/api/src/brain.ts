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
import { drawLogo, logoPrompt, logosEnabled } from "./logo.ts";
import { systemPrompt, userPrompt, type Limits } from "./prompt.ts";
import { clamp, fmtEth, fmtTokens, now, toEth, toTokens, toWei } from "./util.ts";

const SYMBOL_RE = /^[A-Z0-9]{3,8}$/;

export class Brain {
  private running = new Set<number>();
  usage: { calls: number; inputTokens: number; outputTokens: number; errors: number; images?: number; selfFundedCalls?: number; selfFundedEth?: number } = { calls: 0, inputTokens: 0, outputTokens: 0, errors: 0, images: 0, selfFundedCalls: 0, selfFundedEth: 0 };

  /** Count a model call and, when the agent can pay for it from its own brain budget, charge it there. */
  private account(a: AgentRec, inputTokens: number, outputTokens: number) {
    this.usage.calls++;
    this.usage.inputTokens += inputTokens;
    this.usage.outputTokens += outputTokens;
    const b = config.brain;
    const eth = (inputTokens * b.priceInUsd + outputTokens * b.priceOutUsd) / 1e6 / b.ethUsd;
    if (this.ledger.chargeBrain(a, eth)) {
      this.usage.selfFundedCalls = (this.usage.selfFundedCalls ?? 0) + 1;
      this.usage.selfFundedEth = (this.usage.selfFundedEth ?? 0) + eth;
    }
  }

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
    // coins launched before logos existed (or whose logo failed) get one, one at a time
    if (logosEnabled()) setInterval(() => this.backfillLogo(), 45_000).unref();
  }

  private logoTries = new Map<string, number>();
  private async backfillLogo() {
    const store = this.ledger.store;
    const c = store.coins
      .values()
      .find((x) => !store.logos.get(x.id) && (this.logoTries.get(x.id) ?? 0) < 2 && store.agents.get(x.agent));
    if (!c) return;
    this.logoTries.set(c.id, (this.logoTries.get(c.id) ?? 0) + 1);
    await this.makeLogo(store.agents.get(c.agent)!, c, c.about);
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
    // self-funded agents (brain budget from their coin's fees) think more often
    const boost = this.ledger.brainLeft(a) >= config.brain.boostMinEth ? config.brain.boostFactor : 1;
    a.nextActAt = now() + Math.round(config.brain.agentIntervalSeconds * jitter * boost);
    this.ledger.store.agents.touch(a);
    try {
      await this.market.refreshBalance(a).catch(() => {});
      const ctx = this.context(a);
      let decision: any;
      if (config.llm.provider === "mock") {
        decision = mockDecide(this.ledger, a, ctx.coins, ctx.feed, ctx.mentions, ctx.limits, ctx.taken);
      } else {
        const sys = systemPrompt(a, ctx.limits);
        const user = userPrompt(this.ledger, a, ctx.coins, ctx.feed, ctx.mentions, ctx.taken);
        const ask = async (u: string) => {
          const res = await complete(sys, u, 1600);
          this.account(a, res.inputTokens, res.outputTokens);
          return parseJsonObject(res.text);
        };
        try {
          decision = await ask(user);
        } catch (e) {
          // models occasionally answer with prose or run out of room: ask once more, firmly and briefly
          if (!/JSON/.test((e as Error).message)) throw e;
          decision = await ask(`${user}\n\nIMPORTANT: your last reply was not a valid JSON object. Reply with ONLY the JSON object, no other text. Keep the thought to one sentence and use at most 3 actions.`);
        }
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
          if (/too small to sell/.test(msg)) {
            this.ledger.log(a, "skip", `kept a dust position: ${msg.replace(/ position too small to sell/, "")}`);
            continue;
          }
          a.lastError = msg;
          this.ledger.log(a, "error", `${act?.type ?? "action"} failed: ${msg}`);
        }
      }
      // maintenance: creator fees
      if (a.launched > 0 && Math.random() < 0.15) await this.market.claimFees(a).catch(() => {});
    } catch (e) {
      const msg = (e as Error).message?.slice(0, 200) ?? String(e);
      if (/ 429:|rate.?limit|overloaded| 50[23]:|No provider|model_not_available/i.test(msg)) {
        // the AI gateway is busy: not the agent's fault, so wait a little and try again quietly
        this.ledger.log(a, "skip", "the AI is busy right now; thinking again in a minute");
        a.nextActAt = now() + 45 + Math.floor(Math.random() * 45);
        return;
      }
      this.usage.errors++;
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
    const launchWindow =
      !ownCoin && // every agent launches exactly one coin in its life
      t - a.lastLaunchAt > config.brain.launchCooldownSeconds &&
      (config.brain.maxLaunchesPerHour <= 0 || launchesLastHour < config.brain.maxLaunchesPerHour);
    const funded = max >= config.brain.minTradeEth;
    const sponsoredLaunch = launchWindow && !funded && this.canSponsor();
    const canLaunch = launchWindow && (funded || sponsoredLaunch);
    const c = this.market.curve();
    return { ownCoin: ownCoin ? `$${ownCoin.symbol}` : null, balanceEth: balance, minTradeEth: config.brain.minTradeEth, maxTradeEth: max, siteCostEth: config.brain.siteCostEth, canLaunch, sponsoredLaunch, launchFeeEth: 0, startMcapEth: c.startMcapEth, gradMcapEth: c.gradMcapEth };
  }

  /** Can the platform pay for one more launch today? (budget left, gas not too expensive, no coin creation fee) */
  canSponsor() {
    const b = config.brain;
    if (!b.sponsorLaunches || this.market.coinFeeEth() > 0) return false;
    if (this.market.mode === "chain" && (this.market.gasGwei() <= 0 || this.market.gasGwei() > b.sponsorMaxGwei)) return false;
    const m = this.ledger.store.meta;
    const day = Math.floor(now() / 86400);
    const spent = m.sponsorDay === day ? (m.sponsorSpentEth ?? 0) : 0;
    const estimate = (1_100_000 * Math.max(this.market.gasGwei(), 0)) / 1e9; // ~1.04M gas per launch
    return spent + estimate <= b.sponsorMaxEthPerDay;
  }

  private recordSponsor(gasEth: number) {
    const m = this.ledger.store.meta;
    const day = Math.floor(now() / 86400);
    if (m.sponsorDay !== day) {
      m.sponsorDay = day;
      m.sponsorSpentEth = 0;
    }
    m.sponsorSpentEth = (m.sponsorSpentEth ?? 0) + gasEth;
    m.sponsoredLaunches = (m.sponsoredLaunches ?? 0) + 1;
    this.ledger.store.bumpMeta();
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

  /** Draw a coin's logo from its agent's description (background; failures leave the generated image). */
  async makeLogo(a: AgentRec, c: CoinRec, idea: string) {
    const L = this.ledger;
    try {
      L.log(a, "act", `drawing the $${c.symbol} logo…`);
      const prompt = logoPrompt(c.name, c.symbol, idea);
      const { data, model } = await drawLogo(prompt);
      L.setLogo(c, data, prompt, model);
      this.usage.images = (this.usage.images ?? 0) + 1;
      const paid = L.chargeBrain(a, config.brain.logoCostEth);
      L.log(a, "act", `revealed the $${c.symbol} logo${paid ? ` (${fmtEth(config.brain.logoCostEth)} ETH from its brain budget)` : ""}`);
    } catch (e) {
      L.log(a, "error", `logo for $${c.symbol} failed: ${errText(e)}`);
    }
  }

  /** Write (or rewrite) a coin's website. One extra model call. The first version is on the platform; rewrites are
   *  paid from the agent's own brain budget (the brain share of its coin's fees). */
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
      const ask = async (extra: string) => {
        const res = await complete(siteSystemPrompt(a), siteUserPrompt(c, brief, prev ? content : null) + extra, 3000);
        this.usage.calls++;
        this.usage.inputTokens += res.inputTokens;
        this.usage.outputTokens += res.outputTokens;
        return parseJsonObject(res.text);
      };
      try {
        raw = await ask("");
      } catch (e) {
        if (!/JSON/.test((e as Error).message)) throw e;
        raw = await ask("\n\nIMPORTANT: reply with ONLY the JSON object, no other text. Keep every section short.");
      }
      note = String(raw?.note ?? "");
    }
    const cost = prev && L.chargeBrain(a, config.brain.siteCostEth) ? config.brain.siteCostEth : 0;
    const site = L.saveSite(a, c, sanitizeSite(raw, c), say || this.text(note, 200), cost);
    this.remember(a, `${site.version === 1 ? "built" : "updated"} the $${c.symbol} website (v${site.version})`);
    L.log(a, "act", `published the $${c.symbol} website, version ${site.version}${cost ? ` (${fmtEth(cost)} ETH from its brain budget)` : ""}`);
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
        const sponsored = !!lim.sponsoredLaunch;
        const eth = sponsored ? 0 : clamp(Number(act.eth) || lim.minTradeEth, lim.minTradeEth, lim.maxTradeEth);
        this.ledger.log(a, "act", sponsored ? `launching $${symbol} (${name}), launch paid by Etheragents…` : `launching $${symbol} (${name}) with a ${fmtEth(eth)} ETH first buy…`);
        const { coin, tx, gasEth } = await this.market.launch(a, { name, symbol, about: this.text(act.about, 140), thesis: this.text(act.thesis, 240), ethWei: toWei(eth) });
        if (sponsored) this.recordSponsor(gasEth ?? 0);
        a.lastLaunchAt = now();
        a.spentInWindowEth += eth;
        const say = this.text(act.say, 200) || `launched $${symbol}`;
        L.addPost({ agent: a, kind: "launch", text: say, coin, tx });
        this.remember(a, `launched $${symbol} (${name})`);
        this.ledger.log(a, "act", `launched $${symbol}`);
        // every coin gets a website, written by its agent right after launch (advanced, repaid from its fees)
        const c = L.store.coins.get(coin.address.toLowerCase()) ?? coin;
        // and a logo, drawn in the background by an image model from the agent's own description
        if (logosEnabled()) void this.makeLogo(a, c, this.text(act.logo, 300) || this.text(act.about, 140));
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
          const left = L.brainLeft(a);
          if (left < config.brain.siteCostEth)
            throw new Error(`your brain budget has ${fmtEth(left)} ETH left; a new website version costs ${fmtEth(config.brain.siteCostEth)} ETH`);
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


