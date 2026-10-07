"use client";
import Link from "next/link";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { Agent } from "@etheragents/shared";
import { agentImg, coinImg } from "@/lib/config";
import { ago } from "@/lib/format";
import { IconCheck, IconCopy, IconExternal } from "./icons";
import { Mark } from "./Logo";

export const cssVar = (name: string, value: string | null | undefined): CSSProperties =>
  ({ [name]: value || "#8F9FF0" }) as CSSProperties;

export function Avatar({ seed, color, size = 40, alt = "" }: { seed: string; color?: string | null; size?: number; alt?: string }) {
  const [bad, setBad] = useState(false);
  return (
    <span className="avatar" style={{ ...cssVar("--c", color), width: size, height: size }} data-color={color ?? undefined}>
      {bad || !seed ? (
        <span className="fallback" style={{ fontSize: size * 0.38 }}>{(alt || seed || "?").slice(0, 1).toUpperCase()}</span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={agentImg(seed)} alt={alt} width={size} height={size} loading="lazy" onError={() => setBad(true)} />
      )}
    </span>
  );
}

export function CoinImage({ image, address, size = 40, alt = "" }: { image?: string | null; address?: string | null; size?: number; round?: boolean; alt?: string }) {
  const [bad, setBad] = useState(false);
  const src = coinImg(image, address);
  if (bad || !src)
    return (
      <span className="coin-img" style={{ width: size, height: size, display: "grid", placeItems: "center", color: "var(--text-3)", fontSize: size * 0.36, fontWeight: 600 }}>
        {(alt || "?").slice(0, 1).toUpperCase()}
      </span>
    );
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="coin-img" src={src} alt={alt} width={size} height={size} loading="lazy" onError={() => setBad(true)} />;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function Handle({ handle, color: _color, link = true }: { handle: string | null | undefined; color?: string | null; link?: boolean }) {
  if (!handle) return <span className="muted">outside wallet</span>;
  return link ? (
    <Link href={`/agents/${handle}`} className="handle" onClick={(e) => e.stopPropagation()}>
      @{handle}
    </Link>
  ) : (
    <span className="handle">@{handle}</span>
  );
}

export function StatusBadge({ agent }: { agent: Pick<Agent, "paused" | "asleep"> }) {
  if (agent.paused) return <span className="status paused"><span className="dot" />Paused</span>;
  if (agent.asleep) return <span className="status asleep"><span className="dot" />Asleep</span>;
  return <span className="status awake"><span className="dot" />Awake</span>;
}

export function Progress({ value, large = false }: { value: number; large?: boolean }) {
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <div className={`progress${large ? " lg" : ""}${v >= 1 ? " done" : ""}`} role="progressbar" aria-valuenow={Math.round(v * 100)} aria-valuemin={0} aria-valuemax={100}>
      <i style={{ width: `${v * 100}%` }} />
    </div>
  );
}

/** Relative time that re-renders itself every few seconds. */
export function Ago({ at, suffix = "" }: { at: number; suffix?: string }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((x) => x + 1), 5000);
    return () => clearInterval(id);
  }, []);
  return (
    <time dateTime={new Date(at * 1000).toISOString()} title={new Date(at * 1000).toLocaleString()} suppressHydrationWarning>
      {ago(at)}
      {suffix}
    </time>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      className="copy-btn"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard?.writeText(text).then(() => {
          setOk(true);
          setTimeout(() => setOk(false), 1200);
        }, () => {});
      }}
    >
      {ok ? <IconCheck size={14} /> : <IconCopy size={14} />}
    </button>
  );
}

export function ExtLink({ href, children, className }: { href: string | null; children: ReactNode; className?: string }) {
  if (!href) return <span className={className}>{children}</span>;
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className={className} onClick={(e) => e.stopPropagation()} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      {children}
      <IconExternal size={12} />
    </a>
  );
}

export function Skeleton({ w = "100%", h = 14, r, style }: { w?: number | string; h?: number | string; r?: number; style?: CSSProperties }) {
  return <span className="skel" style={{ display: "block", width: w, height: h, borderRadius: r, ...style }} />;
}

export function PostSkeleton({ n = 5 }: { n?: number }) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="post" style={{ cursor: "default" }} aria-hidden>
          <Skeleton w={36} h={36} r={9} />
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Skeleton w="40%" h={13} />
            <Skeleton w="92%" h={13} />
            <Skeleton w={i % 2 ? "70%" : "55%"} h={13} />
          </div>
        </div>
      ))}
    </>
  );
}

export function ListSkeleton({ n = 5, avatar = true }: { n?: number; avatar?: boolean }) {
  return (
    <div className="list" aria-hidden>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="li">
          {avatar && <Skeleton w={32} h={32} r={8} />}
          <div className="main" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <Skeleton w="60%" h={12} />
            <Skeleton w="40%" h={10} />
          </div>
          <Skeleton w={48} h={12} />
        </div>
      ))}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <span className="glyph"><Mark size={26} /></span>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const msg = error instanceof Error ? error.message : "Something went wrong";
  return (
    <div className="err-state" role="alert">
      <b>Couldn&apos;t load this: {msg}</b>
      <span>The API may be restarting. This page retries on its own, or you can try now.</span>
      {retry && (
        <button className="btn sm" onClick={retry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Stat({ label, value, sub, className }: { label: string; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${className ?? ""}`}>
        {value}
        {sub && <small>{sub}</small>}
      </div>
    </div>
  );
}
