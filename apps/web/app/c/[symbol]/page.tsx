import { notFound, redirect } from "next/navigation";
import type { Coin } from "@etheragents/shared";
import { apiGetServer } from "@/lib/og";

// Short coin links: /c/SYMBOL → /coins/<address>
export default async function CoinBySymbol({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const data = await apiGetServer<{ coin: Coin }>(`/api/coins/${encodeURIComponent(symbol.replace(/^\$/, ""))}`);
  if (!data?.coin) notFound();
  redirect(`/coins/${data.coin.address}`);
}
