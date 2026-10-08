"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef } from "react";
import { useFlip } from "@/lib/motion";
import type { Coin } from "@etheragents/shared";
import { fmtEth, fmtNum, fmtPct, signClass } from "@/lib/format";
import { Ago, CoinImage, Progress, Skeleton } from "./ui";

/** Coins as a table: one row per coin, tabular figures, progress to graduation. */
export type ColKey = "mcap" | "change" | "volume" | "holders" | "age" | "progress";
export type ColSort = { key: ColKey; dir: "desc" | "asc" } | null;

function SortTh({ k, label, sort, onSort, className = "r" }: { k: ColKey; label: string; sort?: ColSort; onSort?: (k: ColKey) => void; className?: string }) {
  if (!onSort) return <th className={className}>{label}</th>;
  const on = sort?.key === k;
  return (
    <th className={className} aria-sort={on ? (sort!.dir === "desc" ? "descending" : "ascending") : "none"}>
      <button className={`th-sort${on ? " on" : ""}`} onClick={() => onSort(k)}>
        {label}
        <span className="arr" aria-hidden>{on ? (sort!.dir === "desc" ? "↓" : "↑") : "↕"}</span>
      </button>
    </th>
  );
}

export function CoinTable({ coins, showCreator = true, sort, onSort }: { coins: Coin[]; showCreator?: boolean; sort?: ColSort; onSort?: (k: ColKey) => void }) {
  const router = useRouter();
  const tbody = useRef<HTMLTableSectionElement>(null);
  useFlip(tbody, coins.map((c) => c.address));
  return (
    <div className="table-scroll">
      <table className="t">
        <thead>
          <tr>
            <th>Coin</th>
            {showCreator && <th className="hide-sm">Creator</th>}
            <SortTh k="mcap" label="Market cap" sort={sort} onSort={onSort} />
            <SortTh k="change" label="1h" sort={sort} onSort={onSort} />
            <SortTh k="volume" label="Volume" sort={sort} onSort={onSort} className="r hide-sm" />
            <SortTh k="holders" label="Holders" sort={sort} onSort={onSort} className="r hide-sm" />
            <SortTh k="age" label="Age" sort={sort} onSort={onSort} className="r hide-sm" />
            <SortTh k="progress" label="Graduation" sort={sort} onSort={onSort} className="" />
          </tr>
        </thead>
        <tbody ref={tbody}>
          {coins.map((c) => (
            <tr key={c.address} data-flip={c.address} className="click" onClick={() => router.push(`/coins/${c.address}`)}>
              <td>
                <Link href={`/coins/${c.address}`} className="coin-cell" onClick={(e) => e.stopPropagation()}>
                  <CoinImage image={c.image} address={c.address} size={32} alt={c.symbol} />
                  <span style={{ minWidth: 0 }}>
                    <span className="n" style={{ display: "block" }}>{c.name}</span>
                    <span className="s">${c.symbol}</span>
                  </span>
                </Link>
              </td>
              {showCreator && (
                <td className="hide-sm">
                  <Link href={`/agents/${c.creator}`} className="muted" onClick={(e) => e.stopPropagation()} style={{ fontSize: 13.5 }}>@{c.creator}</Link>
                </td>
              )}
              <td className="r num">{fmtEth(c.mcapEth)}</td>
              <td className={`r num ${signClass(c.change1h)}`}>{fmtPct(c.change1h)}</td>
              <td className="r num muted hide-sm">{fmtEth(c.volumeEth)}</td>
              <td className="r num muted hide-sm">{fmtNum(c.holders)}</td>
              <td className="r num muted hide-sm"><Ago at={c.createdAt} /></td>
              <td className="prog-cell">
                <div className="prog-row">
                  <Progress value={c.graduated ? 1 : c.progress} />
                  <span className={c.graduated ? "up" : undefined}>{c.graduated ? "Done" : `${Math.floor(c.progress * 100)}%`}</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CoinTableSkeleton({ n = 8 }: { n?: number }) {
  return (
    <div style={{ padding: "12px 20px", display: "flex", flexDirection: "column", gap: 0 }} aria-hidden>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="row" style={{ gap: 12, padding: "10px 0", borderBottom: i < n - 1 ? "1px solid var(--line)" : 0 }}>
          <Skeleton w={32} h={32} r={16} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
            <Skeleton w="30%" h={12} />
            <Skeleton w="14%" h={10} />
          </div>
          <Skeleton w={80} h={12} />
          <Skeleton w={120} h={4} />
        </div>
      ))}
    </div>
  );
}
