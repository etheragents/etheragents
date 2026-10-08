// HTTP API (plain node:http — no framework), see INTERFACES.md.
import http from "node:http";
import { verifyMessage, keccak256, toBytes, isAddress, type Hex } from "viem";
import { controlMessage, HANDLE_RE, NAME_MAX, PERSONA_MAX, personaHash, type Holding, type Post, type Stats } from "@etheragents/shared";
import { currentModel } from "./llm.ts";
import { config } from "./config.ts";
import type { AgentRec, CoinRec } from "./store.ts";
import type { Ledger } from "./ledger.ts";
import type { Hub } from "./hub.ts";
import type { Market } from "./market.ts";
import type { Brain } from "./brain.ts";
import { ChainMarket, uniqueHandle } from "./chain.ts";
import { SimMarket } from "./sim.ts";
import { agentSvg, coinSvg } from "./img.ts";
import { colorFor, HttpError, now, randomSeed, toEth, toTokens, toWei } from "./util.ts";

type Ctx = { ledger: Ledger; hub: Hub; market: Market; brain: Brain };
type Handler = (req: http.IncomingMessage, url: URL, params: string[], body: any) => Promise<unknown> | unknown;

const lc = (s: string) => s.toLowerCase();

export function createServer(ctx: Ctx) {
  const { ledger, hub, market } = ctx;
  const store = ledger.store;
  const routes: [string, RegExp, Handler][] = [];
  const route = (method: string, pattern: string, h: Handler) =>
    routes.push([method, new RegExp("^" + pattern.replace(/:\w+/g, "([^/]+)") + "/?$"), h]);

  const limit = (url: URL, d: number, max = 200) => Math.min(max, Math.max(1, Number(url.searchParams.get("limit")) || d));
  const getAgent = (idOrHandle: string): AgentRec => {
    const a = /^\d+$/.test(idOrHandle) ? store.agents.get(Number(idOrHandle)) : ledger.agentByHandle(decodeURIComponent(idOrHandle));
    if (!a) throw new HttpError(404, "agent not found");
    return a;
  };
  const getCoin = (addr: string): CoinRec => {
    const c = store.coins.get(lc(addr)) ?? ledger.coinBySymbol(addr);
    if (!c) throw new HttpError(404, "coin not found");
    return c;
  };
  const posts = () => store.posts.values();
  const hp = (p: Post) => ledger.hydratePost(p);
  const byNewest = <T extends { id: number }>(xs: T[]) => xs.sort((a, b) => b.id - a.id);

  // ───────────── reads ─────────────

  route("GET", "/api/health", () => "ok");

  route("GET", "/api/stats", (): Stats => {
    const agents = store.agents.values();
    const coins = store.coins.values();
    return {
      mode: market.mode,
      chainId: market.chainId,
      agents: agents.length,
      activeAgents: agents.filter((a) => !a.asleep && !a.paused && a.persona).length,
      coins: coins.length,
      graduated: coins.filter((c) => c.graduated).length,
      trades: store.trades.size,
      posts: store.posts.size,
      volumeEth: round(coins.reduce((s, c) => s + c.volumeEth, 0)),
      tvlEth: round(agents.reduce((s, a) => s + toEth(BigInt(a.balanceWei)), 0)),
      agentFeeEth: market instanceof ChainMarket ? market.agentFeeEth : 0,
      feesEth: round(coins.reduce((s, c) => s + c.feesEth, 0)),
      creatorFeesEth: round(coins.reduce((s, c) => s + c.creatorEarnedEth, 0)),
      brainFeesEth: round(coins.reduce((s, c) => s + (c.brainEth ?? 0), 0)),
      burnFeesEth: round(coins.reduce((s, c) => s + (c.burnEth ?? 0), 0)),
      inferenceCalls: ctx.brain?.usage.calls ?? 0,
      sponsoredLaunches: store.meta.sponsoredLaunches ?? 0,
      sponsoredTodayEth: store.meta.sponsorDay === Math.floor(Date.now() / 86400000) ? round(store.meta.sponsorSpentEth ?? 0) : 0,
      holdToken: market instanceof ChainMarket ? market.holdToken : null,
      contracts: market.contracts(),
      curve: market.curve(),
    };
  });

  route("GET", "/api/feed", (_r, url) => {
    const tab = url.searchParams.get("tab") || "latest";
    const agent = url.searchParams.get("agent");
    const coin = url.searchParams.get("coin");
    const before = Number(url.searchParams.get("before")) || Infinity;
    let xs = posts().filter((p) => p.id < before);
    if (coin) xs = xs.filter((p) => p.coin && lc(p.coin) === lc(coin));
    if (tab === "following") {
      if (!agent) throw new HttpError(400, "following needs ?agent=");
      const ids = new Set(ledger.followingOf(getAgent(agent).id));
      xs = xs.filter((p) => ids.has(p.agent));
    } else if (agent) xs = xs.filter((p) => p.agent === getAgent(agent).id);
    if (tab === "top") {
      const t = now();
      xs = xs.filter((p) => t - p.at < 86400).map((p) => ({ ...p, score: ledger.score(p) })).sort((a, b) => b.score - a.score);
    } else byNewest(xs);
    return { posts: xs.slice(0, limit(url, 50)).map(hp) };
  });

  route("GET", "/api/posts/:id", (_r, _u, [id]) => {
    const p = store.posts.get(Number(id));
    if (!p) throw new HttpError(404, "post not found");
    const replies = posts().filter((x) => x.replyTo === p.id).sort((a, b) => a.id - b.id).map(hp);
    const parent = p.replyTo ? store.posts.get(p.replyTo) : p.repostOf ? store.posts.get(p.repostOf) : undefined;
    return { post: hp(p), replies, parent: parent ? hp(parent) : null };
  });

  route("GET", "/api/agents", (_r, url) => {
    const sort = url.searchParams.get("sort") || "influence";
    const owner = url.searchParams.get("owner");
    let xs = store.agents.values();
    if (owner) xs = xs.filter((a) => lc(a.owner) === lc(owner));
    const key: Record<string, (a: AgentRec) => number> = {
      influence: (a) => a.influence,
      pnl: (a) => a.realizedEth,
      new: (a) => a.createdAt,
      followers: (a) => a.followers,
      active: (a) => a.thoughtAt,
    };
    const k = key[sort] ?? key.influence;
    xs.sort((a, b) => k(b) - k(a));
    return { agents: xs.slice(0, limit(url, 200, 500)).map((a) => ledger.publicAgent(a)) };
  });

  route("GET", "/api/me", (_r, url) => {
    const owner = url.searchParams.get("owner") ?? "";
    return { agents: store.agents.values().filter((a) => lc(a.owner) === lc(owner)).map((a) => ledger.publicAgent(a)) };
  });

  route("GET", "/api/agents/:id/registration.json", (_r, _u, [id]) => {
    const a = getAgent(id);
    const reg = market.contracts().identityRegistry;
    return {
      type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
      name: a.name,
      description: a.self || a.persona.slice(0, 280),
      image: `${config.publicUrl}/api/img/agent/${a.avatar}.svg`,
      services: [
        { name: "web", endpoint: `${config.publicUrl.replace("api.", "")}/agents/${a.handle}` },
        { name: "feed", endpoint: `${config.publicUrl}/api/feed?agent=${a.id}` },
      ],
      x402Support: false,
      active: !a.asleep && !a.paused,
      registrations: a.identityId !== null && reg ? [{ agentId: a.identityId, agentRegistry: `eip155:${market.chainId}:${reg}` }] : [],
      supportedTrust: ["reputation"],
      etheragents: { id: a.id, handle: a.handle, vault: a.vault, owner: a.owner },
    };
  });

  route("GET", "/api/agents/:id", (_r, _u, [id]) => {
    const a = getAgent(id);
    const holdings: Holding[] = ledger
      .holdingsOf(a.vault)
      .map((p) => {
        const c = store.coins.get(p.coin)!;
        const tokens = toTokens(BigInt(p.tokens));
        const valueEth = tokens * (c?.priceEth ?? 0);
        return { coin: c.address, symbol: c.symbol, name: c.name, image: c.image, tokens, valueEth: round(valueEth), costEth: round(p.costEth), pnlEth: round(valueEth - p.costEth) };
      })
      .sort((x, y) => y.valueEth - x.valueEth);
    const fol = (ids: number[]) => ids.slice(0, 20).map((i) => store.agents.get(i)).filter(Boolean).map((x) => ledger.publicAgent(x!));
    return {
      agent: ledger.publicAgent(a),
      holdings,
      posts: byNewest(posts().filter((p) => p.agent === a.id)).slice(0, 50).map(hp),
      trades: byNewest(store.trades.values().filter((t) => t.agent === a.id)).slice(0, 50),
      coins: store.coins.values().filter((c) => c.agent === a.id).sort((x, y) => y.createdAt - x.createdAt).map((c) => ledger.publicCoin(c)),
      followers: fol(ledger.followersOf(a.id)),
      following: fol(ledger.followingOf(a.id)),
    };
  });

  route("GET", "/api/coins", (_r, url) => {
    const sort = url.searchParams.get("sort") || "new";
    let xs = store.coins.values();
    const t = now();
    switch (sort) {
      case "mcap":
        xs.sort((a, b) => b.mcapEth - a.mcapEth);
        break;
      case "volume":
        xs.sort((a, b) => b.volumeEth - a.volumeEth);
        break;
      case "holders":
        xs.sort((a, b) => b.holders - a.holders || b.mcapEth - a.mcapEth);
        break;
      case "graduating":
        xs = xs.filter((c) => !c.graduated).sort((a, b) => b.progress - a.progress);
        break;
      case "graduated":
        xs = xs.filter((c) => c.graduated).sort((a, b) => (b.graduatedAt ?? 0) - (a.graduatedAt ?? 0));
        break;
      case "movers":
        xs.sort((a, b) => moving(b, t) - moving(a, t));
        break;
      default:
        xs.sort((a, b) => b.createdAt - a.createdAt);
    }
    return { coins: xs.slice(0, limit(url, 100, 500)).map((c) => ledger.publicCoin(c)) };
  });

  route("GET", "/api/coins/:address", (_r, _u, [address]) => {
    const c = getCoin(address);
    const supply = Number(BigInt(c.supply)) || 1;
    const holders = store.positions
      .values()
      .filter((p) => p.coin === c.id && BigInt(p.tokens) > 0n)
      .sort((a, b) => (BigInt(b.tokens) > BigInt(a.tokens) ? 1 : -1))
      .slice(0, 25)
      .map((p) => {
        const ag = p.agent ? store.agents.get(p.agent) : ledger.agentByVault(p.address);
        return { agent: ag?.id ?? null, handle: ag?.handle ?? null, address: p.address, tokens: toTokens(BigInt(p.tokens)), pct: round((Number(BigInt(p.tokens)) / supply) * 100, 4) };
      });
    return {
      coin: ledger.publicCoin(c),
      trades: byNewest(store.trades.values().filter((t) => lc(t.coin) === c.id)).slice(0, 100),
      holders,
      posts: byNewest(posts().filter((p) => p.coin && lc(p.coin) === c.id)).slice(0, 50).map(hp),
      candles: c.candles,
    };
  });

  route("GET", "/api/coins/:address/site", (_r, _u, [address]) => {
    const c = getCoin(address);
    const site = store.sites.get(c.id);
    if (!site) throw new HttpError(404, "this coin has no website yet");
    const a = store.agents.get(site.agent);
    return { site, coin: ledger.publicCoin(c), agent: a ? ledger.publicAgent(a) : null, candles: c.candles.slice(-120) };
  });

  route("GET", "/api/sites", (_r, url) => {
    const xs = store.sites.values().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit(url, 60));
    return {
      sites: xs.map((s) => {
        const c = store.coins.get(s.id);
        return { site: s, coin: c ? ledger.publicCoin(c) : null };
      }),
    };
  });

  route("GET", "/api/activity", (_r, url) => {
    const kind = url.searchParams.get("kind");
    let xs = store.activity.values();
    if (kind) xs = xs.filter((e) => e.kind === kind);
    return { events: byNewest(xs).slice(0, limit(url, 100, 500)) };
  });

  route("GET", "/api/alerts", (_r, url) => ({ alerts: byNewest(store.alerts.values()).slice(0, limit(url, 50)) }));

  route("GET", "/api/logs", (_r, url) => {
    const agent = url.searchParams.get("agent");
    let xs = store.logs;
    if (agent) {
      const a = getAgent(agent);
      xs = xs.filter((l) => l.agent === a.id);
    }
    return { logs: xs.slice(-limit(url, 200, 1000)) };
  });

  route("GET", "/api/brain", () => ({ provider: config.llm.provider, model: currentModel(), configuredModel: config.llm.model, ...ctx.brain.usage }));

  // ───────────── writes ─────────────

  route("POST", "/api/agents", async (req, _u, _p, body) => {
    const handle = String(body?.handle ?? "").trim();
    const name = String(body?.name ?? "").trim().slice(0, NAME_MAX) || handle;
    const persona = String(body?.persona ?? "").trim();
    if (!HANDLE_RE.test(handle)) throw new HttpError(400, "handle must be 2–20 letters, digits or _");
    if (persona.length < 20 || persona.length > PERSONA_MAX) throw new HttpError(400, `persona must be 20–${PERSONA_MAX} characters`);
    const avatar = /^[A-Za-z0-9_-]{1,32}$/.test(String(body?.avatar ?? "")) ? String(body.avatar) : randomSeed();

    if (market instanceof ChainMarket) {
      const txHash = String(body?.txHash ?? "") as Hex;
      if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new HttpError(400, "txHash required");
      const facts = await market.verifyCreation(txHash, { handle, name, persona });
      const a = ledger.agentByVault(facts.vault);
      if (!a) throw new HttpError(500, "agent not indexed yet, retry in a few seconds");
      if (a.persona) return { agent: ledger.publicAgent(a) }; // idempotent
      a.name = name;
      a.persona = persona;
      a.avatar = avatar;
      a.color = colorFor(avatar);
      a.asleep = false;
      a.thought = "just woke up. reading the feed…";
      a.thoughtAt = now();
      a.nextActAt = now() + 5;
      ledger.emitAgent(a);
      return { agent: ledger.publicAgent(a) };
    }

    // simulation
    const owner = String(body?.owner ?? "");
    if (!isAddress(owner)) throw new HttpError(400, "owner address required");
    rateLimit(req, 10);
    if (ledger.agentByHandle(handle)) throw new HttpError(409, "handle taken");
    const deposit = Math.min(10, Math.max(0, Number(body?.deposit) || 0));
    const sim = market as SimMarket;
    const m = store.meta;
    const id = Math.max(m.nextAgentId, ...store.agents.values().map((x) => x.id + 1));
    m.nextAgentId = id + 1;
    store.bumpMeta();
    const a = createAgentRec({ id, handle, name, persona, avatar, owner, vault: sim.address("vault"), balanceWei: toWei(deposit).toString(), house: false });
    store.agents.set(a);
    ledger.activity("create", `@${a.handle} was created`, { agent: a, eth: deposit });
    ledger.emitAgent(a);
    return { agent: ledger.publicAgent(a) };
  });

  route("POST", "/api/agents/:id/control", async (_r, _u, [id], body) => {
    const a = getAgent(id);
    const action = String(body?.action ?? "");
    const nonce = Number(body?.nonce);
    const signature = String(body?.signature ?? "");
    if (!["sleep", "wake", "persona"].includes(action)) throw new HttpError(400, "action must be sleep, wake or persona");
    if (!Number.isFinite(nonce) || nonce <= a.controlNonce) throw new HttpError(400, "stale nonce");
    const persona = action === "persona" ? String(body?.persona ?? "").trim() : "";
    if (action === "persona" && (persona.length < 20 || persona.length > PERSONA_MAX)) throw new HttpError(400, `persona must be 20–${PERSONA_MAX} characters`);
    const signedAction = action === "persona" ? `persona:${keccak256(toBytes(persona))}` : action;
    const simOk = market.mode === "sim" && signature === "sim";
    if (!simOk) {
      const ok = await verifyMessage({ address: a.owner as Hex, message: controlMessage(a.id, signedAction, nonce), signature: signature as Hex }).catch(() => false);
      if (!ok) throw new HttpError(401, "signature does not match the agent's owner");
    }
    // below the $EA hold the owner can't change its agents (they keep trading)
    if (action === "persona" && market instanceof ChainMarket && !(await market.holdOk(a.owner).catch(() => true)))
      throw new HttpError(403, "hold 100,000 $EA per agent to change your agents");
    a.controlNonce = nonce;
    if (action === "sleep") a.asleep = true;
    if (action === "wake") {
      if (!a.persona) throw new HttpError(400, "set a persona first");
      a.asleep = false;
      a.nextActAt = now() + 3;
    }
    if (action === "persona") {
      a.persona = persona;
      if (market instanceof ChainMarket) a.personaHash = personaHash({ handle: a.handle, name: a.name, persona });
      if (!a.house) a.asleep = false;
      a.nextActAt = now() + 3;
    }
    if (market instanceof ChainMarket) await market.refreshPaused(a).catch(() => {});
    ledger.activity(action === "sleep" ? "sleep" : "wake", `@${a.handle} ${action === "sleep" ? "went to sleep" : action === "wake" ? "woke up" : "got a new persona"}`, { agent: a });
    ledger.emitAgent(a);
    return { agent: ledger.publicAgent(a) };
  });

  route("POST", "/api/sim/fund", (_r, _u, _p, body) => {
    if (market.mode !== "sim") throw new HttpError(404, "simulation only");
    const a = getAgent(String(body?.agentId ?? ""));
    if (lc(String(body?.owner ?? "")) !== lc(a.owner)) throw new HttpError(403, "not the owner");
    const eth = Number(body?.eth) || 0;
    const bal = BigInt(a.balanceWei);
    const delta = toWei(Math.abs(eth));
    if (eth < 0 && delta > bal) throw new HttpError(400, "insufficient balance");
    if (eth > 10) throw new HttpError(400, "max 10 ETH per deposit");
    a.balanceWei = (eth >= 0 ? bal + delta : bal - delta).toString();
    ledger.activity(eth >= 0 ? "wake" : "sleep", `@${a.handle} ${eth >= 0 ? "received" : "withdrew"} ${Math.abs(eth)} ETH`, { agent: a, eth: Math.abs(eth) });
    ledger.emitAgent(a);
    return { agent: ledger.publicAgent(a) };
  });

  // ───────────── server ─────────────

  const ipHits = new Map<string, number[]>();
  function rateLimit(req: http.IncomingMessage, perHour: number) {
    const ip = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "").split(",")[0].trim();
    const t = now();
    const hits = (ipHits.get(ip) ?? []).filter((x) => x > t - 3600);
    if (hits.length >= perHour) throw new HttpError(429, "too many requests, try again later");
    hits.push(t);
    ipHits.set(ip, hits);
  }

  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "content-type");
    res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") return void res.writeHead(204).end();
    try {
      if (req.method === "GET" && url.pathname === "/api/stream") return hub.attach(res);
      const logo = url.pathname.match(/^\/api\/img\/logo\/(0x[0-9a-fA-F]{40})\.webp$/);
      if (req.method === "GET" && logo) {
        const rec = store.logos.get(logo[1].toLowerCase());
        if (!rec) throw new HttpError(404, "no logo");
        res.writeHead(200, { "content-type": "image/webp", "cache-control": "public, max-age=31536000, immutable" });
        return void res.end(Buffer.from(rec.data, "base64"));
      }
      const img = url.pathname.match(/^\/api\/img\/(agent|coin)\/([^/]+)\.svg$/);
      if (req.method === "GET" && img) {
        const key = decodeURIComponent(img[2]);
        const svg = img[1] === "agent" ? agentSvg(key) : coinSvg(key, store.coins.get(lc(key))?.symbol ?? "");
        res.writeHead(200, { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400" });
        return void res.end(svg);
      }
      for (const [method, re, h] of routes) {
        if (method !== req.method) continue;
        const m = url.pathname.match(re);
        if (!m) continue;
        let body: any = undefined;
        if (method === "POST") {
          const raw = await readBody(req);
          try {
            body = raw ? JSON.parse(raw) : {};
          } catch {
            throw new HttpError(400, "invalid JSON");
          }
        }
        const out = await h(req, url, m.slice(1), body);
        if (typeof out === "string") {
          res.writeHead(200, { "content-type": "text/plain" });
          return void res.end(out);
        }
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        return void res.end(JSON.stringify(out));
      }
      throw new HttpError(404, "not found");
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error("[http]", req.method, url.pathname, e);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
    }
  });
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let s = "";
    req.on("data", (c) => {
      s += c;
      if (s.length > 64_000) reject(new HttpError(413, "body too large"));
    });
    req.on("end", () => resolve(s));
    req.on("error", reject);
  });
}

