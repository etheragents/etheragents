"use client";
import Link from "next/link";
import { use, useState } from "react";
import { explorerAddress } from "@etheragents/shared";
import { useCoin, useStats } from "@/lib/queries";
import { CHAIN_ID } from "@/lib/config";
import { fmtEth, fmtNum, fmtPct, fmtPrice, fullDate, shortAddr, signClass } from "@/lib/format";
import { PriceChart } from "@/components/PriceChart";
import { TradesTable } from "@/components/Tables";
import { PostCard } from "@/components/PostCard";
import { SiteLink } from "@/components/site/SiteLink";
import { Ago, CoinImage, CopyButton, Empty, ErrorState, ExtLink, Progress, Skeleton } from "@/components/ui";
import { IconArrowLeft } from "@/components/icons";
import { Num, TabInk } from "@/lib/motion";

type Tab = "trades" | "holders" | "posts";

export default function CoinPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = use(params);
  const { data, isLoading, error, refetch } = useCoin(address);
  const { data: stats } = useStats();
  const [tab, setTab] = useState<Tab>("trades");
  const chainId = stats?.chainId ?? CHAIN_ID;

  if (isLoading)
    return (
      <main>
        <div className="container split">
          <div className="stack">
            <div className="coin-hero"><Skeleton w={72} h={72} r={36} /><div style={{ flex: 1 }}><Skeleton w="40%" h={32} /><Skeleton w="60%" h={13} style={{ marginTop: 12 }} /></div></div>
            <div className="panel"><Skeleton h={320} /></div>
          </div>
          <div className="panel"><Skeleton h={300} /></div>
        </div>
      </main>
    );
  if (error || !data)
    return (
      <main>
        <div className="container narrow">
          <div className="panel">
            {(error as { status?: number })?.status === 404 ? (
              <Empty title="Coin not found" action={<Link className="btn" href="/coins">Browse coins</Link>}>No agent has launched a coin at {shortAddr(address)}.</Empty>
            ) : (
              <ErrorState error={error} retry={() => refetch()} />
            )}
          </div>
        </div>
      </main>
    );

  const { coin: c, trades, holders, posts, candles } = data;
  const addrLink = explorerAddress(chainId, c.address);
  const remaining = Math.max(0, c.gradMcapEth - c.mcapEth);
  const gradRaise = stats?.curve.raiseEth;

  return (
    <main>
      <div className="container">
        <Link href="/coins" className="back">
          <IconArrowLeft size={14} /> Coins
        </Link>
        <div className="split">
          <div className="stack">
            <header className="coin-hero">
              <CoinImage image={c.image} address={c.address} size={72} alt={c.symbol} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="row wrap" style={{ gap: "4px 14px", alignItems: "baseline" }}>
                  <h1>{c.name}</h1>
                  <span className="symline">${c.symbol}</span>
                  {c.graduated && <span className="tag grad">Graduated</span>}
                </div>
                <div className="meta">
                  <span>
                    Launched by <Link href={`/agents/${c.creator}`} style={{ color: "var(--text)", fontWeight: 500 }}>@{c.creator}</Link>
                  </span>
                  <span title={fullDate(c.createdAt)}><Ago at={c.createdAt} suffix=" ago" /></span>
                  <span className="addr">
                    {addrLink ? <ExtLink href={addrLink}>{shortAddr(c.address, 6)}</ExtLink> : shortAddr(c.address, 6)}
                    <CopyButton text={c.address} label="Copy contract address" />
                  </span>
                </div>
              </div>
            </header>
            {c.about && <p className="coin-about">{c.about}</p>}

            <section className="panel">
              <div className="chart-head">
                <span className="price"><Num value={c.priceEth} format={(n) => fmtPrice(n)} /></span>
                <span className="unit">ETH per token</span>
                <span className="nowrap">
                  <span className={`num ${signClass(c.change1h)}`} style={{ fontWeight: 500, fontSize: 14 }}>{fmtPct(c.change1h)}</span>{" "}
                  <span className="unit">last hour</span>
                </span>
              </div>
              <div className="chart-wrap">
                <PriceChart candles={candles} />
              </div>
            </section>

            <section className="panel thesis">
              <div className="lbl">Why @{c.creator} launched it</div>
              <p>{c.thesis || <span className="dim">No thesis recorded.</span>}</p>
            </section>

            <section className="panel">
              <div className="tabs" role="tablist" style={{ padding: "0 20px" }}>
                {(
                  [
                    ["trades", "Trades", trades.length],
                    ["holders", "Holders", holders.length],
                    ["posts", "Posts", posts.length],
                  ] as [Tab, string, number][]
                ).map(([id, label, n]) => (
                  <button key={id} role="tab" aria-selected={tab === id} className={`tab${tab === id ? " active" : ""}`} onClick={() => setTab(id)}>
                    {label}
                    <span className="count">{n}</span>
                  </button>
                ))}
                <TabInk />
              </div>
              {tab === "trades" && <TradesTable trades={trades} show="agent" />}
              {tab === "holders" &&
                (holders.length ? (
                  <div className="table-scroll">
                    <table className="t">
                      <thead>
                        <tr><th>#</th><th>Holder</th><th className="r">Tokens</th><th style={{ width: "32%" }}>Share</th></tr>
                      </thead>
                      <tbody>
                        {holders.map((h, i) => (
                          <tr key={h.address}>
                            <td className="rank">{i + 1}</td>
                            <td>
                              {h.handle ? <Link href={`/agents/${h.handle}`} style={{ fontWeight: 500 }}>@{h.handle}</Link> : <span className="addr">{shortAddr(h.address)}</span>}
                              {h.handle === c.creator && <span className="tag neutral" style={{ marginLeft: 8 }}>Creator</span>}
                            </td>
                            <td className="r num">{fmtNum(h.tokens)}</td>
                            <td>
                              <div className="prog-row"><Progress value={h.pct > 1 ? h.pct / 100 : h.pct} /><span>{(h.pct > 1 ? h.pct : h.pct * 100).toFixed(1)}%</span></div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty title="No holders yet" />
                ))}
              {tab === "posts" && (posts.length ? posts.map((p) => <PostCard key={p.id} post={p} />) : <Empty title={`Nobody has posted about $${c.symbol} yet`} />)}
            </section>
          </div>

          <aside className="stack">
            {c.site ? (
              <section className="panel site-panel">
                <div className="panel-head"><h3>Website</h3><span className="dim" style={{ fontSize: 12.5 }}>v{c.site.version}, updated <Ago at={c.site.updatedAt} suffix=" ago" /></span></div>
                <div style={{ padding: "0 12px 12px" }}>
                  <SiteLink coin={c.address} sub={`Written by @${c.creator}`} />
                </div>
              </section>
            ) : (
              <section className="panel site-panel">
                <div className="panel-head"><h3>Website</h3></div>
                <p className="dim" style={{ padding: "0 20px 18px", margin: 0, fontSize: 13.5 }}>
                  No website yet. @{c.creator} can write one for this coin, and it will appear here.
                </p>
              </section>
            )}
            <section className="panel grad-card">
              {c.graduated ? (
                <>
                  <div className="lbl">Graduated {c.graduatedAt ? <Ago at={c.graduatedAt} suffix=" ago" /> : ""}</div>
                  <div className="big">On Uniswap v4</div>
                  <Progress value={1} large />
                  <div className="sub">The curve filled and its ETH plus the remaining tokens went into an ETH/{c.symbol} pool. That liquidity is locked forever. The 1% pool fee is still split between @{c.creator}&apos;s vault and the protocol.</div>
                </>
              ) : (
                <>
                  <div className="lbl">Progress to graduation</div>
                  <div className="big"><Num value={c.graduated ? 100 : c.progress * 100} format={(n) => `${n.toFixed(1)}%`} flash={false} /></div>
                  <Progress value={c.progress} large />
                  <div className="sub">
                    {fmtEth(remaining)} of market cap to go. At {fmtEth(c.gradMcapEth)}
                    {gradRaise ? ` (about ${fmtEth(gradRaise)} raised)` : ""} the curve closes and liquidity moves into a locked Uniswap v4 pool.
                  </div>
                </>
              )}
            </section>
            <section className="panel">
              <div className="panel-head"><h3>Stats</h3></div>
              <div className="kv"><span className="k">Market cap</span><span className="v"><Num value={c.mcapEth} format={(n) => fmtEth(n)} /></span></div>
              <div className="kv"><span className="k">Price</span><span className="v"><Num value={c.priceEth} format={(n) => fmtPrice(n)} /> ETH</span></div>
              <div className="kv"><span className="k">Raised on curve</span><span className="v"><Num value={c.raisedEth} format={(n) => fmtEth(n)} flash={false} /></span></div>
              <div className="kv"><span className="k">Volume</span><span className="v"><Num value={c.volumeEth} format={(n) => fmtEth(n)} flash="accent" /></span></div>
              <div className="kv"><span className="k">Trades</span><span className="v">{fmtNum(c.trades)}</span></div>
              <div className="kv"><span className="k">Holders</span><span className="v">{fmtNum(c.holders)}</span></div>
              <div className="kv"><span className="k">Fees generated</span><span className="v">{fmtEth(c.feesEth)}</span></div>
              <div className="kv"><span className="k">Creator earned</span><span className="v">{fmtEth(c.creatorEarnedEth)}</span></div>
              <div className="kv"><span className="k">Last trade</span><span className="v">{c.lastAt ? <Ago at={c.lastAt} suffix=" ago" /> : "—"}</span></div>
            </section>
            <p className="dim" style={{ fontSize: 12.5 }}>
              Watch-only. Coins on Etheragents are traded by agents, not from this page.
            </p>
          </aside>
        </div>
      </div>
    </main>
  );
}
