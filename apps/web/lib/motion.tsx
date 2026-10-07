"use client";
// Small motion toolkit. Every effect here answers a change in the data (a number moved, a list re-ordered,
// a tab switched) so the eye can follow what changed. All of it is disabled under prefers-reduced-motion.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";

const useIso = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/** A number that glides to its new value (650ms, ease-out) instead of jumping. */
export function useTween(value: number, ms = 650): number {
  const [shown, setShown] = useState(value);
  const current = useRef(value); // the value on screen right now (mid-animation included)
  const raf = useRef(0);
  useEffect(() => {
    cancelAnimationFrame(raf.current);
    if (!Number.isFinite(value) || !Number.isFinite(current.current) || reducedMotion() || current.current === value) {
      current.current = value;
      setShown(value);
      return;
    }
    const start = performance.now();
    const a = current.current;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const v = t >= 1 ? value : a + (value - a) * easeOut(t);
      current.current = v;
      setShown(v);
      if (t < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [value, ms]);
  return shown;
}

/**
 * A formatted number that tweens when it changes and briefly tints green (up) or red (down).
 * `flash` = "sign" tints by direction, "accent" always uses the accent, false disables the tint.
 */
export function Num({
  value,
  format,
  flash = "sign",
  className = "",
}: {
  value: number;
  format: (n: number) => ReactNode;
  flash?: "sign" | "accent" | false;
  className?: string;
}) {
  const shown = useTween(value);
  const prev = useRef(value);
  const [tint, setTint] = useState<"" | "up" | "down" | "acc">("");
  useEffect(() => {
    if (!flash || prev.current === value || !Number.isFinite(value)) {
      prev.current = value;
      return;
    }
    const dir = value > prev.current ? "up" : "down";
    prev.current = value;
    setTint(flash === "accent" ? "acc" : dir);
    const id = setTimeout(() => setTint(""), 900);
    return () => clearTimeout(id);
  }, [value, flash]);
  return <span className={`num ${tint ? "tint-" + tint : ""} ${className}`}>{format(shown)}</span>;
}

/**
 * FLIP: when children of `ref` (marked with data-flip="<key>") change order, slide them from their old
 * position to the new one instead of jumping. Call with the list of keys in render order.
 */
export function useFlip(ref: RefObject<HTMLElement | null>, keys: (string | number)[]) {
  const last = useRef(new Map<string, DOMRect>());
  const sig = keys.join("|");
  useIso(() => {
    const root = ref.current;
    if (!root) return;
    const els = Array.from(root.querySelectorAll<HTMLElement>(":scope > [data-flip]"));
    const next = new Map<string, DOMRect>();
    for (const el of els) next.set(el.dataset.flip!, el.getBoundingClientRect());
    if (!reducedMotion()) {
      for (const el of els) {
        const before = last.current.get(el.dataset.flip!);
        const after = next.get(el.dataset.flip!)!;
        if (!before) {
          // newcomer: fade in
          el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 420, easing: "ease-out" });
          continue;
        }
        const dy = before.top - after.top;
        if (Math.abs(dy) < 1) continue;
        el.animate([{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }], {
          duration: 520,
          easing: "cubic-bezier(.2,.75,.2,1)",
        });
      }
    }
    last.current = next;
  }, [sig]);
}

/**
 * One underline for a tab bar that slides to the active tab. Render it as the last child of a `.tabs`
 * container; it follows whichever child has aria-selected="true" or the class `active`.
 */
export function TabInk() {
  const ink = useRef<HTMLSpanElement>(null);
  useIso(() => {
    const el = ink.current;
    const bar = el?.parentElement;
    if (!el || !bar) return;
    let first = true;
    const place = () => {
      const active = bar.querySelector<HTMLElement>('[aria-selected="true"], .tab.active');
      if (!active) {
        el.style.opacity = "0";
        return;
      }
      el.style.transition = first || reducedMotion() ? "none" : "";
      el.style.opacity = "1";
      el.style.width = `${active.offsetWidth}px`;
      el.style.transform = `translateX(${active.offsetLeft}px)`;
      first = false;
    };
    place();
    const mo = new MutationObserver(place);
    mo.observe(bar, { attributes: true, subtree: true, attributeFilter: ["aria-selected", "class"] });
    const ro = new ResizeObserver(place);
    ro.observe(bar);
    return () => {
      mo.disconnect();
      ro.disconnect();
    };
  }, []);
  return <span ref={ink} className="tab-ink" aria-hidden="true" />;
}
