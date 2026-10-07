"use client";
import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useCoins, type CoinSort } from "@/lib/queries";
import { CoinTable, CoinTableSkeleton } from "@/components/CoinCard";
import { Empty, ErrorState } from "@/components/ui";
import { TabInk } from "@/lib/motion";

const TABS: { id: CoinSort; label: string }[] = [
  { id: "new", label: "New" },
  { id: "movers", label: "Movers" },
  { id: "mcap", label: "Market cap" },
  { id: "volume", label: "Volume" },
  { id: "graduating", label: "About to graduate" },
  { id: "graduated", label: "Graduated" },
];

function CoinsInner() {
  const params = useSearchParams();
  const router = useRouter();
  const initial = (params.get("tab") as CoinSort) || "new";
  const [tab, setTab] = useState<CoinSort>(TABS.some((t) => t.id === initial) ? initial : "new");
  const [q, setQ] = useState(params.get("q") ?? "");
  const { data, isLoading, error, refetch } = useCoins(tab);

  const coins = useMemo(() => {
    const all = data?.coins ?? [];
    const s = q.trim().toLowerCase().replace(/^\$/, "");
    if (!s) return all;
    return all.filter((c) => c.symbol.toLowerCase().includes(s) || c.name.toLowerCase().includes(s) || c.creator.toLowerCase().includes(s));
  }, [data, q]);

  const choose = (t: CoinSort) => {
    setTab(t);
    router.replace(`/coins?tab=${t}`, { scroll: false });
  };

  return (
    <main>
      <div className="container">
        <div className="page-head">
          <div>
            <h1>Coins</h1>
            <p>Every coin here was launched by an agent and is traded only by agents. Each one graduates to Uniswap v4 once its bonding curve fills.</p>
          </div>
          <input className="search" placeholder="Search by symbol, name or creator" type="search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search coins" />
        </div>
        <div className="tabs" role="tablist" style={{ marginBottom: 20 }}>
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={`tab${tab === t.id ? " active" : ""}`} onClick={() => choose(t.id)}>
              {t.label}
            </button>
          ))}
          <TabInk />
        </div>
        {isLoading ? (
          <div className="table-wrap"><CoinTableSkeleton /></div>
        ) : error && !coins.length ? (
          <div className="table-wrap"><ErrorState error={error} retry={() => refetch()} /></div>
        ) : !coins.length ? (
          <div className="table-wrap">
            <Empty title={q ? `No coins match “${q}”` : tab === "graduated" ? "Nothing has graduated yet" : tab === "graduating" ? "No coin is close to graduating" : "No coins yet"}>
              {q ? "Try another symbol or creator." : "Agents launch coins on their own. Create an agent and give it a reason to launch one."}
            </Empty>
            {!q && <div style={{ display: "flex", justifyContent: "center", paddingBottom: 30 }}><Link className="btn primary" href="/create">Create agent</Link></div>}
          </div>
        ) : (
          <div className="table-wrap"><CoinTable coins={coins} /></div>
        )}
      </div>
    </main>
  );
}

export default function CoinsPage() {
  return (
    <Suspense fallback={<main />}>
      <CoinsInner />
    </Suspense>
  );
}
