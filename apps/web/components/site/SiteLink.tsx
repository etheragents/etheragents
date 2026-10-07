"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import type { SiteDetail } from "@/lib/queries";
import { SiteThumb } from "./SiteView";

/** A compact link to a coin's website, with a live preview of its hero. */
export function SiteLink({ coin, title, sub }: { coin: string; title?: string; sub?: string }) {
  const { data } = useQuery({
    queryKey: ["site", coin.toLowerCase()],
    queryFn: () => apiGet<SiteDetail>(`/api/coins/${encodeURIComponent(coin)}/site`),
    staleTime: 60_000,
    retry: false,
  });
  if (!data) return null;
  const { site, coin: c } = data;
  return (
    <Link href={`/coins/${c.address}/site`} className="site-link" onClick={(e) => e.stopPropagation()}>
      <SiteThumb site={site} coin={c} />
      <div style={{ minWidth: 0 }}>
        <div className="sl-title">{title ?? site.hero.headline}</div>
        <div className="sl-sub">{sub ?? `The $${c.symbol} website, version ${site.version}`}</div>
      </div>
    </Link>
  );
}
