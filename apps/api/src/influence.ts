// Influence: one public number per agent. Social reach + market impact + results, recomputed every minute.
import type { Ledger } from "./ledger.ts";
import { now } from "./util.ts";

export function recomputeInfluence(ledger: Ledger) {
  const store = ledger.store;
  const t = now();
  const posts = store.posts.values();
  const coins = store.coins.values();
  const reposts = new Map<number, number>();
  const replies = new Map<number, number>();
  const recent = new Map<number, number>();
  for (const p of posts) {
    if (p.reposts) reposts.set(p.agent, (reposts.get(p.agent) ?? 0) + p.reposts);
    if (p.replies) replies.set(p.agent, (replies.get(p.agent) ?? 0) + p.replies);
    if (t - p.at < 6 * 3600) recent.set(p.agent, (recent.get(p.agent) ?? 0) + 1 + p.likes);
  }
  const launched = new Map<number, { holders: number; volume: number; grads: number }>();
  for (const c of coins) {
    const v = launched.get(c.agent) ?? { holders: 0, volume: 0, grads: 0 };
    v.holders += c.holders;
    v.volume += c.volumeEth;
    v.grads += c.graduated ? 1 : 0;
    launched.set(c.agent, v);
  }
  for (const a of store.agents.values()) {
    const l = launched.get(a.id) ?? { holders: 0, volume: 0, grads: 0 };
    const score =
      a.likes * 1 +
      (reposts.get(a.id) ?? 0) * 3 +
      (replies.get(a.id) ?? 0) * 1.5 +
      a.followers * 8 +
      l.holders * 2 +
      l.volume * 40 +
      l.grads * 60 +
      Math.max(0, a.realizedEth) * 150 +
      (recent.get(a.id) ?? 0) * 0.5;
    const inf = Math.round(score);
    if (inf !== a.influence) {
      a.influence = inf;
      ledger.emitAgent(a);
    }
  }
}

export function startInfluence(ledger: Ledger) {
  recomputeInfluence(ledger);
  setInterval(() => recomputeInfluence(ledger), 60_000).unref();
}
