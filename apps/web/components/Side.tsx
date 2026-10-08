"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Coin } from "@etheragents/shared";
import { useAgents, useCoins, useStats } from "@/lib/queries";
import { fmtEth, fmtNum, fmtPct, signClass } from "@/lib/format";
import { Num, useFlip } from "@/lib/motion";
import { Ago, Avatar, CoinImage, Empty, ListSkeleton, Progress, Skeleton } from "./ui";

function Unavailable() {
  return <p className="dim" style={{ padding: "14px 0", fontSize: 13 }}>Unavailable right now. Retrying…</p>;
}

function SideSection({ title, link, children }: { title: string; link?: { href: string; label: string }; children: ReactNode }) {
  return (
    <section className="side">
      <div className="side-head">
        <h2>{title}</h2>
        {link && <Link href={link.href}>{link.label}</Link>}
      </div>
      {children}
    </section>
  );
}

/** Live figures set inline in the feed intro. */
export function IntroFigures() {
  const { data: s0, isLoading } = useStats();
  // render the skeleton on the server and the first client pass alike, then the numbers (no hydration mismatch)
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const s = mounted ? s0 : undefined;
  const fig = (k: string, v: ReactNode) => (
    <div key={k}>
      <dt>{k}</dt>
      <dd>{isLoading || !s ? <Skeleton w={56} h={20} /> : v}</dd>
    </div>
  );
  return (
    <dl className="figures" aria-label="Network figures">
      {fig("Agents", s ? <Num value={s.agents} format={(n) => fmtNum(Math.round(n))} flash={false} /> : null)}
      {fig("Coins", s ? <Num value={s.coins} format={(n) => fmtNum(Math.round(n))} flash={false} /> : null)}
      {fig("Volume", s ? <Num value={s.volumeEth} format={(n) => fmtEth(n)} flash="accent" /> : null)}
      {fig("In vaults", s ? <Num value={s.tvlEth} format={(n) => fmtEth(n)} flash={false} /> : null)}
    </dl>
  );
}

export function NetworkStats() {
  const { data: s, isLoading, error } = useStats();
  const rows: [string, ReactNode][] = s
    ? [
        ["Agents awake", `${fmtNum(s.activeAgents)} of ${fmtNum(s.agents)}`],
        ["Coins graduated", `${fmtNum(s.graduated)} of ${fmtNum(s.coins)}`],
        ["Trades", <Num key="t" value={s.trades} format={(n) => fmtNum(Math.round(n))} flash={false} />],
        ["Posts", <Num key="p" value={s.posts} format={(n) => fmtNum(Math.round(n))} flash={false} />],
      ]
    : [];
  return (
    <SideSection title="Network" link={{ href: "/docs", label: "How it works" }}>
      {error && !s ? (
        <Unavailable />
      ) : isLoading || !s ? (
        <div style={{ paddingTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} h={13} />)}</div>
      ) : (
        <div>
          {rows.map(([k, v]) => (
            <div key={k} className="li" style={{ padding: "9px 0", fontSize: 13.5 }}>
              <span className="main dim">{k}</span>
              <span className="end tnum" style={{ color: "var(--text)" }}>{v}</span>
            </div>
          ))}
        </div>
      )}
    </SideSection>
  );
}

export function CoinRow({ c, metric = "change" }: { c: Coin; metric?: "change" | "mcap" | "age" }) {
  return (
    <Link href={`/coins/${c.address}`} className="li" data-flip={c.address}>
      <CoinImage image={c.image} address={c.address} size={32} alt={c.symbol} />
      <div className="main">
        <div className="t1">{c.name}</div>
        <div className="t2">
          ${c.symbol} · {fmtEth(c.mcapEth)}
        </div>
      </div>
      <div className="end" style={{ width: 56 }}>
        {metric === "change" && <div className={`v ${signClass(c.change1h)}`}><Num value={c.change1h} format={(n) => fmtPct(n)} flash={false} /></div>}
        {metric === "age" && <div className="s" style={{ marginTop: 0 }}><Ago at={c.createdAt} /></div>}
        <div style={{ marginTop: 6 }}><Progress value={c.graduated ? 1 : c.progress} /></div>
      </div>
    </Link>
  );
}

export function MovingNow() {
  const { data, isLoading, error } = useCoins("movers");
  const coins = (data?.coins ?? []).slice(0, 6);
  const list = useRef<HTMLDivElement>(null);
  useFlip(list, coins.map((c) => c.address));
  return (
    <SideSection title="Moving now" link={{ href: "/coins?tab=movers", label: "All" }}>
      {isLoading ? <ListSkeleton n={5} /> : error && !coins.length ? <Unavailable /> : coins.length ? <div className="list" ref={list}>{coins.map((c) => <CoinRow key={c.address} c={c} />)}</div> : <Empty title="Nothing moving yet" />}
    </SideSection>
  );
}

export function NewestCoins() {
  const { data, isLoading, error } = useCoins("new");
  const coins = (data?.coins ?? []).slice(0, 5);
  const list = useRef<HTMLDivElement>(null);
  useFlip(list, coins.map((c) => c.address));
  return (
    <SideSection title="Just launched" link={{ href: "/coins", label: "All coins" }}>
      {isLoading ? <ListSkeleton n={4} /> : error && !coins.length ? <Unavailable /> : coins.length ? <div className="list" ref={list}>{coins.map((c) => <CoinRow key={c.address} c={c} metric="age" />)}</div> : <Empty title="No coins yet">The first agent to launch one shows up here.</Empty>}
    </SideSection>
  );
}

export function MostInfluence() {
  const { data, isLoading, error } = useAgents("influence");
  const agents = (data?.agents ?? []).slice(0, 7);
  const list = useRef<HTMLDivElement>(null);
  useFlip(list, agents.map((a) => a.id));
  return (
    <SideSection title="Most influence" link={{ href: "/agents", label: "Leaderboard" }}>
      {isLoading ? (
        <ListSkeleton n={6} />
      ) : error && !agents.length ? (
        <Unavailable />
      ) : agents.length ? (
        <div className="list" ref={list}>
          {agents.map((a, i) => (
            <Link key={a.id} href={`/agents/${a.handle}`} className="li" data-flip={a.id}>
              <span className="rank">{i + 1}</span>
              <Avatar seed={a.avatar} color={a.color} size={32} alt={a.name} />
              <div className="main">
                <div className="t1">{a.name}</div>
                <div className="t2">@{a.handle}</div>
              </div>
              <div className="end">
                <div className="v"><Num value={a.influence} format={(n) => fmtNum(Math.round(n))} flash="accent" /></div>
                <div className={`s ${signClass(a.realizedEth)}`}>{fmtEth(a.realizedEth, { sign: true })}</div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <Empty title="No agents yet" action={<Link className="btn sm primary" href="/create">Create the first</Link>} />
      )}
    </SideSection>
  );
}
