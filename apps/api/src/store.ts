// State: everything lives in memory (fast reads for the feed) and is written through to Postgres
// (DATABASE_URL) or to a JSON snapshot file (dev), so a restart resumes where it left off.
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import type { Activity, Agent, Alert, BrainLog, Candle, Coin, CoinSite, Post, Trade } from "@etheragents/shared";

export interface AgentRec extends Agent {
  balanceWei: string; // vault ETH (authoritative in sim, cached from chain otherwise)
  personaHash: string;
  maxTradeEth: number; // 0 = unlimited
  dailyLimitEth: number;
  windowStart: number;
  spentInWindowEth: number;
  nextActAt: number;
  lastLaunchAt: number;
  controlNonce: number;
  memory: string[]; // short notes about its own recent actions (fed back to the brain)
  lastError: string | null;
  feesClaimedEth: number;
}

export interface CoinRec extends Coin {
  id: string; // lower-case address
  virtualEth: string;
  virtualToken: string;
  curveSupply: string;
  ethReserve: string;
  tokensSold: string;
  poolEth: string; // sim pool reserves after graduation (chain: informational)
  poolTokens: string;
  supply: string; // total supply (decreases with burns)
  pricePoints: [number, number][]; // [t, priceEth], last ~3h
  candles: Candle[];
}

export interface Position {
  id: string; // `${address}:${coin}` (lower-case)
  address: string;
  agent: number | null;
  coin: string;
  tokens: string; // wei
  costEth: number; // remaining cost basis
  realizedEth: number;
}

export interface Meta {
  id: "meta";
  nextPostId: number;
  nextTradeId: number;
  nextActivityId: number;
  nextAlertId: number;
  nextAgentId: number; // sim only
  lastBlock: string; // indexer cursor
  simNonce: number;
}

type Doc = { id: string | number };

export class Coll<T extends Doc> {
  readonly map = new Map<string, T>();
  readonly dirty = new Set<string>();
  readonly name: string;
  constructor(name: string) {
    this.name = name;
  }
  get(id: string | number): T | undefined {
    return this.map.get(String(id));
  }
  set(v: T): T {
    this.map.set(String(v.id), v);
    this.dirty.add(String(v.id));
    return v;
  }
  touch(v: T) {
    this.dirty.add(String(v.id));
  }
  delete(id: string | number) {
    this.map.delete(String(id));
    this.dirty.add(String(id));
  }
  values(): T[] {
    return [...this.map.values()];
  }
  get size() {
    return this.map.size;
  }
}

export interface Edge {
  id: string; // "like:<agent>:<post>" | "follow:<agent>:<target>"
  kind: "like" | "follow";
  from: number;
  to: number;
  at: number;
}

export class Store {
  agents = new Coll<AgentRec>("agents");
  coins = new Coll<CoinRec>("coins");
  posts = new Coll<Post>("posts");
  trades = new Coll<Trade>("trades");
  positions = new Coll<Position>("positions");
  activity = new Coll<Activity>("activity");
  alerts = new Coll<Alert>("alerts");
  edges = new Coll<Edge>("edges");
  sites = new Coll<CoinSite>("sites");
  metaColl = new Coll<Meta>("meta");
  logs: BrainLog[] = []; // not persisted
  nextLogId = 1;

  private all(): Coll<any>[] {
    return [this.agents, this.coins, this.posts, this.trades, this.positions, this.activity, this.alerts, this.edges, this.sites, this.metaColl];
  }

  get meta(): Meta {
    let m = this.metaColl.get("meta");
    if (!m) {
      m = this.metaColl.set({
        id: "meta",
        nextPostId: 1,
        nextTradeId: 1,
        nextActivityId: 1,
        nextAlertId: 1,
        nextAgentId: 1,
        lastBlock: "0",
        simNonce: 0,
      });
    }
    return m;
  }
  bumpMeta() {
    this.metaColl.touch(this.meta);
  }

  // ── persistence ──
  private pool: pg.Pool | null = null;
  private file: string | null = null;

  async open(databaseUrl: string | undefined, dataDir: string) {
    if (databaseUrl) {
      this.pool = new pg.Pool({ connectionString: databaseUrl, max: 4, ssl: /sslmode=require/.test(databaseUrl) ? { rejectUnauthorized: false } : undefined });
      await this.pool.query(
        `create table if not exists docs (coll text not null, id text not null, data jsonb not null, primary key (coll, id))`,
      );
      const { rows } = await this.pool.query(`select coll, id, data from docs`);
      for (const r of rows) this.byName(r.coll)?.map.set(r.id, r.data);
      console.log(`[store] postgres: loaded ${rows.length} docs`);
    } else {
      fs.mkdirSync(dataDir, { recursive: true });
      this.file = path.join(dataDir, "state.json");
      if (fs.existsSync(this.file)) {
        const data = JSON.parse(fs.readFileSync(this.file, "utf8")) as Record<string, Record<string, any>>;
        for (const [name, docs] of Object.entries(data)) {
          const c = this.byName(name);
          if (c) for (const [id, v] of Object.entries(docs)) c.map.set(id, v);
        }
        console.log(`[store] file: loaded ${this.file}`);
      } else console.log(`[store] file: new state at ${this.file}`);
    }
    for (const c of this.all()) c.dirty.clear();
    this.meta; // ensure exists
  }

  private byName(name: string) {
    return this.all().find((c) => c.name === name);
  }

  private flushing = false;
  async flush() {
    if (this.flushing) return;
    this.flushing = true;
    try {
      if (this.pool) {
        for (const c of this.all()) {
          if (!c.dirty.size) continue;
          const ids = [...c.dirty];
          for (let i = 0; i < ids.length; i += 200) {
            const chunk = ids.slice(i, i + 200);
            const ups = chunk.filter((id) => c.map.has(id));
            const dels = chunk.filter((id) => !c.map.has(id));
            if (ups.length) {
              const vals: unknown[] = [];
              const ph = ups.map((id, j) => {
                vals.push(c.name, id, JSON.stringify(c.map.get(id)));
                return `($${j * 3 + 1}, $${j * 3 + 2}, $${j * 3 + 3}::jsonb)`;
              });
              await this.pool.query(
                `insert into docs (coll, id, data) values ${ph.join(",")} on conflict (coll, id) do update set data = excluded.data`,
                vals,
              );
            }
            if (dels.length) await this.pool.query(`delete from docs where coll = $1 and id = any($2)`, [c.name, dels]);
            for (const id of chunk) c.dirty.delete(id); // only after the write succeeded
          }
        }
      } else if (this.file) {
        if (!this.all().some((c) => c.dirty.size)) return;
        for (const c of this.all()) c.dirty.clear();
        const data: Record<string, Record<string, unknown>> = {};
        for (const c of this.all()) data[c.name] = Object.fromEntries(c.map);
        const tmp = this.file + ".tmp";
        fs.writeFileSync(tmp, JSON.stringify(data));
        fs.renameSync(tmp, this.file);
      }
    } catch (e) {
      console.error("[store] flush failed", e);
    } finally {
      this.flushing = false;
    }
  }

  async close() {
    await this.flush();
    await this.pool?.end();
  }
}
