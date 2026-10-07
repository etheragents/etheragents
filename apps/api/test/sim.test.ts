import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/store.ts";
import { Hub } from "../src/hub.ts";
import { Ledger } from "../src/ledger.ts";
import { SimMarket } from "../src/sim.ts";
import { Brain } from "../src/brain.ts";
import { createAgentRec } from "../src/app.ts";
import { HOUSE } from "../src/house.ts";
import { curve, curveParams } from "../src/market.ts";
import { parseJsonObject } from "../src/llm.ts";
import { toEth, toWei } from "../src/util.ts";

async function world(n = 6) {
  const store = new Store();
  await store.open(undefined, fs.mkdtempSync(path.join(os.tmpdir(), "ea-")));
  const ledger = new Ledger(store, new Hub(), 31337);
  const market = new SimMarket(ledger, 31337);
  for (const [i, h] of HOUSE.slice(0, n).entries()) {
    const a = createAgentRec({ id: i + 1, handle: h.handle, name: h.name, persona: h.persona, avatar: h.avatar, owner: "0x0000000000000000000000000000000000000001", vault: market.address("vault"), balanceWei: toWei(1).toString(), house: true });
    a.maxTradeEth = 0.04;
    a.dailyLimitEth = 0.6;
    store.agents.set(a);
  }
  return { store, ledger, market, brain: new Brain(ledger, market) };
}

test("curve: graduation at ~3.8 ETH market cap after ~0.456 ETH raised", () => {
  const p = curveParams();
  const c = { virtualEth: p.virtualEth.toString(), virtualToken: p.virtualToken.toString(), curveSupply: p.curveSupply.toString(), ethReserve: "0", tokensSold: "0" };
  const q = curve.buy(c, toWei(5));
  assert.equal(q.last, true);
  assert.ok(Math.abs(toEth(q.net) - 0.456) < 0.005, "raise " + toEth(q.net));
  assert.ok(q.refund > toWei(4.5));
  const after = { ...c, ethReserve: q.net.toString(), tokensSold: q.out.toString() };
  assert.ok(Math.abs(curve.price(after) * 1e9 - 3.8) < 0.05, "grad mcap " + curve.price(after) * 1e9);
});

test("sim: agents launch, trade, post, and money is conserved", async () => {
  const { store, ledger, market, brain } = await world();
  const startEth = store.agents.values().reduce((s, a) => s + toEth(BigInt(a.balanceWei)), 0);
  for (let round = 0; round < 25; round++) for (const a of store.agents.values()) await brain.wake(a);
  assert.ok(store.coins.size > 0, "coins launched");
  assert.ok(store.trades.size > 10, "trades happened: " + store.trades.size);
  assert.ok(store.posts.size > 20, "posts happened");
  // conservation: ETH in vaults + ETH in curves/pools + protocol's half of fees == starting ETH (within rounding)
  const vaults = store.agents.values().reduce((s, a) => s + toEth(BigInt(a.balanceWei)), 0);
  const curves = store.coins.values().reduce((s, c) => s + toEth(BigInt(c.ethReserve)) + (c.graduated ? toEth(BigInt(c.poolEth)) : 0), 0);
  const protocol = store.coins.values().reduce((s, c) => s + c.feesEth / 2, 0);
  assert.ok(Math.abs(vaults + curves + protocol - startEth) < 1e-6, `conservation: ${vaults} + ${curves} + ${protocol} vs ${startEth}`);
  // limits respected
  for (const t of store.trades.values()) if (t.side === "buy" && t.agent) assert.ok(t.eth <= 0.04 + 1e-9, "trade over limit: " + t.eth);
  // every position is non-negative, holders consistent
  for (const p of store.positions.values()) assert.ok(BigInt(p.tokens) >= 0n);
  void ledger;
  void market;
});

test("brain rejects invented coins and oversize trades", async () => {
  const { store, brain } = await world(1);
  const a = store.agents.values()[0];
  await assert.rejects(brain.execute(a, { type: "buy", symbol: "NOPE", eth: 0.01 }, { coins: [], feed: [], mentions: [], limits: brain.limits(a), taken: [] }), /unknown coin/);
  await brain.execute(a, { type: "launch", name: "Test Coin", symbol: "TEST", about: "x", thesis: "y", eth: 0.01 }, { coins: [], feed: [], mentions: [], limits: brain.limits(a), taken: [] });
  const before = BigInt(a.balanceWei);
  await brain.execute(a, { type: "buy", symbol: "TEST", eth: 50 }, { coins: [], feed: [], mentions: [], limits: brain.limits(a), taken: ["TEST"] });
  assert.ok(before - BigInt(a.balanceWei) <= toWei(0.04), "clamped to the per-trade limit");
});

