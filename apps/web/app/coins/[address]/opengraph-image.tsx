import { ImageResponse } from "next/og";
import type { Coin } from "@etheragents/shared";
import { apiGetServer, C, fmtEthOg, OG_SIZE, OgBrand, ogFonts } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "A coin on Etheragents";

export default async function Image({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  const data = await apiGetServer<{ coin: Coin }>(`/api/coins/${encodeURIComponent(address)}`);
  const fonts = await ogFonts();
  const c = data?.coin;
  if (!c) return new ImageResponse(<div style={{ display: "flex", width: "100%", height: "100%", background: C.ink, alignItems: "center", justifyContent: "center" }}><OgBrand /></div>, { ...size, fonts });
  const prog = c.graduated ? 1 : c.progress;
  return new ImageResponse(
    (
      <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", background: C.ink, padding: "56px 64px", fontFamily: "Sans", color: C.text }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <OgBrand />
          <span style={{ fontSize: 24, color: C.text2 }}>etheragents.fun</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 36, marginTop: 64 }}>
          <div style={{ display: "flex", width: 150, height: 150, borderRadius: 75, background: c.color, alignItems: "center", justifyContent: "center", fontFamily: "Wide", fontSize: 64, color: C.ink }}>
            {c.symbol.slice(0, 1)}
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontFamily: "Wide", fontSize: 92, letterSpacing: "-0.04em", lineHeight: 1 }}>${c.symbol}</span>
            <span style={{ fontFamily: "Serif", fontSize: 44, color: C.text2, marginTop: 10 }}>{c.name}</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 56, marginTop: "auto", fontSize: 26, color: C.text2 }}>
          <div style={{ display: "flex", flexDirection: "column" }}><span style={{ color: C.text, fontSize: 38, fontWeight: 600 }}>{fmtEthOg(c.mcapEth)}</span>market cap</div>
          <div style={{ display: "flex", flexDirection: "column" }}><span style={{ color: C.text, fontSize: 38, fontWeight: 600 }}>{c.holders}</span>holders</div>
          <div style={{ display: "flex", flexDirection: "column" }}><span style={{ color: C.text, fontSize: 38, fontWeight: 600 }}>@{c.creator}</span>its agent</div>
        </div>
        <div style={{ display: "flex", marginTop: 28, height: 10, borderRadius: 5, background: C.line, width: "100%" }}>
          <div style={{ display: "flex", width: `${Math.max(2, prog * 100)}%`, height: 10, borderRadius: 5, background: c.graduated ? C.buy : c.color }} />
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}
