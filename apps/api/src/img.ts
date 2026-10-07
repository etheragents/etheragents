// Generated identities, deterministic from a seed.
// Agents: a square tile of four geometric cells (Bauhaus-style) in the agent's colour.
// Coins: a round token built from two geometric forms in the coin's colour.
// Both use the curated palette in util.ts, so every agent/coin colour sits well on the ink background.
import { PALETTE, colorFor, mix, rng } from "./util.ts";

const INK = "#0B0E14";

type Cell = (x: number, y: number, s: number, fg: string, r: () => number) => string;

// One cell of the 2×2 grid. Each draws inside the square (x, y, s).
const CELLS: Cell[] = [
  // full circle
  (x, y, s, fg) => `<circle cx="${x + s / 2}" cy="${y + s / 2}" r="${s / 2}" fill="${fg}"/>`,
  // quarter circle anchored in one corner
  (x, y, s, fg, r) => {
    const c = Math.floor(r() * 4);
    const cx = c % 2 ? x + s : x;
    const cy = c > 1 ? y + s : y;
    const sx = cx === x ? x + s : x;
    const sy = cy === y ? y + s : y;
    return `<path d="M${cx} ${cy} L${sx} ${cy} A${s} ${s} 0 0 ${c === 1 || c === 2 ? 0 : 1} ${cx} ${sy} Z" fill="${fg}"/>`;
  },
  // half circle facing one side
  (x, y, s, fg, r) => {
    const d = Math.floor(r() * 4);
    if (d === 0) return `<path d="M${x} ${y + s} A${s / 2} ${s / 2} 0 0 1 ${x + s} ${y + s} Z" fill="${fg}"/>`;
    if (d === 1) return `<path d="M${x} ${y} A${s / 2} ${s / 2} 0 0 0 ${x + s} ${y} Z" fill="${fg}"/>`;
    if (d === 2) return `<path d="M${x} ${y} A${s / 2} ${s / 2} 0 0 1 ${x} ${y + s} Z" fill="${fg}"/>`;
    return `<path d="M${x + s} ${y} A${s / 2} ${s / 2} 0 0 0 ${x + s} ${y + s} Z" fill="${fg}"/>`;
  },
  // diagonal triangle
  (x, y, s, fg, r) =>
    r() < 0.5
      ? `<path d="M${x} ${y} L${x + s} ${y} L${x} ${y + s} Z" fill="${fg}"/>`
      : `<path d="M${x + s} ${y} L${x + s} ${y + s} L${x} ${y + s} Z" fill="${fg}"/>`,
  // solid square
  (x, y, s, fg) => `<rect x="${x}" y="${y}" width="${s}" height="${s}" fill="${fg}"/>`,
  // small dot
  (x, y, s, fg) => `<circle cx="${x + s / 2}" cy="${y + s / 2}" r="${s / 4.2}" fill="${fg}"/>`,
  // ring
  (x, y, s, fg) => `<circle cx="${x + s / 2}" cy="${y + s / 2}" r="${s / 2 - s / 7}" fill="none" stroke="${fg}" stroke-width="${s / 7}"/>`,
];

export function agentSvg(seed: string): string {
  const r = rng("avatar:" + seed);
  const base = colorFor(seed);
  const tones = [base, mix(base, "#FFFFFF", 0.35), mix(base, INK, 0.35)];
  const bg = mix(base, INK, 0.84);
  const s = 24; // cell size inside a 64 tile with an 8px margin
  let cells = "";
  let lastKind = -1;
  for (let i = 0; i < 4; i++) {
    let kind = Math.floor(r() * CELLS.length);
    if (kind === lastKind) kind = (kind + 1 + Math.floor(r() * (CELLS.length - 1))) % CELLS.length;
    lastKind = kind;
    const fg = tones[Math.floor(r() * tones.length)];
    cells += CELLS[kind](8 + (i % 2) * s, 8 + Math.floor(i / 2) * s, s, fg, r);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="128" height="128">
<rect width="64" height="64" fill="${bg}"/>
${cells}
</svg>`;
}

export function coinSvg(address: string, _symbol = ""): string {
  const r = rng("coin:" + address.toLowerCase());
  const a = PALETTE[Math.floor(r() * PALETTE.length)];
  let b: string = PALETTE[Math.floor(r() * PALETTE.length)];
  if (b === a) b = mix(a, "#FFFFFF", 0.45);
  const rot = Math.floor(r() * 8) * 45;
  const form = Math.floor(r() * 3);
  const inner =
    form === 0
      ? `<path d="M12 32 A20 20 0 0 1 52 32 Z" fill="${b}"/>` // half disc
      : form === 1
        ? `<circle cx="32" cy="32" r="10" fill="${b}"/><path d="M32 12 A20 20 0 0 1 52 32 L32 32 Z" fill="${mix(b, INK, 0.25)}"/>` // dot + quadrant
        : `<rect x="21" y="21" width="22" height="22" fill="${b}"/>`; // square
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="128" height="128">
<rect width="64" height="64" fill="${mix(a, INK, 0.86)}"/>
<circle cx="32" cy="32" r="22" fill="${a}"/>
<g transform="rotate(${rot} 32 32)">${inner}</g>
<circle cx="32" cy="32" r="22" fill="none" stroke="${INK}" stroke-opacity=".18" stroke-width="1"/>
</svg>`;
}
