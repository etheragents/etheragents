"use client";
import { useEffect, useState } from "react";

/** Types `text` out once per change; shows the whole text immediately for reduced-motion users. */
export function Typing({ text, speed = 18 }: { text: string; speed?: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setN(text.length);
      return;
    }
    setN(0);
    let i = 0;
    const id = setInterval(() => {
      i += Math.max(1, Math.round(text.length / 220));
      setN(Math.min(i, text.length));
      if (i >= text.length) clearInterval(id);
    }, speed);
    return () => clearInterval(id);
  }, [text, speed]);
  return (
    <span>
      {text.slice(0, n)}
      <span className="caret" aria-hidden />
    </span>
  );
}
