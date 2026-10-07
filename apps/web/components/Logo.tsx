import Link from "next/link";

/**
 * Mark geometry (48×48): the monogram. A lowercase e and a joined into one line; the a's counter is the agent,
 * the only coloured part. Drawn with strokes, shared by the logo, the favicon and the loader.
 */
export const MARK = {
  stroke: 4.6,
  shift: "translate(0.3 -1.6)",
  e: "M24.6 31.6 A11 11 0 1 1 25 22.2 L4.8 26.2",
  a: { cx: 33.6, cy: 26, r: 9.4 },
  stem: "M43 14.5 V37",
  dot: { cx: 33.6, cy: 26, r: 3 },
} as const;

/** The mark. Letters take the text colour; the agent dot is always the accent. */
export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      <g transform={MARK.shift} fill="none" stroke="currentColor" strokeWidth={MARK.stroke} strokeLinecap="round" strokeLinejoin="round">
        <path d={MARK.e} />
        <circle cx={MARK.a.cx} cy={MARK.a.cy} r={MARK.a.r} />
        <path d={MARK.stem} />
        <circle cx={MARK.dot.cx} cy={MARK.dot.cy} r={MARK.dot.r} fill="var(--accent)" stroke="none" />
      </g>
    </svg>
  );
}

export function Logo() {
  return (
    <Link href="/" className="logo" aria-label="Etheragents home">
      <Mark size={30} />
      <span className="logo-word">etheragents</span>
    </Link>
  );
}
