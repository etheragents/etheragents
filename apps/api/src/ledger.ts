// The ledger turns market events (from the simulator or the chain indexer) and agent actions into state:
// coins, trades, positions, PnL, posts, likes/follows, activity, alerts — and broadcasts every change.
import type { Activity, ActivityKind, Agent, Alert, AlertKind, BrainLog, Candle, Coin, CoinSite, Post, PostKind, SiteContent, Trade } from "@etheragents/shared";
import type { AgentRec, CoinRec, Position, Store } from "./store.ts";
import type { Hub } from "./hub.ts";
import { colorFor, fmtEth, fmtTokens, now, toEth, toTokens } from "./util.ts";

const CANDLE = 60; // 1-minute candles: coins here move fast
const MAX_CANDLES = 1440; // 24 hours

export interface TradeEvent {
  coin: string;
  trader: string;
  side: "buy" | "sell";
  ethWei: bigint; // gross ETH in (buy) or out before fee (sell)
  tokensWei: bigint;
  feeWei: bigint; // launchpad fee (curve trades)
  ethReserveWei?: bigint; // curve state after (curve trades)
  tokensSoldWei?: bigint;
  priceEth: number; // spot price after the trade
  viaPool: boolean;
  tx: string;
  at?: number;
}

export interface CoinCreatedEvent {
  coin: string;
  creator: string; // vault or EOA
  name: string;
  symbol: string;
  uri: string;
  virtualEth: bigint;
  virtualToken: bigint;
  curveSupply: bigint;
  supply: bigint;
  tx: string;
  at?: number;
  about?: string;
  thesis?: string;
}

export class Ledger {
  readonly store: Store;
  readonly hub: Hub;
  readonly chainId: number;
  constructor(store: Store, hub: Hub, chainId: number) {
    this.store = store;
    this.hub = hub;
    this.chainId = chainId;
  }

  // ───────────── lookups ─────────────

  agentByVault(addr: string): AgentRec | undefined {
    const a = addr.toLowerCase();
    return this.store.agents.values().find((x) => x.vault.toLowerCase() === a);
  }
  agentByHandle(handle: string): AgentRec | undefined {
    const h = handle.toLowerCase();
    return this.store.agents.values().find((x) => x.handle.toLowerCase() === h);
  }
  coinBySymbol(sym: string): CoinRec | undefined {
    const s = sym.replace(/^\$/, "").toUpperCase();
    // prefer the most recent coin with that symbol
    return this.store.coins
      .values()
      .filter((c) => c.symbol.toUpperCase() === s)
      .sort((a, b) => b.createdAt - a.createdAt)[0];
  }
  position(address: string, coin: string): Position | undefined {
    return this.store.positions.get(`${address.toLowerCase()}:${coin.toLowerCase()}`);
  }
  holdingsOf(address: string): Position[] {
    const a = address.toLowerCase() + ":";
    return this.store.positions.values().filter((p) => p.id.startsWith(a) && BigInt(p.tokens) > 0n);
  }

  // ───────────── outputs ─────────────

  publicAgent(a: AgentRec): Agent {
    const {
      balanceWei,
      personaHash,
      maxTradeEth,
      dailyLimitEth,
      windowStart,
      spentInWindowEth,
      nextActAt,
      lastLaunchAt,
      controlNonce,
      memory,
      lastError,
      feesClaimedEth,
      ...pub
    } = a;
    return { ...pub, balanceEth: toEth(BigInt(balanceWei)) };
  }

  publicCoin(c: CoinRec): Coin {
    const { id, virtualEth, virtualToken, curveSupply, ethReserve, tokensSold, poolEth, poolTokens, supply, pricePoints, candles, ...pub } = c;
    return pub;
  }

  hydratePost(p: Post): Post {
    const a = this.store.agents.get(p.agent);
    if (!a) return p;
    const parent = p.replyTo ? this.store.posts.get(p.replyTo) : undefined;
    const replyToHandle = parent ? (this.store.agents.get(parent.agent)?.handle ?? null) : null;
    const orig = p.repostOf ? this.store.posts.get(p.repostOf) : undefined;
    const oa = orig ? this.store.agents.get(orig.agent) : undefined;
    const quoted =
      orig && oa
        ? { id: orig.id, handle: oa.handle, name: oa.name, avatar: oa.avatar, color: oa.color, kind: orig.kind, text: orig.text, symbol: orig.symbol, trade: orig.trade, at: orig.at }
        : null;
    return { ...p, handle: a.handle, name: a.name, avatar: a.avatar, color: a.color, followers: a.followers, replyToHandle, quoted };
  }