test("parseJsonObject survives fences and chatter", () => {
  assert.deepEqual(parseJsonObject('sure!\n```json\n{"thought":"a {b}","actions":[]}\n```'), { thought: "a {b}", actions: [] });
});

test("sites: every coin gets a website from its agent, paid from its fees; content is sanitized", async () => {
  const { store, brain } = await world();
  for (let round = 0; round < 30 && store.sites.size === 0; round++) {
    for (const c of store.coins.values()) c.createdAt -= 60; // let launches age past the mock's 20 s wait
    for (const a of store.agents.values()) await brain.wake(a);
  }
  assert.ok(store.sites.size > 0, "a site was built");
  for (const s of store.sites.values()) {
    const c = store.coins.get(s.id)!;
    assert.equal(s.agent, c.agent, "only the launching agent writes the site");
    assert.ok(c.site && c.site.version === s.version);
    assert.ok(store.posts.values().some((p) => p.kind === "site" && p.coin?.toLowerCase() === s.id));
  }
  const { sanitizeSite } = await import("../src/site.ts");
  const coin = store.coins.values()[0];
  const out = sanitizeSite(
    {
      theme: { layout: "evil", surface: "paper", font: "comic", accent: "javascript:alert(1)" },
      hero: { headline: "<script>alert(1)</script>Hello https://phish.example", sub: "x".repeat(5000) },
      sections: [{ kind: "html", body: "<b>no</b>" }, { kind: "text", title: "Idea", body: "Visit www.scam.example now <img src=x onerror=1>" }, { kind: "stats" }, { kind: "stats" }],
    },
    coin,
  );
  assert.equal(out.theme.layout, "editorial");
  assert.equal(out.theme.font, "serif");
  assert.match(out.theme.accent, /^#[0-9A-F]{6}$/);
  assert.ok(!/script|https?:|www\.|<|>/.test(JSON.stringify(out.hero) + JSON.stringify(out.sections)), JSON.stringify(out));
  assert.equal(out.hero.sub.length, 220);
  assert.equal(out.sections.length, 2, "unknown kinds and duplicate stats dropped");
  assert.throws(() => sanitizeSite({ sections: [] }, coin));
  // every coin gets a site at launch, and each version is charged to that coin's fee budget
  for (const c of store.coins.values()) {
    const site = store.sites.get(c.id);
    assert.ok(site, `$${c.symbol} has a website`);
    assert.ok(site!.costEth > 0 && site!.spentEth >= site!.costEth);
  }
  // a rewrite needs budget: drain it and the agent is refused
  const s0 = store.sites.get(coin.id)!;
  s0.updatedAt = 0;
  s0.spentEth = coin.feesEth / 2;
  await assert.rejects(() => brain.execute(store.agents.get(coin.agent)!, { type: "site", symbol: coin.symbol }, {} as any), /budget/);
  // someone else's coin
  const other = store.agents.values().find((x) => x.id !== coin.agent)!;
  await assert.rejects(() => brain.execute(other, { type: "site", symbol: coin.symbol }, {} as any), /only the agent that launched/);
});

test("one coin per agent: an agent that launched can never launch again", async () => {
  const { store, brain } = await world(4);
  for (let round = 0; round < 40; round++) for (const a of store.agents.values()) await brain.wake(a);
  const per = new Map<number, number>();
  for (const c of store.coins.values()) per.set(c.agent, (per.get(c.agent) ?? 0) + 1);
  for (const [id, n] of per) assert.equal(n, 1, `agent ${id} launched ${n} coins`);
  const a = store.agents.values().find((x) => per.has(x.id))!;
  assert.equal(brain.limits(a).canLaunch, false);
  assert.ok(a.coin, "agent knows its coin");
  await assert.rejects(() => brain.execute(a, { type: "launch", name: "Second Try", symbol: "SECOND", eth: 0.002 }, { taken: [] } as any), /exactly one/);
});
