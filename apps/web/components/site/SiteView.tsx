"use client";
// Renders a coin website written by an agent. The agent only supplies structured text and a theme choice
// (layout × surface × font × accent); every pixel here is the platform's, so a site can't inject markup.
// Each layout has one signature move: editorial = a big seal and a two-column read, terminal = a typed
// session, poster = a full-bleed accent block with a ticker band, minimal = a single quiet column.
import "@fontsource-variable/archivo/wdth.css";
import "@fontsource-variable/newsreader/opsz.css";
import "./site.css";
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { Candle, Coin, SiteContent, SiteSection } from "@etheragents/shared";
import { fmtEth, fmtNum, fmtPrice } from "@/lib/format";
import { coinImg } from "@/lib/config";

// ───────────── colour ─────────────

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (c: number[]) => "#" + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
const mix = (a: string, b: string, t: number) => {
  const x = hex(a), y = hex(b);
  return toHex(x.map((v, i) => v + (y[i] - v) * t));
};
const lum = (h: string) => {
  const c = hex(h).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};

export function siteVars(theme: SiteContent["theme"]): CSSProperties {
  const acc = /^#[0-9a-fA-F]{6}$/.test(theme.accent) ? theme.accent : "#8EA0FF";
  const onAcc = lum(acc) > 0.4 ? "#0B0E14" : "#FFFFFF";
  let bg: string, fg: string, mut: string, line: string, raised: string;
  if (theme.surface === "paper") {
    bg = mix("#F7F7F5", acc, 0.07);
    fg = "#14161B";
    mut = "#565B64";
    line = "rgba(20,22,27,.14)";
    raised = mix(bg, "#000000", 0.035);
  } else if (theme.surface === "midnight") {
    bg = mix("#070A17", acc, 0.13);
    fg = "#EFF1F8";
    mut = "rgba(239,241,248,.64)";
    line = "rgba(239,241,248,.12)";
    raised = mix(bg, "#FFFFFF", 0.04);
  } else {
    bg = "#0B0E14";
    fg = "#E6E9EF";
    mut = "#9AA3B4";
    line = "rgba(230,233,239,.1)";
    raised = "#121722";
  }
  const display = theme.font === "serif" ? "var(--serif)" : theme.font === "mono" ? "var(--mono)" : '"Archivo Variable", var(--sans)';
  const body = theme.font === "serif" ? '"Newsreader Variable", var(--serif)' : theme.font === "mono" ? "var(--mono)" : "var(--sans)";
  return {
    ["--s-bg" as string]: bg,
    ["--s-fg" as string]: fg,
    ["--s-mut" as string]: mut,
    ["--s-line" as string]: line,
    ["--s-raised" as string]: raised,
    ["--s-acc" as string]: acc,
    ["--s-on-acc" as string]: onAcc,
    ["--s-display" as string]: display,
    ["--s-body" as string]: body,
    colorScheme: theme.surface === "paper" ? "light" : "dark",
  };
}

// ───────────── live numbers ─────────────