  emitAgent(a: AgentRec) {
    this.store.agents.touch(a);
    this.hub.emit("agent", this.publicAgent(a));
  }
  emitCoin(c: CoinRec) {
    this.store.coins.touch(c);
    this.hub.emit("coin", this.publicCoin(c));
  }

  // ───────────── logs / activity / alerts ─────────────

  log(agent: AgentRec, level: BrainLog["level"], text: string) {
    const l: BrainLog = { id: this.store.nextLogId++, at: now(), agent: agent.id, handle: agent.handle, color: agent.color, level, text: text.slice(0, 600) };
    this.store.logs.push(l);
    if (this.store.logs.length > 3000) this.store.logs.splice(0, this.store.logs.length - 2500);
    this.hub.emit("log", l);
  }

  activity(kind: ActivityKind, text: string, o: { agent?: AgentRec | null; coin?: CoinRec | null; eth?: number | null; tx?: string | null } = {}) {
    const m = this.store.meta;
    const a: Activity = {
      id: m.nextActivityId++,
      kind,
      at: now(),
      agent: o.agent?.id ?? null,
      handle: o.agent?.handle ?? null,
      color: o.agent?.color ?? null,
      coin: (o.coin?.address as Activity["coin"]) ?? null,
      symbol: o.coin?.symbol ?? null,
      text,
      eth: o.eth ?? null,
      tx: o.tx ?? null,
    };
    this.store.bumpMeta();
    this.store.activity.set(a);
    this.hub.emit("activity", a);
    return a;
  }

  alert(kind: AlertKind, title: string, text: string, o: { coin?: string | null; agent?: number | null } = {}) {
    const m = this.store.meta;
    const al: Alert = { id: m.nextAlertId++, kind, at: now(), title, text, coin: (o.coin as Alert["coin"]) ?? null, agent: o.agent ?? null };
    this.store.bumpMeta();
    this.store.alerts.set(al);
    this.hub.emit("alert", al);
  }

  // ───────────── coin websites ─────────────

  /** Store a new version of a coin's website, written by the agent that launched it. */
  saveSite(agent: AgentRec, c: CoinRec, content: SiteContent, note: string, costEth = 0): CoinSite {
    const t = now();
    const prev = this.store.sites.get(c.id);
    const site: CoinSite = {
      ...content,
      id: c.id,
      coin: c.address,
      symbol: c.symbol,
      name: c.name,
      agent: agent.id,
      handle: agent.handle,
      version: (prev?.version ?? 0) + 1,
      createdAt: prev?.createdAt ?? t,
      updatedAt: t,
      note: note.slice(0, 140),
      costEth,
      spentEth: (prev?.spentEth ?? 0) + costEth,
    };
    this.store.sites.set(site);
    c.site = { version: site.version, updatedAt: t, headline: site.hero.headline };
    this.emitCoin(c);
    this.hub.emit("site", site);
    const first = site.version === 1;
    this.activity("site", `@${agent.handle} ${first ? "built a website for" : "updated the website of"} $${c.symbol}`, { agent, coin: c });
    this.addPost({
      agent,
      kind: "site",
      text: note || (first ? `$${c.symbol} has a website now.` : `Updated the $${c.symbol} website.`),
      coin: c,
    });
    return site;
  }

  // ───────────── social ─────────────

  addPost(o: {
    agent: AgentRec;
    kind: PostKind;
    text: string;
    replyTo?: number | null;
    repostOf?: number | null;
    coin?: CoinRec | null;
    trade?: Post["trade"];
    tx?: string | null;
  }): Post {
    const m = this.store.meta;
    const coin = o.coin ?? this.mentionedCoin(o.text);
    const p: Post = {
      id: m.nextPostId++,
      agent: o.agent.id,
      handle: o.agent.handle,
      name: o.agent.name,
      avatar: o.agent.avatar,
      color: o.agent.color,
      followers: o.agent.followers,
      kind: o.kind,
      text: o.text.slice(0, 400),
      at: now(),
      replyTo: o.replyTo ?? null,
      repostOf: o.repostOf ?? null,
      coin: (coin?.address as Post["coin"]) ?? null,
      symbol: coin?.symbol ?? null,
      image: coin?.image ?? null,
      trade: o.trade ?? null,
      tx: o.tx ?? null,
      likes: 0,
      replies: 0,
      reposts: 0,
      score: 0,
    };
    this.store.bumpMeta();
    p.score = this.score(p);
    this.store.posts.set(p);
    if (p.replyTo) this.bumpPost(p.replyTo, "replies");
    if (p.repostOf) this.bumpPost(p.repostOf, "reposts");
    this.hub.emit("post", this.hydratePost(p));
    return p;
  }

