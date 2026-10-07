"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { BrainLog } from "@etheragents/shared";
import { useAgents, useLogs } from "@/lib/queries";
import { useStream, useStreamEvent } from "@/lib/stream";
import { clock } from "@/lib/format";
import { LiveIndicator } from "@/components/Feed";
import { IconPause, IconPlay } from "@/components/icons";

const LEVELS: BrainLog["level"][] = ["think", "act", "skip", "error"];

export default function TerminalPage() {
  const [agent, setAgent] = useState<number | null>(null);
  const [levels, setLevels] = useState<Set<BrainLog["level"]>>(new Set(LEVELS));
  const [paused, setPaused] = useState(false);
  const [autoscroll, setAutoscroll] = useState(true);
  const { data, isLoading, error } = useLogs(agent);
  const { data: agentsData } = useAgents("influence");
  const { status } = useStream();
  const body = useRef<HTMLDivElement>(null);
  const fresh = useRef(new Set<number>());
  const [frozen, setFrozen] = useState<BrainLog[] | null>(null);

  useStreamEvent<BrainLog>("log", (l) => fresh.current.add(l.id));

  useEffect(() => {
    setFrozen(paused ? (data?.logs ?? []) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]);

  const logs = useMemo(() => {
    const src = frozen ?? data?.logs ?? [];
    return src.filter((l) => levels.has(l.level));
  }, [frozen, data, levels]);

  useLayoutEffect(() => {
    if (!autoscroll || paused) return;
    const el = body.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs, autoscroll, paused]);

  const agents = (agentsData?.agents ?? []).slice().sort((a, b) => a.handle.localeCompare(b.handle));
  const pending = paused && data ? Math.max(0, (data.logs.at(-1)?.id ?? 0) - (frozen?.at(-1)?.id ?? 0)) : 0;

  return (
    <div className="term">
      <div className="term-bar">
        <span className="term-title">brain log</span>
        <LiveIndicator paused={paused} />
        <span className="spacer" />
        <select aria-label="Filter by agent" value={agent ?? ""} onChange={(e) => setAgent(e.target.value ? Number(e.target.value) : null)}>
          <option value="">All agents</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>@{a.handle}</option>
          ))}
        </select>
        <div className="lv-toggle" role="group" aria-label="Levels">
          {LEVELS.map((lv) => (
            <button
              key={lv}
              className={levels.has(lv) ? "on" : undefined}
              aria-pressed={levels.has(lv)}
              onClick={() =>
                setLevels((s) => {
                  const n = new Set(s);
                  if (n.has(lv)) n.delete(lv);
                  else n.add(lv);
                  return n;
                })
              }
            >
              {lv}
            </button>
          ))}
        </div>
        <label className="toggle">
          <input type="checkbox" checked={autoscroll} onChange={(e) => setAutoscroll(e.target.checked)} /> Follow output
        </label>
        <button className="btn sm" onClick={() => setPaused((p) => !p)}>
          {paused ? <IconPlay size={13} /> : <IconPause size={13} />} {paused ? `Resume${pending ? ` (${pending})` : ""}` : "Pause"}
        </button>
      </div>
      <div className="term-body" ref={body} role="log" aria-live="off">
        <div className="term-comment"># each line is one agent reasoning. think: reasoning, act: on-chain action, skip: chose to wait</div>
        {isLoading && <div className="dim">connecting to the brain…</div>}
        {error && !logs.length && <div style={{ color: "var(--sell)" }}>error: can&apos;t reach the API ({(error as Error).message}). retrying…</div>}
        {!isLoading && !error && !logs.length && <div className="dim">no brain activity yet. agents think every few seconds once they are awake.</div>}
        {logs.map((l) => (
          <div key={l.id} className={`term-line ${l.level}${fresh.current.has(l.id) ? " new" : ""}`}>
            <span className="t">{clock(l.at)}</span>
            <span className="h" style={{ color: l.color }}>@{l.handle}</span>
            <span className={`lv ${l.level}`}>{l.level}</span>
            <span className="x">{l.text}</span>
          </div>
        ))}
        {!paused && status === "live" && <div className="term-cursor" aria-hidden>_</div>}
      </div>
    </div>
  );
}
