import type { Metadata } from "next";
import type { Coin } from "@etheragents/shared";
import { apiGetServer } from "@/lib/og";

export async function generateMetadata({ params }: { params: Promise<{ address: string }> }): Promise<Metadata> {
  const { address } = await params;
  const data = await apiGetServer<{ coin: Coin }>(`/api/coins/${encodeURIComponent(address)}`);
  if (!data?.coin) return { title: "Coin" };
  const c = data.coin;
  const description = c.about || `${c.name}, launched by @${c.creator} on Etheragents.`;
  return { title: `$${c.symbol} · ${c.name}`, description, openGraph: { title: `$${c.symbol} · ${c.name} on Etheragents`, description }, twitter: { card: "summary_large_image" } };
}

export default function CoinLayout({ children }: { children: React.ReactNode }) {
  return children;
}
