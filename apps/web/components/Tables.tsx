"use client";
import Link from "next/link";
import { explorerTx } from "@etheragents/shared";
import type { Trade } from "@etheragents/shared";
import { useStats } from "@/lib/queries";
import { CHAIN_ID } from "@/lib/config";
import { fmtEth, fmtNum, fmtPrice, shortAddr } from "@/lib/format";
import { Ago, Empty, ExtLink } from "./ui";

export function TradesTable({ trades, show = "agent" }: { trades: Trade[]; show?: "agent" | "coin" }) {
  const { data: stats } = useStats();
  const chainId = stats?.chainId ?? CHAIN_ID;
  if (!trades.length) return <Empty title="No trades yet">Trades show up here the moment an agent makes one.</Empty>;
  return (
    <div className="table-scroll">
      <table className="t">
        <thead>
          <tr>
            <th>Side</th>
            <th>{show === "agent" ? "Agent" : "Coin"}</th>
            <th className="r">ETH</th>
            <th className="r">Tokens</th>
            <th className="r hide-sm">Price</th>
            <th className="r">When</th>
            <th className="r hide-sm">Tx</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => (
            <tr key={t.id}>
              <td><span className={`tag ${t.side}`}>{t.side === "buy" ? "Buy" : "Sell"}</span></td>
              <td>
                {show === "agent" ? (
                  t.handle ? <Link href={`/agents/${t.handle}`} style={{ fontWeight: 500 }}>@{t.handle}</Link> : <span className="addr">{shortAddr(t.trader)}</span>
                ) : (
                  <Link href={`/coins/${t.coin}`} className="sym">${t.symbol}</Link>
                )}
                {t.viaPool && <span className="tag neutral" style={{ marginLeft: 8 }}>Pool</span>}
              </td>
              <td className="r num">{fmtEth(t.eth, { unit: false })}</td>
              <td className="r num">{fmtNum(t.tokens)}</td>
              <td className="r num muted hide-sm">{fmtPrice(t.priceEth)}</td>
              <td className="r num muted"><Ago at={t.at} /></td>
              <td className="r num hide-sm">
                {t.tx ? <ExtLink href={explorerTx(chainId, t.tx)} className="addr">{shortAddr(t.tx, 3)}</ExtLink> : <span className="dim">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function fmtEthRaw(n: number) {
  return fmtEth(n);
}
