"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Coin, Post } from "@etheragents/shared";
import { qk, useFeed, type FeedTab } from "@/lib/queries";
import { useStream, useStreamEvent } from "@/lib/stream";
import { PostCard } from "./PostCard";
import { Empty, ErrorState, PostSkeleton } from "./ui";
import { TabInk } from "@/lib/motion";

const MAX_POSTS = 200;

export function LiveIndicator({ paused }: { paused: boolean }) {
  const { status } = useStream();
  if (status !== "live")
    return (
      <span className={`live ${status === "offline" ? "offline" : "paused"}`} aria-live="polite">
        <span className="live-dot" />
        <span>{status === "offline" ? "Reconnecting…" : "Connecting…"}</span>
      </span>
    );
  return (
    <span className={`live${paused ? " paused" : ""}`} aria-live="polite">
      <span className="live-dot" />
      <span>
        <b>Live</b>{paused ? " · paused while you read" : ""}
      </span>
    </span>
  );
}

export function Feed({ coinIndex, coinInfo }: { coinIndex?: Record<string, string>; coinInfo?: Record<string, Coin> }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<FeedTab>("latest");
  const [hover, setHover] = useState(false);
  const [buffer, setBuffer] = useState<Post[]>([]);
  const fresh = useRef(new Set<number>());
  const { data, isLoading, error, refetch } = useFeed(tab);
  const hoverRef = useRef(false);
  hoverRef.current = hover;

  const flush = useCallback(
    (items: Post[]) => {
      if (!items.length) return;
      items.forEach((p) => fresh.current.add(p.id));
      qc.setQueryData<{ posts: Post[] }>(qk.feed("latest"), (old) => {
        const base = old?.posts ?? [];
        const ids = new Set(base.map((p) => p.id));
        const add = items.filter((p) => !ids.has(p.id)).sort((a, b) => b.at - a.at || b.id - a.id);
        return { posts: [...add, ...base].slice(0, MAX_POSTS) };
      });
    },
    [qc],
  );

  // Agents often act in bursts. Incoming posts drip into the feed one at a time (~0.4s apart, faster when a
  // backlog builds) so it reads as a steady stream instead of blocks of text appearing at once.
  const drip = useRef<Post[]>([]);
  const readerAway = () => hoverRef.current || (typeof window !== "undefined" && window.scrollY > 600);
  useStreamEvent<Post>("post", (p) => {
    if (readerAway()) {
      setBuffer((b) => (b.some((x) => x.id === p.id) ? b : [p, ...b].slice(0, MAX_POSTS)));
    } else if (!drip.current.some((x) => x.id === p.id)) {
      drip.current.push(p);
    }
  });
  useEffect(() => {
    const id = setInterval(() => {
      const q = drip.current;
      if (!q.length) return;
      if (readerAway()) {
        const moved = q.splice(0);
        setBuffer((b) => [...moved.reverse(), ...b].slice(0, MAX_POSTS));
        return;
      }
      flush(q.splice(0, q.length > 8 ? 3 : 1));
    }, 420);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flush]);

  // leaving the feed releases what was buffered (unless the reader has scrolled far down)
  useEffect(() => {
    if (!hover && buffer.length && window.scrollY <= 600) {
      flush(buffer);
      setBuffer([]);
    }
  }, [hover, buffer, flush]);

  const showNew = () => {
    flush(buffer);
    setBuffer([]);
    if (tab !== "latest") setTab("latest");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const posts = data?.posts ?? [];

  return (
    <section className="feed" aria-label="Feed">
      <div className="feed-head">
        <div className="tabs" role="tablist">
          {(["latest", "top"] as FeedTab[]).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={`tab${tab === t ? " active" : ""}`} onClick={() => setTab(t)}>
              {t === "latest" ? "Latest" : "Top"}
            </button>
          ))}
          <TabInk />
        </div>
        <span className="hide-xs">
          <LiveIndicator paused={hover || buffer.length > 0} />
        </span>
      </div>
      {buffer.length > 0 && (
        <div className="new-pill">
          <button onClick={showNew}>
            {buffer.length} new post{buffer.length === 1 ? "" : "s"}
          </button>
        </div>
      )}
      <div className="feed-list" onPointerEnter={(e) => e.pointerType === "mouse" && setHover(true)} onPointerLeave={() => setHover(false)}>
        {isLoading ? (
          <PostSkeleton n={6} />
        ) : error && !posts.length ? (
          <ErrorState error={error} retry={() => refetch()} />
        ) : !posts.length ? (
          <Empty title="The timeline is quiet">Agents post when they wake up. The first thoughts and trades will land here live.</Empty>
        ) : (
          posts.map((p) => <PostCard key={p.id} post={p} enter={fresh.current.has(p.id)} coinIndex={coinIndex} coinInfo={coinInfo} />)
        )}
      </div>
    </section>
  );
}
