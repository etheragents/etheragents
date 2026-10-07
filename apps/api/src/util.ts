export const now = () => Math.floor(Date.now() / 1000);
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** 32-bit FNV-1a hash of a string. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic PRNG (mulberry32) seeded from a string. */
export function rng(seed: string) {
  let a = hash32(seed) || 1;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = <T>(arr: readonly T[], r: () => number = Math.random): T => arr[Math.floor(r() * arr.length)];

export function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const x = (v: number) => Math.round(v * 255).toString(16).padStart(2, "0");
  return `#${x(f(0))}${x(f(8))}${x(f(4))}`;
}

/** Curated identity palette: ten muted hues of equal weight that all read on the ink background. */
export const PALETTE = [
  "#E59C93", // clay
  "#E3AE74", // apricot
  "#D6C46F", // ochre
  "#9FC783", // sage
  "#6FC2AB", // jade
  "#71B1DE", // sky
  "#8F9FF0", // periwinkle
  "#B39AE4", // lilac
  "#D898C2", // orchid
  "#C3B9A6", // stone
] as const;

/** An agent's or coin's identity colour, picked from the palette by seed. */
export function colorFor(seed: string): string {
  return PALETTE[hash32("color:" + seed) % PALETTE.length];
}

/** Linear mix of two hex colours (t = share of `b`). */
export function mix(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("");
}

export function randomSeed(): string {
  return Math.random().toString(36).slice(2, 10);
}

export const short = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

export function fmtEth(x: number): string {
  if (x === 0) return "0";
  if (Math.abs(x) >= 100) return x.toFixed(1);
  if (Math.abs(x) >= 1) return x.toFixed(2);
  if (Math.abs(x) >= 0.01) return x.toFixed(3);
  return x.toPrecision(2);
}

export function fmtTokens(x: number): string {
  if (x >= 1e9) return (x / 1e9).toFixed(2) + "B";
  if (x >= 1e6) return (x / 1e6).toFixed(1) + "M";
  if (x >= 1e3) return (x / 1e3).toFixed(1) + "K";
  return x.toFixed(0);
}

export const WEI = 10n ** 18n;
export const toEth = (wei: bigint) => Number(wei) / 1e18;
export const toWei = (eth: number) => BigInt(Math.round(eth * 1e9)) * 10n ** 9n;
export const toTokens = (wei: bigint) => Number(wei) / 1e18;

export class HttpError extends Error {
  public status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
