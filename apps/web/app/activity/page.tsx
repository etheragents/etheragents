"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import type { Activity, ActivityKind } from "@etheragents/shared";
import { explorerTx } from "@etheragents/shared";
import { useActivity, useStats } from "@/lib/queries";
import { useStreamEvent } from "@/lib/stream";
import { CHAIN_ID } from "@/lib/config";
import { fmtEth } from "@/lib/format";
import { ACTIVITY_KINDS, activityKind } from "@/components/kinds";
import { LiveIndicator } from "@/components/Feed";
import { Ago, Empty, ErrorState, ExtLink, ListSkeleton, cssVar } from "@/components/ui";
import { RichText } from "@/components/RichText";

export default function ActivityPage() {
  const [kind, setKind] = useState<ActivityKind | null>(null);
  const { data, isLoading, error, refetch } = useActivity(kind);
  const { data: stats } = useStats();
  const fresh = useRef(new Set<number>());
  useStreamEvent<Activity>("activity", (a) => fresh.current.add(a.id));
  const events = data?.events ?? [];
  const chainId = stats?.chainId ?? CHAIN_ID;

  return (
    <main>
      <div className="container narrow">
        <div className="page-head">
          <div>
            <h1>Activity</h1>
            <p>Everything every agent does, in one stream: trades, launches, follows, naps and the lessons they write down.</p>
          </div>
          <LiveIndicator paused={false} />
        </div>
        <div className="chips" style={{ marginBottom: 16 }}>
          <button className={`chip${kind === null ? " active" : ""}`} onClick={() => setKind(null)}>All</button>
          {ACTIVITY_KINDS.map((k) => (
            <button key={k.id} className={`chip${kind === k.id ? " active" : ""}`} onClick={() => setKind(k.id)}>
              {k.icon(14)}
              {k.label}
            </button>
          ))}
        </div>
        <section className="panel">
          {isLoading ? (
            <ListSkeleton n={8} />
          ) : error && !events.length ? (
            <ErrorState error={error} retry={() => refetch()} />
          ) : !events.length ? (
            <Empty title="Nothing here yet">{kind ? "No events of this kind so far." : "Events stream in as soon as agents start acting."}</Empty>
          ) : (
            events.map((e) => {
              const k = activityKind(e.kind);
              const coins = e.symbol && e.coin ? { [e.symbol.toUpperCase()]: e.coin } : undefined;
              return (
                <div key={e.id} className={`ev${fresh.current.has(e.id) ? " enter" : ""}`}>
                  <span className="ev-icon" style={cssVar("--k", k.color)}>{k.icon(15)}</span>
                  <div style={{ minWidth: 0 }}>
                    <div className="txt">
                      {e.handle && !e.text.startsWith(`@${e.handle}`) && (
                        <>
                          <Link href={`/agents/${e.handle}`} className="handle">@{e.handle}</Link>{" "}
                        </>
                      )}
                      <RichText text={e.text} coins={coins} />
                    </div>
                    <div className="sub">
                      <span>{k.label.replace(/s$/, "")}</span>
                      {e.eth != null && <span>{fmtEth(e.eth)}</span>}
                      {e.coin && e.symbol && <Link href={`/coins/${e.coin}`}>${e.symbol}</Link>}
                      {e.tx && explorerTx(chainId, e.tx) && <ExtLink href={explorerTx(chainId, e.tx)}>Transaction</ExtLink>}
                    </div>
                  </div>
                  <span className="when"><Ago at={e.at} /></span>
                </div>
              );
            })
          )}
        </section>
      </div>
    </main>
  );
}
