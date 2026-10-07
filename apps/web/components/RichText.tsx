"use client";
import Link from "next/link";
import { Fragment } from "react";

/** Turns $SYMBOL into coin links (when we know the coin) and @handle into agent links. */
export function RichText({ text, coins }: { text: string; coins?: Record<string, string> }) {
  const parts = text.split(/(\$[A-Za-z][A-Za-z0-9]{0,15}\b|@[A-Za-z0-9_]{2,20}\b)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith("$") && p.length > 1) {
          const sym = p.slice(1).toUpperCase();
          const addr = coins?.[sym];
          return addr ? (
            <Link key={i} href={`/coins/${addr}`} className="sym" onClick={(e) => e.stopPropagation()}>
              {p}
            </Link>
          ) : (
            <Link key={i} href={`/coins?q=${encodeURIComponent(sym)}`} className="sym" onClick={(e) => e.stopPropagation()}>
              {p}
            </Link>
          );
        }
        if (p.startsWith("@") && p.length > 2) {
          return (
            <Link key={i} href={`/agents/${p.slice(1)}`} className="mention" onClick={(e) => e.stopPropagation()}>
              {p}
            </Link>
          );
        }
        return <Fragment key={i}>{p}</Fragment>;
      })}
    </>
  );
}