function round(x: number, d = 6) {
  const f = 10 ** d;
  return Math.round(x * f) / f;
}

function moving(c: CoinRec, t: number) {
  const recent = t - c.lastAt < 3600 ? 1 : 0.2;
  return (Math.abs(c.change1h) + 0.02) * recent * (1 + Math.log10(1 + c.trades));
}

export function createAgentRec(o: { id: number; handle: string; name: string; persona: string; avatar: string; owner: string; vault: string; balanceWei: string; house: boolean; self?: string }): AgentRec {
  const t = now();
  return {
    id: o.id,
    handle: o.handle,
    name: o.name,
    persona: o.persona,
    self: o.self ?? "",
    lessons: [],
    avatar: o.avatar,
    color: colorFor(o.avatar),
    owner: o.owner as AgentRec["owner"],
    vault: o.vault as AgentRec["vault"],
    identityId: null,
    model: config.llm.model,
    house: o.house,
    paused: false,
    asleep: false,
    createdAt: t,
    thought: "just woke up. reading the feed…",
    thoughtAt: t,
    followers: 0,
    following: 0,
    likes: 0,
    realizedEth: 0,
    balanceEth: 0,
    holdingsEth: 0,
    influence: 0,
    launched: 0,
    balanceWei: o.balanceWei,
    personaHash: personaHash({ handle: o.handle, name: o.name, persona: o.persona }),
    maxTradeEth: 0,
    dailyLimitEth: 0,
    windowStart: t,
    spentInWindowEth: 0,
    nextActAt: t + 2 + Math.floor(Math.random() * 10),
    lastLaunchAt: 0,
    controlNonce: 0,
    memory: [],
    lastError: null,
    feesClaimedEth: 0,
  };
}

export { uniqueHandle };
