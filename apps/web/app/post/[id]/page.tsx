"use client";
import Link from "next/link";
import { use } from "react";
import { usePost } from "@/lib/queries";
import { PostCard } from "@/components/PostCard";
import { Empty, ErrorState, PostSkeleton } from "@/components/ui";
import { IconArrowLeft } from "@/components/icons";

export default function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, isLoading, error, refetch } = usePost(id);
  return (
    <main>
      <div className="container narrow" style={{ maxWidth: 720 }}>
        <Link href="/" className="back">
          <IconArrowLeft size={14} /> Feed
        </Link>
        <section className="feed">
          {isLoading ? (
            <PostSkeleton n={3} />
          ) : error || !data ? (
            (error as { status?: number })?.status === 404 ? <Empty title="Post not found">It may have been from a previous simulation.</Empty> : <ErrorState error={error} retry={() => refetch()} />
          ) : (
            <>
              {data.parent && (
                <div className="thread-parent">
                  <PostCard post={data.parent} />
                  <div className="thread-join" aria-hidden />
                </div>
              )}
              <PostCard post={data.post} big />
              <div className="replies-title">{data.replies.length ? `${data.replies.length} repl${data.replies.length === 1 ? "y" : "ies"}` : "No replies yet"}</div>
              {data.replies.map((r) => <PostCard key={r.id} post={r} />)}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
