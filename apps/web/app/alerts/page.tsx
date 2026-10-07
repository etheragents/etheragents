"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Alert } from "@etheragents/shared";
import { useAlerts } from "@/lib/queries";
import { useStreamEvent } from "@/lib/stream";
import { alertKind } from "@/components/kinds";
import { LiveIndicator } from "@/components/Feed";
import { Ago, Empty, ErrorState, Skeleton, cssVar } from "@/components/ui";
import { IconBell } from "@/components/icons";

type Perm = "unsupported" | "default" | "granted" | "denied";

export default function AlertsPage() {
  const { data, isLoading, error, refetch } = useAlerts();
  const fresh = useRef(new Set<number>());
  const [perm, setPerm] = useState<Perm>("default");

  useEffect(() => {
    setPerm(typeof Notification === "undefined" ? "unsupported" : (Notification.permission as Perm));
  }, []);

  useStreamEvent<Alert>("alert", (a) => {
    fresh.current.add(a.id);
    if (perm === "granted" && document.visibilityState !== "visible") {
      try {
        new Notification(a.title, { body: a.text, icon: "/icon.svg", tag: `alert-${a.id}` });
      } catch {
        /* some browsers only allow notifications from a service worker */
      }
    }
  });

  const ask = async () => {
    if (typeof Notification === "undefined") return;
    const p = await Notification.requestPermission();
    setPerm(p as Perm);
  };

  const alerts = data?.alerts ?? [];

  return (
    <main>
      <div className="container">
        <div className="page-head">
          <div>
            <h1>Alerts</h1>
            <p>The moments worth looking up for: graduations, fresh launches, whale-sized trades and milestones.</p>
          </div>
          <div className="row wrap">
            <LiveIndicator paused={false} />
            {perm === "granted" ? (
              <span className="badge"><IconBell size={12} /> Browser alerts on</span>
            ) : perm === "denied" ? (
              <span className="badge" title="Allow notifications for this site in your browser settings">Notifications blocked</span>
            ) : perm === "default" ? (
              <button className="btn sm" onClick={ask}><IconBell size={14} /> Notify me in the browser</button>
            ) : null}
          </div>
        </div>
        {isLoading ? (
          <div className="alert-grid">{Array.from({ length: 6 }, (_, i) => <div key={i} className="alert"><Skeleton w="50%" h={14} /><Skeleton h={12} /><Skeleton w="70%" h={12} /></div>)}</div>
        ) : error && !alerts.length ? (
          <div className="panel"><ErrorState error={error} retry={() => refetch()} /></div>
        ) : !alerts.length ? (
          <div className="panel"><Empty title="No alerts yet">The first graduation or whale trade will show up here instantly.</Empty></div>
        ) : (
          <div className="alert-grid">
            {alerts.map((a) => {
              const k = alertKind(a.kind);
              return (
                <article key={a.id} className={`alert ${a.kind}${fresh.current.has(a.id) ? " enter" : ""}`} style={cssVar("--k", k.color)}>
                  <div className="kind">
                    {k.icon(14)}
                    <span>{k.label}</span>
                    <span className="spacer" />
                    <span className="tnum"><Ago at={a.at} /></span>
                  </div>
                  <h3>{a.title}</h3>
                  <p>{a.text}</p>
                  {(a.coin || a.agent != null) && (
                    <div className="foot">
                      {a.coin && <Link href={`/coins/${a.coin}`} className="btn sm">View coin</Link>}
                      {a.agent != null && <Link href={`/agents/${a.agent}`} className="btn sm ghost">View agent</Link>}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
