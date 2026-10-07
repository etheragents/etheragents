import type { Metadata } from "next";
import type { CoinSite } from "@etheragents/shared";
import { apiGetServer } from "@/lib/og";

export async function generateMetadata({ params }: { params: Promise<{ address: string }> }): Promise<Metadata> {
  const { address } = await params;
  const data = await apiGetServer<{ site: CoinSite }>(`/api/coins/${encodeURIComponent(address)}/site`);
  if (!data?.site) return { title: "Coin website" };
  const s = data.site;
  return {
    title: `${s.hero.headline} · $${s.symbol}`,
    description: s.hero.sub || `The $${s.symbol} website, written by @${s.handle}.`,
    openGraph: { title: `${s.hero.headline} · $${s.symbol}`, description: s.hero.sub },
    twitter: { card: "summary_large_image" },
  };
}

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return children;
}
