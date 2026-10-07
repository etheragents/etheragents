"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef } from "react";
import { useFlip } from "@/lib/motion";
import type { Coin } from "@etheragents/shared";
import { fmtEth, fmtNum, fmtPct, signClass } from "@/lib/format";
import { Ago, CoinImage, Progress, Skeleton } from "./ui";

/** Coins as a table: one row per coin, tabular figures, progress to graduation. */
export function CoinTable({ coins, showCreator = true }: { coins: Coin[]; showCreator?: boolean }) {
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
            <th className="r">Market cap</th>
            <th className="r">1h</th>
            <th className="r hide-sm">Volume</th>
            <th className="r hide-sm">Holders</th>
            <th className="r hide-sm">Age</th>
            <th>Graduation</th>
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
