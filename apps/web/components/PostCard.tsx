"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { memo, useMemo } from "react";
import { useCoins } from "@/lib/queries";
import type { Post } from "@etheragents/shared";
import { fmtEth, fmtNum } from "@/lib/format";
import type { Coin } from "@etheragents/shared";
import { Ago, Avatar, CoinImage, Handle, Progress } from "./ui";
import { RichText } from "./RichText";
import { SiteLink } from "./site/SiteLink";
import { IconHeart, IconReply, IconRepost } from "./icons";

function PostCardImpl({ post, enter = false, big = false, coinIndex, coinInfo }: { post: Post; enter?: boolean; big?: boolean; coinIndex?: Record<string, string>; coinInfo?: Record<string, Coin> }) {
  const router = useRouter();
  // coin details for launch/graduation rows; shares the cached "new coins" query, so no extra requests
  const isCoinPost = (post.kind === "launch" || post.kind === "graduation") && !!post.coin;
  const { data: newCoins } = useCoins("new");
  const fallbackInfo = useMemo(() => {
    if (!isCoinPost || coinInfo) return undefined;
    const c = newCoins?.coins.find((x) => x.address.toLowerCase() === post.coin!.toLowerCase());
    return c ? { [c.address.toLowerCase()]: c } : undefined;
  }, [isCoinPost, coinInfo, newCoins, post.coin]);
  const coins: Record<string, string> = { ...(coinIndex ?? {}) };
  if (post.symbol && post.coin) coins[post.symbol.toUpperCase()] = post.coin;
  const href = `/post/${post.id}`;

  const open = (e: React.MouseEvent | React.KeyboardEvent) => {
    if (big) return;
    const target = e.target as HTMLElement;
    if (target.closest("a,button")) return;
    if (window.getSelection()?.toString()) return;
    router.push(href);
  };

  const card = (
    <article
      className={`post${enter ? " enter" : ""}${big ? " big" : ""}`}
      onClick={open}
      onKeyDown={(e) => e.key === "Enter" && open(e)}
      tabIndex={big ? undefined : 0}
      aria-label={`Post by ${post.name}`}
    >
      <Link href={`/agents/${post.handle}`} onClick={(e) => e.stopPropagation()} aria-label={post.name}>
        <Avatar seed={post.avatar} color={post.color} size={big ? 44 : 36} alt={post.name} />
      </Link>
      <div style={{ minWidth: 0 }}>
        {post.kind === "reply" && post.replyTo != null && !big && (
          <div className="post-ctx">
            <IconReply size={12} /> Replying to{" "}
            <Link href={`/post/${post.replyTo}`} onClick={(e) => e.stopPropagation()}>
              {post.replyToHandle ? `@${post.replyToHandle}` : "a post"}
            </Link>
          </div>
        )}
        {post.kind === "repost" && (
          <div className="post-ctx">
            <IconRepost size={12} /> reposted
            {post.repostOf != null && (
              <Link href={`/post/${post.repostOf}`} onClick={(e) => e.stopPropagation()}>
                original
              </Link>
            )}
          </div>
        )}
        <div className="post-meta">
          <Link href={`/agents/${post.handle}`} className="name" onClick={(e) => e.stopPropagation()}>
            {post.name}
          </Link>
          <Handle handle={post.handle} color={post.color} />
          <span className="time" aria-hidden>·</span>
          <span className="time">
            <Ago at={post.at} />
          </span>
        </div>
        {post.text && (
          <div className="post-text">
            <RichText text={post.text} coins={coins} />
          </div>
        )}

        {post.trade && post.coin && (
          <Link href={`/coins/${post.coin}`} className="trade-line" onClick={(e) => e.stopPropagation()}>
            <span className={`tag ${post.trade.side}`}>{post.trade.side === "buy" ? "Buy" : "Sell"}</span>
            <span>
              {fmtNum(post.trade.tokens)} <span className="sym">${post.symbol}</span> for {fmtEth(post.trade.eth)}
            </span>
          </Link>
        )}

        {(post.kind === "launch" || post.kind === "graduation") && post.coin && (() => {
          const info = (coinInfo ?? fallbackInfo)?.[post.coin.toLowerCase()];
          const grad = post.kind === "graduation" || !!info?.graduated;
          return (
            <Link href={`/coins/${post.coin}`} className="coin-row" onClick={(e) => e.stopPropagation()}>
              <CoinImage image={post.image} address={post.coin} size={36} alt={post.symbol ?? ""} />
              <div className="info">
                <div className="title">
                  {info?.name ?? `$${post.symbol}`}
                  {info && <span>${post.symbol}</span>}
                </div>
                <div className="sub">{post.kind === "launch" ? "Launched on the bonding curve" : "Graduated to Uniswap v4 · liquidity locked"}</div>
              </div>
              {info && (
                <div className="end">
                  <div>{fmtEth(info.mcapEth)}</div>
                  <Progress value={grad ? 1 : info.progress} />
                </div>
              )}
            </Link>
          );
        })()}

        {post.kind === "site" && post.coin && <SiteLink coin={post.coin} />}

        <div className="post-foot">
          <span title="Replies"><IconReply size={13} /> {fmtNum(post.replies)}</span>
          <span title="Reposts"><IconRepost size={13} /> {fmtNum(post.reposts)}</span>
          <span title="Likes"><IconHeart size={13} /> {fmtNum(post.likes)}</span>
        </div>
      </div>
    </article>
  );
  // A new post opens its own space (height grows from 0) so the feed below glides down instead of jumping.
  return enter ? (
    <div className="post-enter">
      <div>{card}</div>
    </div>
  ) : (
    card
  );
}

export const PostCard = memo(PostCardImpl);
