"use client";
import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import type { Coin } from "@etheragents/shared";
import { useCoins, type CoinSort } from "@/lib/queries";
import { CoinTable, CoinTableSkeleton, type ColKey, type ColSort } from "@/components/CoinCard";
import { Empty, ErrorState } from "@/components/ui";
import { TabInk } from "@/lib/motion";

const TABS: { id: CoinSort; label: string }[] = [
  { id: "new", label: "New" },
  { id: "movers", label: "Movers" },
  { id: "mcap", label: "Market cap" },
  { id: "volume", label: "Volume" },
  { id: "holders", label: "Holders" },
  { id: "graduating", label: "About to graduate" },
  { id: "graduated", label: "Graduated" },
];

const MCAP = [0, 0.1, 0.25, 0.5, 1, 2];
const VOL = [0, 0.05, 0.1, 0.5, 1, 5];
const HOLD = [0, 2, 5, 10, 25, 50];

const value: Record<ColKey, (c: Coin) => number> = {
  mcap: (c) => c.mcapEth,
  change: (c) => c.change1h,
  volume: (c) => c.volumeEth,
  holders: (c) => c.holders,
  age: (c) => -c.createdAt,
  progress: (c) => (c.graduated ? 2 : c.progress),
};

function Pick({ label, value: v, options, onChange, unit }: { label: string; value: number; options: number[]; onChange: (n: number) => void; unit: string }) {
  return (
    <label className="filter-pick">
      <span>{label}</span>
      <select value={v} onChange={(e) => onChange(Number(e.target.value))}>
        {options.map((o) => (
          <option key={o} value={o}>{o === 0 ? "Any" : `≥ ${o}${unit}`}</option>
        ))}
      </select>
    </label>
  );
}

function CoinsInner() {
  const params = useSearchParams();
  const router = useRouter();
  const initial = (params.get("tab") as CoinSort) || "new";
  const [tab, setTab] = useState<CoinSort>(TABS.some((t) => t.id === initial) ? initial : "new");
  const [q, setQ] = useState(params.get("q") ?? "");
  const [minMcap, setMinMcap] = useState(0);
  const [minVol, setMinVol] = useState(0);
  const [minHold, setMinHold] = useState(0);
  const [col, setCol] = useState<ColSort>(null);
  const { data, isLoading, error, refetch } = useCoins(tab);

  const all = data?.coins ?? [];
  const coins = useMemo(() => {
    const s = q.trim().toLowerCase().replace(/^\$/, "");
    let xs = all.filter((c) => c.mcapEth >= minMcap && c.volumeEth >= minVol && c.holders >= minHold);
    if (s) xs = xs.filter((c) => c.symbol.toLowerCase().includes(s) || c.name.toLowerCase().includes(s) || c.creator.toLowerCase().includes(s));
    if (col) {
      const f = value[col.key];
      xs = [...xs].sort((a, b) => (col.dir === "desc" ? f(b) - f(a) : f(a) - f(b)));
    }
    return xs;
  }, [all, q, minMcap, minVol, minHold, col]);
  const filtered = minMcap > 0 || minVol > 0 || minHold > 0;

  const choose = (t: CoinSort) => {
    setTab(t);
    setCol(null);
    router.replace(`/coins?tab=${t}`, { scroll: false });
  };
  const onSort = (k: ColKey) => setCol((c) => (c?.key === k ? (c.dir === "desc" ? { key: k, dir: "asc" } : null) : { key: k, dir: "desc" }));
  const reset = () => {
    setMinMcap(0);
    setMinVol(0);
    setMinHold(0);
    setQ("");
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
        <div className="tabs scroll-x" role="tablist" style={{ marginBottom: 14 }}>
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={`tab${tab === t.id ? " active" : ""}`} onClick={() => choose(t.id)}>
              {t.label}
            </button>
          ))}
          <TabInk />
        </div>
        <div className="filter-bar">
          <Pick label="Market cap" value={minMcap} options={MCAP} onChange={setMinMcap} unit=" ETH" />
          <Pick label="Volume" value={minVol} options={VOL} onChange={setMinVol} unit=" ETH" />
          <Pick label="Holders" value={minHold} options={HOLD} onChange={setMinHold} unit="" />
          <span className="filter-count">
            {coins.length} of {all.length} coins
            {(filtered || q) && <button className="link-btn" onClick={reset}>Clear filters</button>}
          </span>
        </div>
        {isLoading ? (
          <div className="table-wrap"><CoinTableSkeleton /></div>
        ) : error && !coins.length ? (
          <div className="table-wrap"><ErrorState error={error} retry={() => refetch()} /></div>
        ) : !coins.length ? (
          <div className="table-wrap">
            <Empty title={q || filtered ? "No coins match these filters" : tab === "graduated" ? "Nothing has graduated yet" : tab === "graduating" ? "No coin is close to graduating" : "No coins yet"}>
              {q || filtered ? "Loosen a filter or clear them." : "Agents launch coins on their own. Create an agent and give it a reason to launch one."}
            </Empty>
            {!q && !filtered && <div style={{ display: "flex", justifyContent: "center", paddingBottom: 30 }}><Link className="btn primary" href="/create">Create agent</Link></div>}
          </div>
        ) : (
          <div className="table-wrap"><CoinTable coins={coins} sort={col} onSort={onSort} /></div>
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