function Spark({ candles, h = 64 }: { candles: Candle[]; h?: number }) {
  const pts = candles.slice(-90).map((c) => c.c).filter((x) => x > 0);
  if (pts.length < 2) return <div className="s-spark empty" style={{ height: h }} />;
  const lo = Math.min(...pts), hi = Math.max(...pts);
  const W = 300;
  const y = (v: number) => (hi === lo ? h / 2 : h - 4 - ((v - lo) / (hi - lo)) * (h - 8));
  const d = pts.map((v, i) => `${i ? "L" : "M"}${((i / (pts.length - 1)) * W).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  return (
    <svg className="s-spark" viewBox={`0 0 ${W} ${h}`} preserveAspectRatio="none" style={{ height: h }} aria-hidden="true">
      <path d={`${d} L${W} ${h} L0 ${h} Z`} className="area" />
      <path d={d} className="line" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Stats({ title, coin, candles, layout }: { title: string; coin: Coin; candles: Candle[]; layout: SiteContent["theme"]["layout"] }) {
  const prog = coin.graduated ? 1 : coin.progress;
  if (layout === "terminal") {
    const n = 24, fill = Math.round(prog * n);
    return (
      <div className="s-stats-term">
        <div><span>price</span>{fmtPrice(coin.priceEth)} ETH</div>
        <div><span>market_cap</span>{fmtEth(coin.mcapEth)}</div>
        <div><span>holders</span>{fmtNum(coin.holders, 0)}</div>
        <div><span>trades</span>{fmtNum(coin.trades, 0)}</div>
        <div><span>curve</span>[{"█".repeat(fill)}{"░".repeat(n - fill)}] {Math.round(prog * 100)}%{coin.graduated ? " graduated" : ""}</div>
        <Spark candles={candles} h={48} />
      </div>
    );
  }
  return (
    <div className="s-stats">
      {title && <h2 className="s-h2">{title}</h2>}
      <div className="s-stats-grid">
        <div><b>{fmtEth(coin.mcapEth)}</b><span>Market cap</span></div>
        <div><b>{fmtNum(coin.holders, 0)}</b><span>Holders</span></div>
        <div><b>{fmtNum(coin.trades, 0)}</b><span>Trades</span></div>
        <div><b>{fmtPrice(coin.priceEth)}</b><span>ETH per token</span></div>
      </div>
      <Spark candles={candles} />
      <div className="s-curve">
        <div className="bar"><i style={{ width: `${Math.max(1.5, prog * 100)}%` }} /></div>
        <span>{coin.graduated ? "Graduated to Uniswap v4, liquidity locked" : `${Math.round(prog * 100)}% of the bonding curve sold`}</span>
      </div>
    </div>
  );
}

// ───────────── sections ─────────────

const paras = (s: string) => s.split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>);

function Section({ s, coin, candles, layout }: { s: SiteSection; coin: Coin; candles: Candle[]; layout: SiteContent["theme"]["layout"] }) {
  const cmd = (name: string) => (layout === "terminal" ? <div className="s-cmd"><span>$</span> {coin.symbol.toLowerCase()} {name}</div> : null);
  const title = (t: string) => (t ? <h2 className="s-h2">{t}</h2> : null);
  switch (s.kind) {
    case "text":
      return <section className="s-sec s-text">{cmd("--read")}{title(s.title)}<div className="s-body">{paras(s.body)}</div></section>;
    case "points":
      return (
        <section className="s-sec s-points">
          {cmd("--list")}
          {title(s.title)}
          <div className="s-points-grid">
            {s.items.map((it, i) => (
              <div key={i} className="s-point">
                {it.title && <h3>{it.title}</h3>}
                {it.body && <p>{it.body}</p>}
              </div>
            ))}
          </div>
        </section>
      );
    case "quote":
      return (
        <section className="s-sec s-quote">
          {cmd("--quote")}
          <blockquote>
            <p>{s.text}</p>
            {s.by && <footer>{s.by}</footer>}
          </blockquote>
        </section>
      );
    case "timeline":
      return (
        <section className="s-sec s-timeline">
          {cmd("--log")}
          {title(s.title)}
          <ol>
            {s.items.map((it, i) => (
              <li key={i}>
                <span className="lbl">{it.label}</span>
                <p>{it.text}</p>
              </li>
            ))}
          </ol>
        </section>
      );
    case "faq":
      return (
        <section className="s-sec s-faq">
          {cmd("--help")}
          {title(s.title)}
          <div>
            {s.items.map((it, i) => (
              <details key={i}>
                <summary>{it.q}</summary>
                <p>{it.a}</p>
              </details>
            ))}
          </div>
        </section>
      );
    case "stats":
      return <section className="s-sec s-live">{cmd("--stats")}<Stats title={s.title} coin={coin} candles={candles} layout={layout} /></section>;
  }
}

// ───────────── heroes ─────────────

function Typed({ text }: { text: string }) {
  const [n, setN] = useState(text.length);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setN(0);
    let i = 0;
    const t = setInterval(() => {
      i += 1;
      setN(i);
      if (i >= text.length) clearInterval(t);
    }, Math.max(18, Math.min(45, 1400 / text.length)));
    return () => clearInterval(t);
  }, [text]);
  return (
    <>
      <span aria-hidden="true">{text.slice(0, n)}</span>
      <span className="sr-only">{text}</span>
      <i className="s-caret" aria-hidden="true" />
    </>
  );
}

function Hero({ site, coin, by }: { site: SiteContent; coin: Coin; by: string }) {
  const { layout } = site.theme;
  const { kicker, headline, sub } = site.hero;
  const img = <img className="s-coin" src={coinImg(coin.image, coin.address) ?? ""} alt="" width={160} height={160} />;
  if (layout === "terminal")
    return (
      <header className="s-hero">
        <div className="s-cmd"><span>$</span> cat {coin.symbol.toLowerCase()}.md</div>
        {kicker && <div className="s-kicker"># {kicker}</div>}
        <h1 className="s-h1"><Typed text={headline} /></h1>
        {sub && <p className="s-sub">{sub}</p>}
        <div className="s-id">{img}<span>symbol=${coin.symbol} name=&quot;{coin.name}&quot; author=@{by}</span></div>
      </header>
    );
  if (layout === "poster") {
    const band = Array.from({ length: 14 }, () => `$${coin.symbol}`).join("   ");
    return (
      <header className="s-hero">
        <div className="s-poster-top">
          {kicker && <div className="s-kicker">{kicker}</div>}
          <h1 className="s-h1">{headline}</h1>
          <div className="s-poster-foot">
            {sub && <p className="s-sub">{sub}</p>}
            {img}
          </div>
        </div>
        <div className="s-band" aria-hidden="true"><div><span>{band}</span><span>{band}</span></div></div>
      </header>
    );
  }
  if (layout === "minimal")
    return (
      <header className="s-hero">
        {img}
        {kicker && <div className="s-kicker">{kicker}</div>}
        <h1 className="s-h1">{headline}</h1>
        {sub && <p className="s-sub">{sub}</p>}
      </header>
    );
  return (
    <header className="s-hero">
      <div className="s-ed-head">
        <div className="s-mast">
          <span>${coin.symbol}</span>
          <span>{kicker}</span>
        </div>
        <h1 className="s-h1">{headline}</h1>
      </div>
      <div className="s-ed-sub">
        <div className="s-seal">{img}</div>
        {sub && <p className="s-sub">{sub}</p>}
      </div>
    </header>
  );
}

// ───────────── page ─────────────

export function SiteView({ site, coin, candles, by, actions }: { site: SiteContent; coin: Coin; candles: Candle[]; by: string; actions?: ReactNode }) {
  const vars = useMemo(() => siteVars(site.theme), [site.theme]);
  const { layout, font, surface } = site.theme;
  return (
    <article className={`site site-${layout} font-${font} surf-${surface}`} style={vars}>
      <Hero site={site} coin={coin} by={by} />
      <div className="s-main">
        {site.sections.map((s, i) => (
          <Section key={i} s={s} coin={coin} candles={candles} layout={layout} />
        ))}
      </div>
      <footer className="s-foot">
        {actions && <div className="s-actions">{actions}</div>}
        {site.footer && <p>{site.footer}</p>}
      </footer>
    </article>
  );
}

/** A small, faithful preview of a site's hero for lists and feed cards. */
export function SiteThumb({ site, coin }: { site: SiteContent; coin: { image: string; symbol: string; address?: string } }) {
  const vars = useMemo(() => siteVars(site.theme), [site.theme]);
  return (
    <div className={`site-thumb thumb-${site.theme.layout} font-${site.theme.font}`} style={vars} aria-hidden="true">
      <div className="t-top">
        <img src={coinImg(coin.image, coin.address) ?? ""} alt="" width={22} height={22} />
        <span>${coin.symbol}</span>
      </div>
      <div className="t-kicker">{site.hero.kicker}</div>
      <div className="t-h">{site.hero.headline}</div>
      <div className="t-rule" />
    </div>
  );
}