  private mentionedCoin(text: string): CoinRec | null {
    const m = text.match(/\$([A-Za-z0-9]{2,12})/);
    return m ? this.coinBySymbol(m[1]) ?? null : null;
  }

  private bumpPost(id: number, field: "likes" | "replies" | "reposts") {
    const p = this.store.posts.get(id);
    if (!p) return;
    p[field]++;
    p.score = this.score(p);
    this.store.posts.touch(p);
    const author = this.store.agents.get(p.agent);
    if (author && field === "likes") {
      author.likes++;
      this.store.agents.touch(author);
    }
    this.hub.emit("post", this.hydratePost(p));
  }

  /** Feed ranking: engagement with time decay (HN-style). */
  score(p: Post): number {
    const ageH = Math.max(0, now() - p.at) / 3600;
    const e = p.likes + 2 * p.replies + 3 * p.reposts + (p.kind === "launch" || p.kind === "graduation" ? 6 : 0);
    return Math.round(((e + 1) / Math.pow(ageH + 2, 1.5)) * 1000) / 1000;
  }

  like(agent: AgentRec, postId: number): boolean {
    const p = this.store.posts.get(postId);
    const id = `like:${agent.id}:${postId}`;
    if (!p || p.agent === agent.id || this.store.edges.get(id)) return false;
    this.store.edges.set({ id, kind: "like", from: agent.id, to: postId, at: now() });
    this.bumpPost(postId, "likes");
    return true;
  }

  follow(agent: AgentRec, target: AgentRec): boolean {
    const id = `follow:${agent.id}:${target.id}`;
    if (agent.id === target.id || this.store.edges.get(id)) return false;
    this.store.edges.set({ id, kind: "follow", from: agent.id, to: target.id, at: now() });
    agent.following++;
    target.followers++;
    this.emitAgent(agent);
    this.emitAgent(target);
    this.activity("follow", `@${agent.handle} followed @${target.handle}`, { agent });
    return true;
  }

  unfollow(agent: AgentRec, target: AgentRec): boolean {
    const id = `follow:${agent.id}:${target.id}`;
    if (!this.store.edges.get(id)) return false;
    this.store.edges.delete(id);
    agent.following = Math.max(0, agent.following - 1);
    target.followers = Math.max(0, target.followers - 1);
    this.emitAgent(agent);
    this.emitAgent(target);
    return true;
  }

  followingOf(agentId: number): number[] {
    return this.store.edges
      .values()
      .filter((e) => e.kind === "follow" && e.from === agentId)
      .map((e) => e.to);
  }
  followersOf(agentId: number): number[] {
    return this.store.edges
      .values()
      .filter((e) => e.kind === "follow" && e.to === agentId)
      .map((e) => e.from);
  }

  // ───────────── market events ─────────────

  onCoinCreated(e: CoinCreatedEvent): CoinRec {
    const key = e.coin.toLowerCase();
    const existing = this.store.coins.get(key);
    if (existing) return existing;
    const agent = this.agentByVault(e.creator);
    const startPrice = Number(e.virtualEth) / Number(e.virtualToken);
    const supply = toTokens(e.supply);
    const r = Number(e.virtualToken) / (Number(e.virtualToken) - Number(e.curveSupply));
    const c: CoinRec = {
      id: key,
      address: e.coin as Coin["address"],
      name: e.name,
      symbol: e.symbol,
      about: e.about ?? "",
      thesis: e.thesis ?? "",
      image: `/api/img/coin/${key}.svg`,
      color: colorFor(key),
      creator: agent?.handle ?? e.creator,
      agent: agent?.id ?? 0,
      createdAt: e.at ?? now(),
      priceEth: startPrice,
      mcapEth: startPrice * supply,
      raisedEth: 0,
      volumeEth: 0,
      trades: 0,
      holders: 0,
      feesEth: 0,
      creatorEarnedEth: 0,
      graduated: false,
      graduatedAt: null,
      progress: 0,
      startMcapEth: startPrice * supply,
      gradMcapEth: startPrice * supply * r * r,
      change1h: 0,
      lastAt: e.at ?? now(),
      poolId: null,
      tx: e.tx,
      virtualEth: e.virtualEth.toString(),
      virtualToken: e.virtualToken.toString(),
      curveSupply: e.curveSupply.toString(),
      ethReserve: "0",
      tokensSold: "0",
      poolEth: "0",
      poolTokens: "0",
      supply: e.supply.toString(),
      pricePoints: [[e.at ?? now(), startPrice]],
      candles: [],
    };
    this.store.coins.set(c);
    if (agent) {
      agent.launched++;
      agent.lastLaunchAt = now();
      if (!agent.coin) {
        agent.coin = c.address;
        agent.coinSymbol = c.symbol;
      }
      this.emitAgent(agent);
    }
    this.activity("launch", `${agent ? "@" + agent.handle : "someone"} launched $${c.symbol} — ${c.name}`, { agent, coin: c, tx: e.tx });
    this.alert("launch", `New coin: $${c.symbol}`, `${agent ? "@" + agent.handle : "A wallet"} launched ${c.name}.`, { coin: c.address, agent: agent?.id ?? null });
    this.emitCoin(c);
    return c;
  }

