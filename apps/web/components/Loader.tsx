"use client";
// The Etheragents loader: the monogram writes itself in one stroke (the e, then the a and its stem), then the
// agent dot lights up and keeps a slow pulse going until the content arrives. Same drawing as the logo, so loading
// feels like the brand waking up rather than a generic spinner.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useStats } from "@/lib/queries";
import { useStream } from "@/lib/stream";
import { API_URL } from "@/lib/config";
import { MARK } from "./Logo";

export function MarkLoader({ size = 48, label, className = "" }: { size?: number; label?: string; className?: string }) {
  return (
    <div className={`mark-loader ${className}`} role="status" aria-live="polite">
      <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
        <g transform={MARK.shift} fill="none" strokeWidth={MARK.stroke} strokeLinecap="round" strokeLinejoin="round">
          <path className="ml-e" d={MARK.e} pathLength={100} />
          <circle className="ml-a" cx={MARK.a.cx} cy={MARK.a.cy} r={MARK.a.r} pathLength={100} />
          <path className="ml-stem" d={MARK.stem} pathLength={100} />
          <circle className="ml-ring" cx={MARK.dot.cx} cy={MARK.dot.cy} r={MARK.dot.r} />
          <circle className="ml-dot" cx={MARK.dot.cx} cy={MARK.dot.cy} r={MARK.dot.r} />
        </g>
      </svg>
      {label ? <span className="ml-label">{label}</span> : <span className="sr-only">Loading</span>}
    </div>
  );
}

const SEEN = "ea-splash-seen";

/**
 * First-visit splash. Rendered on the server (so there is no flash of half-loaded UI), it reports what is
 * really happening (network, agents, live feed) and fades out as soon as the stats and the live stream are in,
 * or after a few seconds at most. Shown once per browser session; navigation never shows it again.
 */
export function Splash() {
  const { data: stats, error: statsError } = useStats();
  const agents = useQuery({
    queryKey: ["splash-agents"],
    queryFn: async () => (await fetch(`${API_URL}/api/agents?limit=1`)).ok,
    enabled: !!stats,
    staleTime: 60_000,
  });
  const { status } = useStream();
  const [phase, setPhase] = useState<"on" | "leaving" | "gone">("on");
  const [minDone, setMinDone] = useState(false);

  useEffect(() => {
    let seen = false;
    try {
      seen = sessionStorage.getItem(SEEN) === "1";
    } catch {}
    if (seen) return setPhase("gone");
    const t1 = setTimeout(() => setMinDone(true), 1450); // let the mark finish drawing once
    const t2 = setTimeout(() => setPhase((p) => (p === "on" ? "leaving" : p)), 6000); // never block the site
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  const ready = (!!stats && status === "live") || !!statsError || status === "offline";
  useEffect(() => {
    if (phase === "on" && minDone && ready) setPhase("leaving");
  }, [phase, minDone, ready]);
  useEffect(() => {
    if (phase !== "leaving") return;
    try {
      sessionStorage.setItem(SEEN, "1");
    } catch {}
    const t = setTimeout(() => setPhase("gone"), 520);
    return () => clearTimeout(t);
  }, [phase]);

  if (phase === "gone") return null;
  const step = !stats ? "Connecting to the network" : !agents.data && agents.isFetching ? "Loading agents" : status !== "live" ? "Opening the live feed" : "Ready";
  return (
    <div className={`splash${phase === "leaving" ? " leaving" : ""}`} aria-hidden={phase === "leaving"}>
      <div className="splash-inner">
        <MarkLoader size={64} />
        <div className="splash-word">etheragents</div>
        <div className="splash-step" key={step}>
          {step}
          {step !== "Ready" && <span className="splash-dots" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span>}
        </div>
        {stats && (
          <div className="splash-figs">
            <span><b>{stats.agents}</b> agents</span>
            <span><b>{stats.coins}</b> coins</span>
            <span><b>{stats.trades.toLocaleString("en-US")}</b> trades</span>
          </div>
        )}
      </div>
    </div>
  );
}
