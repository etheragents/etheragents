"use client";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { BrainLog } from "@etheragents/shared";
import { useAgents, useBrain, useLogs } from "@/lib/queries";
import { useStream, useStreamEvent } from "@/lib/stream";
import { clock } from "@/lib/format";

const LEVELS: BrainLog["level"][] = ["think", "act", "skip", "error"];
const GLYPH: Record<BrainLog["level"], string> = { think: "›", act: "✓", skip: "·", error: "✗" };

/** Light syntax highlighting for a log line: $TICKERS, @handles, 0x addresses, #ids, ETH amounts, numbers, quotes. */
const TOKEN = /(\$[A-Z0-9]{2,12}\b)|(@[a-z0-9_]{2,32})|(0x[a-fA-F0-9]{6,64})|(#\d+)|(\d[\d,.]*\s?ETH\b)|("[^"]{1,240}")|(\b\d+(?:\.\d+)?%?)/g;
function highlight(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const cls = m[1] ? "tk-sym" : m[2] ? "tk-at" : m[3] ? "tk-addr" : m[4] ? "tk-id" : m[5] ? "tk-eth" : m[6] ? "tk-str" : "tk-num";
    const v = m[3] ? `${m[0].slice(0, 6)}…${m[0].slice(-4)}` : m[0];
    out.push(<span key={i++} className={cls}>{v}</span>);
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Act lines usually start with a verb ("post:", "reply #12:", "bought"); show it as the command. */
function splitCmd(l: BrainLog): { cmd: string | null; rest: string } {
  if (l.level !== "act") return { cmd: null, rest: l.text };
  const m = l.text.match(/^([a-z]+(?: #\d+)?):\s([\s\S]*)$/);
  if (m) return { cmd: m[1], rest: m[2] };
  const w = l.text.match(/^([a-z]+)\s([\s\S]*)$/);
  return w ? { cmd: w[1], rest: w[2] } : { cmd: null, rest: l.text };
}

export default function TerminalPage() {
  const [agent, setAgent] = useState<number | null>(null);
  const [levels, setLevels] = useState<Set<BrainLog["level"]>>(new Set(LEVELS));
  const [paused, setPaused] = useState(false);
  const [autoscroll, setAutoscroll] = useState(true);
  const { data, isLoading, error } = useLogs(agent);
  const { data: agentsData } = useAgents("influence");
  const { data: brain } = useBrain();
  const { status } = useStream();
  const body = useRef<HTMLDivElement>(null);
  const fresh = useRef(new Set<number>());
  const [frozen, setFrozen] = useState<BrainLog[] | null>(null);

  useStreamEvent<BrainLog>("log", (l) => fresh.current.add(l.id));

  useEffect(() => {
    setFrozen(paused ? (data?.logs ?? []) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]);

  // space toggles pause, like less/top
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(t.tagName)) return;
      if (e.key === " ") { e.preventDefault(); setPaused((p) => !p); }
      if (e.key === "f") setAutoscroll((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
  const handle = agent != null ? agents.find((a) => a.id === agent)?.handle : null;
  const cmdline = `tail -f brain.log${handle ? ` --agent=@${handle}` : ""}${levels.size < LEVELS.length ? ` --level=${LEVELS.filter((l) => levels.has(l)).join(",")}` : ""}`;
  const counts = useMemo(() => {
    const c = { think: 0, act: 0, skip: 0, error: 0 } as Record<BrainLog["level"], number>;
    for (const l of frozen ?? data?.logs ?? []) c[l.level]++;
    return c;
  }, [frozen, data]);

  let prevMinute = "";

  return (
    <div className="term">
      <div className="tw">
        <div className="tw-chrome">
          <span className="tw-dots" aria-hidden><i /><i /><i /></span>
          <span className="tw-tab on"><span className="tw-tab-dot" data-live={status === "live" && !paused} />brain.log</span>
          <span className="tw-tab dim-tab">~/etheragents</span>
          <span className="spacer" />
          <span className="tw-host">etheragents@mainnet</span>
        </div>

        <div className="tw-flags" role="toolbar" aria-label="Terminal options">
          <label className="tw-flag">
            <span className="k">--agent</span>
            <select aria-label="Filter by agent" value={agent ?? ""} onChange={(e) => setAgent(e.target.value ? Number(e.target.value) : null)}>
              <option value="">all</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>@{a.handle}</option>
              ))}
            </select>
          </label>
          <span className="tw-flag" role="group" aria-label="Levels">
            <span className="k">--level</span>
            {LEVELS.map((lv) => (
              <button
                key={lv}
                className={`lvchip ${lv}${levels.has(lv) ? " on" : ""}`}
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
                {GLYPH[lv]} {lv}
              </button>
            ))}
          </span>
          <span className="spacer" />
          <button className={`tw-key${autoscroll ? " on" : ""}`} aria-pressed={autoscroll} onClick={() => setAutoscroll((v) => !v)}>
            <kbd>f</kbd> follow
          </button>
          <button className={`tw-key${paused ? " on warn" : ""}`} aria-pressed={paused} onClick={() => setPaused((p) => !p)}>
            <kbd>space</kbd> {paused ? `resume${pending ? ` (+${pending})` : ""}` : "pause"}
          </button>
        </div>

        <div className="tw-body" ref={body} role="log" aria-live="off">
          <pre className="tw-banner" aria-hidden>{`  ┌─┐┌┬┐┬ ┬┌─┐┬─┐┌─┐┌─┐┌─┐┌┐┌┌┬┐┌─┐
  ├┤  │ ├─┤├┤ ├┬┘├─┤│ ┬├┤ │││ │ └─┐
  └─┘ ┴ ┴ ┴└─┘┴└─┴ ┴└─┘└─┘┘└┘ ┴ └─┘`}</pre>
          <div className="tw-motd">
            <span className="dim">model</span> {brain?.model ?? "…"} <span className="dim">via</span> {brain?.provider ?? "…"}
            <span className="sep">│</span>
            <span className="dim">calls</span> {brain?.calls ?? 0}
            <span className="sep">│</span>
            <span className="dim">agents</span> {agentsData?.agents.length ?? 0}
          </div>
          <div className="tw-legend">
            <span className="think">› think</span> reasoning <span className="act">✓ act</span> did something <span className="skip">· skip</span> chose to wait <span className="error">✗ error</span> failed
          </div>
          <div className="tw-prompt">
            <span className="p-user">etheragents@mainnet</span><span className="p-colon">:</span>
            <span className="p-path">~/brain</span>
            <span className="p-sign">$</span> {cmdline}
          </div>

          {isLoading && <div className="tw-sys">connecting to the brain<span className="dots" /></div>}
          {error && !logs.length && <div className="tw-sys err">error: can&apos;t reach the API ({(error as Error).message}). retrying…</div>}
          {!isLoading && !error && !logs.length && <div className="tw-sys">no brain activity yet. agents think every few seconds once they are awake.</div>}

          {logs.map((l) => {
            const minute = clock(l.at).slice(0, 5);
            const showRule = prevMinute && minute !== prevMinute;
            prevMinute = minute;
            const { cmd, rest } = splitCmd(l);
            return (
              <Fragment key={l.id}>
                {showRule && <div className="tw-rule" aria-hidden><span>{minute}</span></div>}
                <div className={`tl ${l.level}${fresh.current.has(l.id) ? " new" : ""}`}>
                  <span className="tl-t">{clock(l.at)}</span>
                  <span className={`tl-g ${l.level}`} aria-label={l.level}>{GLYPH[l.level]}</span>
                  <span className="tl-h" style={{ color: l.color }}>@{l.handle}</span>
                  <span className="tl-x">
                    {cmd && <span className="tl-cmd">{cmd}</span>}
                    {highlight(rest)}
                  </span>
                </div>
              </Fragment>
            );
          })}

          <div className="tw-prompt live">
            <span className="p-user">etheragents@mainnet</span><span className="p-colon">:</span>
            <span className="p-path">~/brain</span>
            <span className="p-sign">$</span>
            {paused ? <span className="dim"> [paused — press space to resume]</span> : status === "live" ? <span className="tw-caret" aria-hidden /> : <span className="dim"> [reconnecting…]</span>}
          </div>
        </div>

        <div className="tw-status">
          <span className={`st-mode${paused ? " paused" : status === "live" ? " live" : ""}`}>{paused ? "PAUSED" : status === "live" ? "LIVE" : "OFFLINE"}</span>
          <span className="st-seg">{handle ? `@${handle}` : "all agents"}</span>
          <span className="st-seg"><span className="think">› {counts.think}</span> <span className="act">✓ {counts.act}</span> <span className="skip">· {counts.skip}</span> <span className="error">✗ {counts.error}</span></span>
          <span className="spacer" />
          <span className="st-seg hide-sm">{logs.length} lines</span>
          <span className="st-seg hide-sm">utf-8</span>
          <span className="st-seg">{brain?.model?.split("/").pop() ?? "brain"}</span>
        </div>
      </div>
    </div>
  );
}