  onTrade(e: TradeEvent): Trade | null {
    const c = this.store.coins.get(e.coin.toLowerCase());
    if (!c) return null;
    const at = e.at ?? now();
    const agent = this.agentByVault(e.trader) ?? null;
    const eth = toEth(e.ethWei);
    const tokens = toTokens(e.tokensWei);
    const m = this.store.meta;
    const t: Trade = {
      id: m.nextTradeId++,
      coin: c.address,
      symbol: c.symbol,
      agent: agent?.id ?? null,
      handle: agent?.handle ?? null,
      trader: e.trader as Trade["trader"],
      side: e.side,
      eth,
      tokens,
      priceEth: tokens > 0 ? eth / tokens : e.priceEth,
      at,
      tx: e.tx,
      viaPool: e.viaPool,
    };
    this.store.bumpMeta();
    this.store.trades.set(t);

    // position + PnL (cost basis = ETH actually paid; proceeds = ETH actually received)
    const pid = `${e.trader.toLowerCase()}:${c.id}`;
    const pos =
      this.store.positions.get(pid) ??
      this.store.positions.set({ id: pid, address: e.trader.toLowerCase(), agent: agent?.id ?? null, coin: c.id, tokens: "0", costEth: 0, realizedEth: 0 });
    const held = BigInt(pos.tokens);
    if (e.side === "buy") {
      pos.tokens = (held + e.tokensWei).toString();
      pos.costEth += eth;
    } else {
      const sold = e.tokensWei > held ? held : e.tokensWei;
      const frac = held > 0n ? Number(sold) / Number(held) : 0;
      const costPart = pos.costEth * frac;
      const proceeds = eth - toEth(e.feeWei);
      pos.costEth -= costPart;
      pos.realizedEth += proceeds - costPart;
      pos.tokens = (held - sold).toString();
      if (agent) agent.realizedEth = Math.round((agent.realizedEth + proceeds - costPart) * 1e9) / 1e9;
    }
    this.store.positions.touch(pos);

    // coin stats
    if (e.ethReserveWei !== undefined) c.ethReserve = e.ethReserveWei.toString();
    if (e.tokensSoldWei !== undefined) c.tokensSold = e.tokensSoldWei.toString();
    c.trades++;
    c.volumeEth += eth;
    c.feesEth += toEth(e.feeWei);
    c.creatorEarnedEth += toEth(e.feeWei) / 2;
    c.lastAt = at;
    this.setPrice(c, e.priceEth, at, eth);
    if (!c.graduated) {
      c.raisedEth = toEth(BigInt(c.ethReserve));
      c.progress = Math.min(1, Number(BigInt(c.tokensSold)) / Number(BigInt(c.curveSupply)));
    }
    c.holders = this.store.positions.values().filter((p) => p.coin === c.id && BigInt(p.tokens) > 0n).length;
    const creator = this.store.agents.get(c.agent);
    if (creator && e.feeWei > 0n) this.emitAgent(creator);

    this.hub.emit("trade", t);
    this.emitCoin(c);
    if (agent) this.refreshHoldings(agent);
    this.activity(
      "trade",
      `${agent ? "@" + agent.handle : short(e.trader)} ${e.side === "buy" ? "bought" : "sold"} ${fmtTokens(tokens)} $${c.symbol} for ${fmtEth(eth)} ETH`,
      { agent, coin: c, eth, tx: e.tx },
    );
    if (eth >= 0.25) this.alert("whale", `Whale ${e.side} on $${c.symbol}`, `${agent ? "@" + agent.handle : short(e.trader)} ${e.side === "buy" ? "bought" : "sold"} ${fmtEth(eth)} ETH of $${c.symbol}.`, { coin: c.address, agent: agent?.id ?? null });
    return t;
  }

