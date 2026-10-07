import { ImageResponse } from "next/og";
import type { Agent } from "@etheragents/shared";
import { apiGetServer, C, fmtEthOg, OG_SIZE, OgBrand, ogFonts } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "An agent on Etheragents";

export default async function Image({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const data = await apiGetServer<{ agent: Agent }>(`/api/agents/${encodeURIComponent(handle)}`);
  const fonts = await ogFonts();
  const a = data?.agent;
  if (!a) return new ImageResponse(<div style={{ display: "flex", width: "100%", height: "100%", background: C.ink, alignItems: "center", justifyContent: "center" }}><OgBrand /></div>, { ...size, fonts });
  return new ImageResponse(
    (
      <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", background: C.ink, padding: "56px 64px", fontFamily: "Sans", color: C.text }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <OgBrand />
          <span style={{ fontSize: 24, color: C.text2 }}>etheragents.fun</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 36, marginTop: 60 }}>
          <div style={{ display: "flex", width: 150, height: 150, borderRadius: 36, background: a.color, alignItems: "center", justifyContent: "center", fontFamily: "Wide", fontSize: 72, color: C.ink }}>
            {a.name.slice(0, 1)}
          </div>
          <div style={{ display: "flex", flexDirection: "column", maxWidth: 820 }}>
            <span style={{ fontFamily: "Serif", fontSize: 84, lineHeight: 1 }}>{a.name}</span>
            <span style={{ fontSize: 30, color: C.text2, marginTop: 10 }}>@{a.handle}, an AI agent</span>
          </div>
        </div>
        {a.self ? <div style={{ display: "flex", fontSize: 32, color: C.text, marginTop: 40, maxWidth: 1000, lineHeight: 1.35 }}>{a.self}</div> : null}
        <div style={{ display: "flex", gap: 56, marginTop: "auto", fontSize: 26, color: C.text2 }}>
          <div style={{ display: "flex", flexDirection: "column" }}><span style={{ color: C.text, fontSize: 38, fontWeight: 600 }}>{a.coinSymbol ? `$${a.coinSymbol}` : "Not yet"}</span>its coin</div>
          <div style={{ display: "flex", flexDirection: "column" }}><span style={{ color: C.text, fontSize: 38, fontWeight: 600 }}>{a.influence}</span>influence</div>
          <div style={{ display: "flex", flexDirection: "column" }}><span style={{ color: a.realizedEth >= 0 ? C.buy : "#F07178", fontSize: 38, fontWeight: 600 }}>{(a.realizedEth >= 0 ? "+" : "") + fmtEthOg(a.realizedEth)}</span>realized PnL</div>
          <div style={{ display: "flex", flexDirection: "column" }}><span style={{ color: C.text, fontSize: 38, fontWeight: 600 }}>{a.followers}</span>followers</div>
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}
