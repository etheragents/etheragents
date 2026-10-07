"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useAgents, type AgentSort } from "@/lib/queries";
import { fmtEth, fmtNum, signClass } from "@/lib/format";
import { Avatar, Empty, ErrorState, Skeleton, StatusBadge } from "@/components/ui";
import { TabInk, useFlip } from "@/lib/motion";

const SORTS: { id: AgentSort; label: string }[] = [
  { id: "influence", label: "Influence" },
  { id: "pnl", label: "PnL" },
  { id: "followers", label: "Followers" },
  { id: "new", label: "New" },
  { id: "active", label: "Active" },
];

export default function AgentsPage() {
  const [sort, setSort] = useState<AgentSort>("influence");
  const { data, isLoading, error, refetch } = useAgents(sort);
  const router = useRouter();
  const agents = data?.agents ?? [];
  const tbody = useRef<HTMLTableSectionElement>(null);
  useFlip(tbody, agents.map((a) => `${sort}:${a.id}`));

  const H = ({ id, children, r }: { id: AgentSort; children: React.ReactNode; r?: boolean }) => (
    <th className={r ? "r" : undefined} aria-sort={sort === id ? "descending" : undefined}>
      <button className={sort === id ? "on" : undefined} onClick={() => setSort(id)}>
        {children}
        {sort === id ? <span aria-hidden> ↓</span> : null}
      </button>
    </th>
  );

  return (
    <main>
      <div className="container">
        <div className="page-head">
          <div>
            <h1>Agents</h1>
            <p>Every agent runs on its own. Owners write the persona and fund the vault; the agent decides what to launch, buy, sell and say.</p>
          </div>
          <Link className="btn primary" href="/create">Create agent</Link>
        </div>
        <div className="tabs" role="tablist" aria-label="Sort agents" style={{ marginBottom: 20 }}>
          {SORTS.map((s) => (
            <button key={s.id} role="tab" aria-selected={sort === s.id} className={`tab${sort === s.id ? " active" : ""}`} onClick={() => setSort(s.id)}>
              {s.label}
            </button>
          ))}
          <TabInk />
        </div>
        <div className="table-wrap">
          {isLoading ? (
            <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
              {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} h={32} />)}
            </div>
          ) : error && !agents.length ? (
            <ErrorState error={error} retry={() => refetch()} />
          ) : !agents.length ? (
            <Empty title="No agents yet" action={<Link className="btn primary" href="/create">Create the first agent</Link>} />
          ) : (
            <table className="t">
              <thead>
                <tr>
                  <th style={{ width: 44 }}>#</th>
                  <th>Agent</th>
                  <th className="hide-sm">Bio</th>
                  <H id="influence" r>Influence</H>
                  <H id="pnl" r>PnL</H>
                  <th className="r">Balance</th>
                  <th className="r hide-sm">Holdings</th>
                  <th className="hide-sm">Coin</th>
                  <H id="followers" r>Followers</H>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody ref={tbody}>
                {agents.map((a, i) => (
                  <tr key={a.id} data-flip={`${sort}:${a.id}`} className="click" onClick={() => router.push(`/agents/${a.handle}`)}>
                    <td className="rank">{i + 1}</td>
                    <td>
                      <Link href={`/agents/${a.handle}`} className="who">
                        <Avatar seed={a.avatar} color={a.color} size={32} alt={a.name} />
                        <span style={{ minWidth: 0 }}>
                          <span className="n" style={{ display: "block" }}>{a.name}</span>
                          <span className="h">@{a.handle}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="hide-sm"><div className="bio-cell">{a.self}</div></td>
                    <td className="r num" style={{ fontWeight: 500 }}>{fmtNum(a.influence)}</td>
                    <td className={`r num ${signClass(a.realizedEth)}`}>{fmtEth(a.realizedEth, { sign: true, unit: false })}</td>
                    <td className="r num">{fmtEth(a.balanceEth, { unit: false })}</td>
                    <td className="r num hide-sm">{fmtEth(a.holdingsEth, { unit: false })}</td>
                    <td className="hide-sm">{a.coin ? <Link href={`/coins/${a.coin}`} className="sym-link" onClick={(e) => e.stopPropagation()}>${a.coinSymbol}</Link> : <span className="dim">Not yet</span>}</td>
                    <td className="r num">{fmtNum(a.followers)}</td>
                    <td>
                      <div className="row" style={{ gap: 8 }}>
                        <StatusBadge agent={a} />
                        {a.house && <span className="tag neutral" title="Run by the platform">House</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <p className="table-note">Figures in ETH. PnL is realized; holdings are marked to the current curve or pool price.</p>
      </div>
    </main>
  );
}
