const SUB = "₀₁₂₃₄₅₆₇₈₉";
const sub = (n: number) => String(n).split("").map((d) => SUB[+d]).join("");

function trim(s: string): string {
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

/** ETH amount with sensible precision: 3.80 · 0.0123 · 0.00042 */
export function fmtEth(n: number | null | undefined, opts: { sign?: boolean; unit?: boolean } = {}): string {
  const unit = opts.unit === false ? "" : " ETH";
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const sign = opts.sign && n > 0 ? "+" : n < 0 ? "−" : "";
  const a = Math.abs(n);
  let s: string;
  if (a === 0) s = "0";
  else if (a >= 1e6) s = (a / 1e6).toFixed(2) + "M";
  else if (a >= 1e4) s = (a / 1e3).toFixed(1) + "K";
  else if (a >= 100) s = a.toFixed(1);
  else if (a >= 1) s = a.toFixed(2);
  else if (a >= 0.01) s = trim(a.toFixed(4));
  else if (a >= 0.0001) s = trim(a.toFixed(5));
  else if (a >= 1e-6) s = trim(a.toFixed(6));
  else s = "<0.000001";
  return sign + s + unit;
}

/** Tiny per-token prices: 0.0₁₀71 */
export function fmtPrice(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n) || n <= 0) return "—";
  if (n >= 0.001) return fmtEth(n, { unit: false });
  const z = Math.max(0, Math.ceil(-Math.log10(n)) - 1); // zeros right after "0."
  if (z < 4) return trim(n.toFixed(z + 3));
  const digits = Math.round(n * 10 ** (z + 3)).toString().slice(0, 3).replace(/0+$/, "") || "0";
  return `0.0${sub(z)}${digits}`;
}

/** Compact counts: 1.2M, 340K, 1.25B */
export function fmtNum(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  const s = n < 0 ? "−" : "";
  if (a >= 1e9) return s + trim((a / 1e9).toFixed(2)) + "B";
  if (a >= 1e6) return s + trim((a / 1e6).toFixed(digits)) + "M";
  if (a >= 1e4) return s + trim((a / 1e3).toFixed(digits)) + "K";
  if (a >= 1000) return s + Math.round(a).toLocaleString("en-US");
  if (a >= 10 || Number.isInteger(a)) return s + Math.round(a).toString();
  return s + trim(a.toFixed(2));
}

export function fmtPct(f: number | null | undefined, digits = 1): string {
  if (f === null || f === undefined || !Number.isFinite(f)) return "—";
  const p = f * 100;
  const sign = p > 0 ? "+" : p < 0 ? "−" : "";
  const a = Math.abs(p);
  return sign + (a >= 1000 ? fmtNum(a) : a.toFixed(a >= 100 ? 0 : digits)) + "%";
}

export function ago(unix: number | null | undefined, now = Date.now() / 1000): string {
  if (!unix) return "—";
  const d = Math.max(0, Math.floor(now - unix));
  if (d < 60) return `${d}s`;
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  if (d < 86400 * 30) return `${Math.floor(d / 86400)}d`;
  if (d < 86400 * 365) return `${Math.floor(d / (86400 * 30))}mo`;
  return `${Math.floor(d / (86400 * 365))}y`;
}

export function clock(unix: number): string {
  const d = new Date(unix * 1000);
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export function fullDate(unix: number): string {
  return new Date(unix * 1000).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

export function shortAddr(a: string | null | undefined, n = 4): string {
  if (!a) return "—";
  return a.length > 2 * n + 4 ? `${a.slice(0, n + 2)}…${a.slice(-n)}` : a;
}

export function signClass(n: number): string {
  return n > 0 ? "up" : n < 0 ? "down" : "flat";
}
