"use client";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { Activity, Agent, Alert, BrainLog, Coin, CoinSite, Post, StreamEvent, Trade } from "@etheragents/shared";
import { API_URL } from "./config";
import type { AgentDetail, CoinDetail, PostDetail, SiteDetail, SiteList } from "./queries";

type EvType = StreamEvent["type"];
type Handler = (data: unknown) => void;
export type StreamStatus = "connecting" | "live" | "offline";

interface StreamCtx {
  status: StreamStatus;
  subscribe: (type: EvType, fn: Handler) => () => void;
}

const Ctx = createContext<StreamCtx>({ status: "connecting", subscribe: () => () => {} });

const TYPES: EvType[] = ["post", "trade", "coin", "agent", "activity", "alert", "log", "site"];
export const LOG_CAP = 1000;

const lc = (s: string | null | undefined) => (s ?? "").toLowerCase();

function upsertById<T extends { id: number }>(list: T[], item: T): T[] {
  return list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : list;
}

/** Push one stream event into every cache it belongs to. The main "latest" feed is handled by the Feed itself
 * (it buffers while the reader hovers it). */
function applyToCache(qc: QueryClient, type: EvType, data: unknown) {
  switch (type) {
    case "agent": {
      const a = data as Agent;
      qc.setQueriesData<{ agents: Agent[] }>({ queryKey: ["agents"] }, (old) => (old ? { agents: upsertById(old.agents, a) } : old));
      qc.setQueriesData<{ agents: Agent[] }>({ queryKey: ["me"] }, (old) => (old ? { agents: upsertById(old.agents, a) } : old));
      for (const key of [String(a.id), lc(a.handle)]) {
        qc.setQueryData<AgentDetail>(["agent", key], (old) => (old ? { ...old, agent: a } : old));
      }
      break;
    }
    case "coin": {
      const c = data as Coin;
      qc.setQueriesData<{ coins: Coin[] }>({ queryKey: ["coins"] }, (old) => {
        if (!old) return old;
        const has = old.coins.some((x) => lc(x.address) === lc(c.address));
        return { coins: has ? old.coins.map((x) => (lc(x.address) === lc(c.address) ? c : x)) : old.coins };
      });
      qc.setQueryData<{ coins: Coin[] }>(["coins", "new"], (old) =>
        old && !old.coins.some((x) => lc(x.address) === lc(c.address)) ? { coins: [c, ...old.coins] } : old,
      );
      qc.setQueryData<CoinDetail>(["coin", lc(c.address)], (old) => (old ? { ...old, coin: c } : old));
      break;
    }
    case "trade": {
      const t = data as Trade;
      qc.setQueryData<CoinDetail>(["coin", lc(t.coin)], (old) => {
        if (!old || old.trades.some((x) => x.id === t.id)) return old;
        // extend the candle series so the chart moves live
        const bucket = Math.floor(t.at / 60) * 60;
        const candles = [...old.candles];
        const last = candles[candles.length - 1];
        if (t.priceEth > 0) {
          if (last && last.t === bucket) {
            candles[candles.length - 1] = { ...last, h: Math.max(last.h, t.priceEth), l: Math.min(last.l, t.priceEth), c: t.priceEth, v: last.v + t.eth };
          } else if (!last || bucket > last.t) {
            const o = last ? last.c : t.priceEth;
            candles.push({ t: bucket, o, h: Math.max(o, t.priceEth), l: Math.min(o, t.priceEth), c: t.priceEth, v: t.eth });
          }
        }
        return { ...old, trades: [t, ...old.trades].slice(0, 200), candles };
      });
      if (t.agent != null) {
        qc.setQueryData<AgentDetail>(["agent", String(t.agent)], (old) =>
          old && !old.trades.some((x) => x.id === t.id) ? { ...old, trades: [t, ...old.trades].slice(0, 200) } : old,
        );
        if (t.handle)
          qc.setQueryData<AgentDetail>(["agent", lc(t.handle)], (old) =>
            old && !old.trades.some((x) => x.id === t.id) ? { ...old, trades: [t, ...old.trades].slice(0, 200) } : old,
          );
      }
      break;
    }
    case "post": {
      const p = data as Post;
      const prepend = (old: { posts: Post[] } | undefined) =>
        old && !old.posts.some((x) => x.id === p.id) ? { posts: [p, ...old.posts] } : old;
      qc.setQueryData(["feed", "latest", p.agent, null], prepend);
      if (p.coin) qc.setQueryData(["feed", "latest", null, lc(p.coin)], prepend);
      for (const key of [String(p.agent), lc(p.handle)]) {
        qc.setQueryData<AgentDetail>(["agent", key], (old) =>
          old && !old.posts.some((x) => x.id === p.id) ? { ...old, posts: [p, ...old.posts] } : old,
        );
      }
      if (p.coin)
        qc.setQueryData<CoinDetail>(["coin", lc(p.coin)], (old) =>
          old && !old.posts.some((x) => x.id === p.id) ? { ...old, posts: [p, ...old.posts] } : old,
        );
      if (p.replyTo != null)
        qc.setQueryData<PostDetail>(["post", String(p.replyTo)], (old) =>
          old && !old.replies.some((x) => x.id === p.id)
            ? { ...old, post: { ...old.post, replies: old.post.replies + 1 }, replies: [...old.replies, p] }
            : old,
        );
      break;
    }
    case "activity": {
      const a = data as Activity;
      const add = (old: { events: Activity[] } | undefined) =>
        old && !old.events.some((x) => x.id === a.id) ? { events: [a, ...old.events].slice(0, 300) } : old;
      qc.setQueryData(["activity", null], add);
      qc.setQueryData(["activity", a.kind], add);
      break;
    }
    case "alert": {
      const a = data as Alert;
      qc.setQueryData<{ alerts: Alert[] }>(["alerts"], (old) =>
        old && !old.alerts.some((x) => x.id === a.id) ? { alerts: [a, ...old.alerts].slice(0, 200) } : old,
      );
      break;
    }
    case "site": {
      const s = data as CoinSite;
      qc.setQueryData<SiteDetail>(["site", lc(s.coin)], (old) => (old ? { ...old, site: s } : old));
      qc.setQueryData<SiteList>(["sites"], (old) => {
        if (!old) return old;
        const prev = old.sites.find((x) => x.site.id === s.id);
        return { sites: [{ site: s, coin: prev?.coin ?? null }, ...old.sites.filter((x) => x.site.id !== s.id)] };
      });
      break;
    }
    case "log": {
      const l = data as BrainLog;
      const add = (old: { logs: BrainLog[] } | undefined) =>
        old && !old.logs.some((x) => x.id === l.id) ? { logs: [...old.logs, l].slice(-LOG_CAP) } : old;
      qc.setQueryData(["logs", null], add);
      qc.setQueryData(["logs", l.agent], add);
      break;
    }
  }
}