  onGraduated(o: { coin: string; poolId: string; ethLiquidityWei: bigint; tokenLiquidityWei: bigint; burnedWei: bigint; tx: string; at?: number }) {
    const c = this.store.coins.get(o.coin.toLowerCase());
    if (!c || c.graduated) return;
    c.graduated = true;
    c.graduatedAt = o.at ?? now();
    c.poolId = o.poolId;
    c.progress = 1;
    c.raisedEth = toEth(o.ethLiquidityWei);
    c.poolEth = o.ethLiquidityWei.toString();
    c.poolTokens = o.tokenLiquidityWei.toString();
    c.ethReserve = "0";
    c.supply = (BigInt(c.supply) - o.burnedWei).toString();
    c.mcapEth = c.priceEth * toTokens(BigInt(c.supply));
    this.emitCoin(c);
    const agent = this.store.agents.get(c.agent);
    this.activity("graduation", `$${c.symbol} graduated to Uniswap v4 with ${fmtEth(c.raisedEth)} ETH of locked liquidity`, { agent, coin: c, eth: c.raisedEth, tx: o.tx });
    this.alert("graduation", `$${c.symbol} graduated`, `${c.name} hit ${fmtEth(c.mcapEth)} ETH market cap. Liquidity is locked in Uniswap v4 forever.`, { coin: c.address, agent: c.agent || null });
    if (agent) {
      this.addPost({ agent, kind: "graduation", text: `$${c.symbol} just graduated. ${fmtEth(c.raisedEth)} ETH locked in Uniswap v4, forever. thank you to every agent who believed.`, coin: c, tx: o.tx });
    }
  }

  onFeesCollected(coin: string, ethFeesWei: bigint) {
    const c = this.store.coins.get(coin.toLowerCase());
    if (!c) return;
    c.feesEth += toEth(ethFeesWei);
    c.creatorEarnedEth += toEth(ethFeesWei) / 2;
    this.emitCoin(c);
  }

  setPrice(c: CoinRec, price: number, at = now(), volumeEth = 0) {
    if (!Number.isFinite(price) || price <= 0) return;
    c.priceEth = price;
    c.mcapEth = price * toTokens(BigInt(c.supply));
    c.pricePoints.push([at, price]);
    const cutoff = at - 3 * 3600;
    while (c.pricePoints.length > 2 && c.pricePoints[0][0] < cutoff) c.pricePoints.shift();
    const hourAgo = c.pricePoints.find(([t]) => t >= at - 3600) ?? c.pricePoints[0];
    const ref = c.pricePoints.length && c.pricePoints[0][0] < at - 3600 ? lastBefore(c.pricePoints, at - 3600) : hourAgo[1];
    c.change1h = ref > 0 ? price / ref - 1 : 0;
    // candles
    const bucket = Math.floor(at / CANDLE) * CANDLE;
    const last = c.candles[c.candles.length - 1];
    if (last && last.t === bucket) {
      last.h = Math.max(last.h, price);
      last.l = Math.min(last.l, price);
      last.c = price;
      last.v += volumeEth;
    } else {
      const open = last ? last.c : price;
      c.candles.push({ t: bucket, o: open, h: Math.max(open, price), l: Math.min(open, price), c: price, v: volumeEth } as Candle);
      if (c.candles.length > MAX_CANDLES) c.candles.splice(0, c.candles.length - MAX_CANDLES);
    }
  }

  /** Recompute an agent's mark-to-market holdings value. */
  refreshHoldings(a: AgentRec, emit = true) {
    let v = 0;
    for (const p of this.holdingsOf(a.vault)) {
      const c = this.store.coins.get(p.coin);
      if (c) v += toTokens(BigInt(p.tokens)) * c.priceEth;
    }
    a.holdingsEth = Math.round(v * 1e9) / 1e9;
    if (emit) this.emitAgent(a);
    else this.store.agents.touch(a);
  }
}

function lastBefore(points: [number, number][], t: number): number {
  let v = points[0][1];
  for (const [pt, pv] of points) {
    if (pt > t) break;
    v = pv;
  }
  return v;
}

function short(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
