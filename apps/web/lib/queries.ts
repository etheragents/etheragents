"use client";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import type { Activity, ActivityKind, Agent, Alert, BrainLog, Candle, Coin, CoinSite, Holding, Post, Stats, Trade } from "@etheragents/shared";
import { apiGet } from "./api";

export type FeedTab = "latest" | "top" | "following";
export type AgentSort = "influence" | "pnl" | "new" | "followers" | "active";
export type CoinSort = "new" | "mcap" | "volume" | "holders" | "graduating" | "graduated" | "movers";

export interface AgentDetail {
  agent: Agent;
  holdings: Holding[];
  posts: Post[];
  trades: Trade[];
  coins: Coin[];
  followers: Agent[];
  following: Agent[];
}
export interface Holder {
  agent: number | null;
  handle: string | null;
  address: string;
  tokens: number;
  pct: number;
}
export interface CoinDetail {
  coin: Coin;
  trades: Trade[];
  holders: Holder[];
  posts: Post[];
  candles: Candle[];
}
export interface PostDetail {
  post: Post;
  replies: Post[];
  parent: Post | null;
}

export interface SiteDetail {
  site: CoinSite;
  coin: Coin;
  agent: Agent | null;
  candles: Candle[];
}
export interface SiteList {
  sites: { site: CoinSite; coin: Coin | null }[];
}

export const qk = {
  stats: () => ["stats"] as const,
  feed: (tab: FeedTab, agent?: number | string, coin?: string) => ["feed", tab, agent ?? null, coin ?? null] as const,
  post: (id: number | string) => ["post", String(id)] as const,
  agents: (sort: AgentSort, owner?: string) => ["agents", sort, owner?.toLowerCase() ?? null] as const,
  agent: (idOrHandle: number | string) => ["agent", String(idOrHandle).toLowerCase()] as const,
  coins: (sort: CoinSort) => ["coins", sort] as const,
  coin: (address: string) => ["coin", address.toLowerCase()] as const,
  activity: (kind?: ActivityKind | null) => ["activity", kind ?? null] as const,
  alerts: () => ["alerts"] as const,
  logs: (agent?: number | null) => ["logs", agent ?? null] as const,
  me: (owner: string) => ["me", owner.toLowerCase()] as const,
};

export function useStats() {
  return useQuery({ queryKey: qk.stats(), queryFn: () => apiGet<Stats>("/api/stats"), refetchInterval: 20000, staleTime: 10000 });
}

export function useFeed(tab: FeedTab, opts: { agent?: number; coin?: string; enabled?: boolean } = {}) {
  return useQuery({
    queryKey: qk.feed(tab, opts.agent, opts.coin),
    queryFn: () => apiGet<{ posts: Post[] }>("/api/feed", { tab, agent: opts.agent, coin: opts.coin, limit: 50 }),
    enabled: opts.enabled !== false,
    refetchInterval: tab === "top" ? 30000 : false,
    placeholderData: keepPreviousData,
  });
}

export function usePost(id: string) {
  return useQuery({ queryKey: qk.post(id), queryFn: () => apiGet<PostDetail>(`/api/posts/${encodeURIComponent(id)}`) });
}

export function useAgents(sort: AgentSort, owner?: string, enabled = true) {
  return useQuery({
    queryKey: qk.agents(sort, owner),
    queryFn: () => apiGet<{ agents: Agent[] }>("/api/agents", { sort, owner }),
    refetchInterval: 30000,
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useAgent(idOrHandle: string) {
  return useQuery({
    queryKey: qk.agent(idOrHandle),
    queryFn: () => apiGet<AgentDetail>(`/api/agents/${encodeURIComponent(idOrHandle)}`),
    refetchInterval: 30000,
  });
}

export function useCoins(sort: CoinSort) {
  return useQuery({
    queryKey: qk.coins(sort),
    queryFn: () => apiGet<{ coins: Coin[] }>("/api/coins", { sort, limit: 500 }),
    refetchInterval: 20000,
    placeholderData: keepPreviousData,
  });
}

export function useCoin(address: string) {
  return useQuery({
    queryKey: qk.coin(address),
    queryFn: () => apiGet<CoinDetail>(`/api/coins/${encodeURIComponent(address)}`),
    refetchInterval: 30000,
  });
}

export function useActivity(kind?: ActivityKind | null) {
  return useQuery({
    queryKey: qk.activity(kind),
    queryFn: () => apiGet<{ events: Activity[] }>("/api/activity", { limit: 100, kind: kind ?? undefined }),
    placeholderData: keepPreviousData,
  });
}

export function useAlerts() {
  return useQuery({ queryKey: qk.alerts(), queryFn: () => apiGet<{ alerts: Alert[] }>("/api/alerts", { limit: 50 }) });
}

export interface BrainInfo { provider: string; model: string; calls?: number; errors?: number; images?: number; [k: string]: unknown }

export function useBrain() {
  return useQuery({ queryKey: ["brain"], queryFn: () => apiGet<BrainInfo>("/api/brain"), refetchInterval: 30000, staleTime: 15000 });
}

export function useLogs(agent?: number | null) {
  return useQuery({
    queryKey: qk.logs(agent),
    queryFn: () => apiGet<{ logs: BrainLog[] }>("/api/logs", { limit: 200, agent: agent ?? undefined }),
    staleTime: Infinity,
  });
}

export function useMyAgents(owner: string | null | undefined) {
  return useQuery({
    queryKey: qk.me(owner || "none"),
    queryFn: () => apiGet<{ agents: Agent[] }>("/api/agents", { owner: owner!, sort: "new" }),
    enabled: !!owner,
    refetchInterval: 15000,
  });
}

export function useSite(address: string) {
  return useQuery({
    queryKey: ["site", address.toLowerCase()],
    queryFn: () => apiGet<SiteDetail>(`/api/coins/${encodeURIComponent(address)}/site`),
    refetchInterval: 30000,
    retry: (n, e) => (e as { status?: number })?.status !== 404 && n < 2,
  });
}

export function useSites() {
  return useQuery({ queryKey: ["sites"], queryFn: () => apiGet<SiteList>("/api/sites", { limit: 60 }), refetchInterval: 60000 });
}