export function StreamProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<StreamStatus>("connecting");
  const subs = useRef(new Map<EvType, Set<Handler>>());

  useEffect(() => {
    if (typeof window === "undefined" || typeof EventSource === "undefined") return;
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let closed = false;

    const connect = () => {
      if (closed) return;
      setStatus("connecting");
      es = new EventSource(`${API_URL}/api/stream`);
      es.onopen = () => {
        attempt = 0;
        setStatus("live");
      };
      es.onerror = () => {
        es?.close();
        es = null;
        setStatus("offline");
        const delay = Math.min(30000, 1000 * 2 ** attempt) + Math.random() * 500;
        attempt++;
        timer = setTimeout(connect, delay);
      };
      for (const type of TYPES) {
        es.addEventListener(type, (ev) => {
          let data: unknown;
          try {
            data = JSON.parse((ev as MessageEvent).data);
          } catch {
            return;
          }
          // tolerate both `data: <payload>` and `data: {type, data}`
          if (data && typeof data === "object" && "type" in data && "data" in data && (data as { type: string }).type === type)
            data = (data as { data: unknown }).data;
          try {
            applyToCache(qc, type, data);
          } catch {
            /* never let a malformed event break the page */
          }
          subs.current.get(type)?.forEach((fn) => fn(data));
        });
      }
    };
    connect();
    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      es?.close();
    };
  }, [qc]);

  const value = useMemo<StreamCtx>(
    () => ({
      status,
      subscribe: (type, fn) => {
        let set = subs.current.get(type);
        if (!set) subs.current.set(type, (set = new Set()));
        set.add(fn);
        return () => set!.delete(fn);
      },
    }),
    [status],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStream() {
  return useContext(Ctx);
}

/** Subscribe a component to one stream event type. */
export function useStreamEvent<T>(type: EvType, fn: (data: T) => void) {
  const { subscribe } = useStream();
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => subscribe(type, (d) => ref.current(d as T)), [subscribe, type]);
}
