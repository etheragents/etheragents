"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Candle } from "@etheragents/shared";
import { fmtEth, fmtPrice } from "@/lib/format";

const PAD = { l: 12, r: 76, t: 16, b: 28 };
const VOL_H = 44;

// DESIGN.md chart tokens (SVG attributes can't read CSS variables reliably in every browser)
const C = {
  line: "#1F2633",
  text3: "#636C7D",
  buy: "#5ED69A",
  sell: "#F07178",
  accent: "#8EA0FF",
  ink: "#0B0E14",
  vol: "#2A3242",
  cross: "#9AA3B4",
};

export const TIMEFRAMES = [
  { id: "1m", s: 60 },
  { id: "5m", s: 300 },
  { id: "15m", s: 900 },
  { id: "1h", s: 3600 },
] as const;
export type Timeframe = (typeof TIMEFRAMES)[number]["id"];

/** Merge 1-minute candles into larger buckets (open of the first, close of the last, high/low/volume across). */
export function aggregate(candles: Candle[], seconds: number): Candle[] {
  if (seconds <= 60) return candles;
  const out: Candle[] = [];
  for (const c of candles) {
    const t = Math.floor(c.t / seconds) * seconds;
    const last = out[out.length - 1];
    if (last && last.t === t) {
      last.h = Math.max(last.h, c.h);
      last.l = Math.min(last.l, c.l);
      last.c = c.c;
      last.v += c.v;
    } else out.push({ ...c, t });
  }
  return out;
}

/** Candlestick chart of OHLC candles, drawn as plain SVG. */
export function PriceChart({ candles, label = "1-minute" }: { candles: Candle[]; color?: string; label?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(760);
  // draw at the container's real width so labels keep their size on small screens
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(300, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [candles.length > 0]);
  const H = W < 560 ? 240 : 300;

  const view = useMemo(() => {
    const cs = candles.filter((c) => [c.o, c.h, c.l, c.c].every((x) => Number.isFinite(x) && x > 0)).slice(-120);
    if (!cs.length) return null;
    let lo = Math.min(...cs.map((c) => c.l));
    let hi = Math.max(...cs.map((c) => c.h));
    if (hi === lo) {
      hi = hi * 1.05;
      lo = lo * 0.95;
    }
    const pad = (hi - lo) * 0.08;
    lo = Math.max(0, lo - pad);
    hi = hi + pad;
    const plotW = W - PAD.l - PAD.r;
    const plotH = H - PAD.t - PAD.b - VOL_H;
    const slots = Math.max(cs.length, Math.round(plotW / 20));
    const step = plotW / slots;
    const bw = Math.max(2, Math.min(10, step * 0.6));
    const x0 = PAD.l + plotW - cs.length * step; // right-align
    const y = (p: number) => PAD.t + (1 - (p - lo) / (hi - lo)) * plotH;
    const vmax = Math.max(...cs.map((c) => c.v), 1e-12);
    const ticks = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * i) / 4);
    // keep time labels at least ~70 units apart so they never collide
    const every = Math.max(1, Math.ceil(70 / step));
    const timeTicks = cs.map((c, i) => ({ i, t: c.t })).filter(({ i }) => (cs.length - 1 - i) % every === 0);
    return { cs, lo, hi, step, bw, x0, y, vmax, ticks, timeTicks, plotH };
  }, [candles, W, H]);

  if (!view) {
    return <div ref={boxRef} className="chart-empty">No trades yet. The chart starts with the first buy.</div>;
  }
  const { cs, step, bw, x0, y, vmax, ticks, timeTicks, plotH } = view;
  const cx = (i: number) => x0 + i * step + step / 2;
  const volBase = PAD.t + plotH + VOL_H;
  const last = cs[cs.length - 1];
  const h = hover !== null ? cs[hover] : null;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    const i = Math.floor((x - x0) / step);
    setHover(i >= 0 && i < cs.length ? i : null);
  };
  const fmtT = (t: number) => new Date(t * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="chart" ref={boxRef}>
      <div className="chart-legend">
        {h ? (
          <>
            <span>{fmtT(h.t)}</span>
            <span>Open <b>{fmtPrice(h.o)}</b></span>
            <span>High <b>{fmtPrice(h.h)}</b></span>
            <span>Low <b>{fmtPrice(h.l)}</b></span>
            <span>Close <b className={h.c >= h.o ? "up" : "down"}>{fmtPrice(h.c)}</b></span>
            <span>Volume <b>{fmtEth(h.v)}</b></span>
          </>
        ) : (
          <span>{label} candles, price in ETH per token{cs.length === 1 ? ". First candle." : ""}</span>
        )}
      </div>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Price chart" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke={C.line} />
            {Math.abs(y(t) - y(cs[cs.length - 1].c)) > 20 && <text x={W - PAD.r + 10} y={y(t) + 3.5}>{fmtPrice(t)}</text>}
          </g>
        ))}
        <line x1={PAD.l} x2={W - PAD.r} y1={volBase + 0.5} y2={volBase + 0.5} stroke={C.line} />
        {timeTicks.map(({ i, t }) => (
          <text key={t} x={cx(i)} y={H - 8} textAnchor="middle">{fmtT(t)}</text>
        ))}
        {cs.map((c, i) => {
          const up = c.c >= c.o;
          const col = up ? C.buy : C.sell;
          const top = y(Math.max(c.o, c.c));
          const bot = y(Math.min(c.o, c.c));
          const vh = (c.v / vmax) * (VOL_H - 8);
          return (
            <g key={c.t} opacity={hover === null || hover === i ? 1 : 0.5}>
              <rect x={cx(i) - bw / 2} y={volBase - vh} width={bw} height={Math.max(0.5, vh)} fill={C.vol} />
              <g className={i === cs.length - 1 ? "candle-new" : undefined}>
                <line x1={cx(i)} x2={cx(i)} y1={y(c.h)} y2={y(c.l)} stroke={col} strokeWidth={1} />
                <rect x={cx(i) - bw / 2} y={top} width={bw} height={Math.max(1, bot - top)} fill={col} rx={0.5} />
              </g>
            </g>
          );
        })}
        {/* last price marker */}
        <g className="last-price" style={{ transform: `translateY(${y(last.c)}px)` }}>
          <line x1={PAD.l} x2={W - PAD.r} y1={0} y2={0} stroke={C.accent} strokeOpacity="0.55" strokeDasharray="2 3" />
          <rect x={W - PAD.r + 4} y={-9} width={PAD.r - 6} height={18} rx={4} fill={C.accent} />
          <text x={W - PAD.r + 10} y={3.5} style={{ fill: C.ink, fontWeight: 600 }}>{fmtPrice(last.c)}</text>
        </g>
        {hover !== null && <line x1={cx(hover)} x2={cx(hover)} y1={PAD.t} y2={volBase} stroke={C.cross} strokeOpacity="0.35" />}
      </svg>
    </div>
  );
}
