// Shared pieces for the generated share images (Open Graph / X cards): fonts, the mark and a server-side API fetch.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { API_URL } from "./config";

export const OG_SIZE = { width: 1200, height: 630 };
export const C = { ink: "#0B0E14", surface: "#10141C", line: "#1F2633", text: "#E6E9EF", text2: "#9AA3B4", text3: "#636C7D", accent: "#8EA0FF", buy: "#5ED69A" };

const dir = path.join(process.cwd(), "assets/og");
export async function ogFonts() {
  const f = (n: string) => readFile(path.join(dir, n));
  const [wide, sans, sansBold, serif, mono] = await Promise.all([
    f("archivo-600.woff"), f("instrument-sans-400.woff"), f("instrument-sans-600.woff"), f("instrument-serif-400.woff"), f("jetbrains-mono-500.woff"),
  ]);
  return [
    { name: "Wide", data: wide, weight: 600 as const, style: "normal" as const },
    { name: "Sans", data: sans, weight: 400 as const, style: "normal" as const },
    { name: "Sans", data: sansBold, weight: 600 as const, style: "normal" as const },
    { name: "Serif", data: serif, weight: 400 as const, style: "normal" as const },
    { name: "Mono", data: mono, weight: 500 as const, style: "normal" as const },
  ];
}

/** Server-side read from the API; null when it can't be reached (the page then falls back to the site card). */
export async function apiGetServer<T>(p: string): Promise<T | null> {
  const base = (process.env.API_INTERNAL_URL || API_URL).replace(/\/+$/, "");
  try {
    const res = await fetch(base + p, { next: { revalidate: 60 }, signal: AbortSignal.timeout(4000) });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/** The monogram as an inline SVG element (satori renders SVG children). */
export function OgMark({ size = 40, fg = C.text, dot = C.accent }: { size?: number; fg?: string; dot?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      <g transform="translate(0.3 -1.6)" fill="none" stroke={fg} strokeWidth={4.6} strokeLinecap="round" strokeLinejoin="round">
        <path d="M24.6 31.6 A11 11 0 1 1 25 22.2 L4.8 26.2" />
        <circle cx={33.6} cy={26} r={9.4} />
        <path d="M43 14.5 V37" />
        <circle cx={33.6} cy={26} r={3} fill={dot} stroke="none" />
      </g>
    </svg>
  );
}

export function OgBrand({ color = C.text }: { color?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <OgMark size={38} fg={color} />
      <span style={{ fontFamily: "Wide", fontSize: 30, letterSpacing: "-0.035em", color }}>etheragents</span>
    </div>
  );
}

export const fmtEthOg = (n: number) => (n >= 100 ? n.toFixed(0) : n >= 1 ? n.toFixed(2) : n >= 0.01 ? n.toFixed(3) : n.toFixed(4)) + " ETH";
