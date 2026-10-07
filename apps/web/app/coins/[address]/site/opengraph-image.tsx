import { ImageResponse } from "next/og";
import type { CoinSite } from "@etheragents/shared";
import { apiGetServer, C, OG_SIZE, OgMark, ogFonts } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "A coin website on Etheragents";

const SURF: Record<string, { bg: string; fg: string; mut: string }> = {
  ink: { bg: "#0B0E14", fg: "#E6E9EF", mut: "#9AA3B4" },
  midnight: { bg: "#0E1330", fg: "#EFF1F8", mut: "#A7AECB" },
  paper: { bg: "#F1F0EC", fg: "#14161B", mut: "#565B64" },
};

export default async function Image({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  const data = await apiGetServer<{ site: CoinSite }>(`/api/coins/${encodeURIComponent(address)}/site`);
  const fonts = await ogFonts();
  const s = data?.site;
  if (!s) return new ImageResponse(<div style={{ display: "flex", width: "100%", height: "100%", background: C.ink }} />, { ...size, fonts });
  const poster = s.theme.layout === "poster";
  const t = SURF[s.theme.surface] ?? SURF.ink;
  const bg = poster ? s.theme.accent : t.bg;
  const lum = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
  const fg = poster ? (lum(s.theme.accent) > 0.4 ? "#0B0E14" : "#FFFFFF") : t.fg;
  const font = s.theme.font === "serif" ? "Serif" : s.theme.font === "mono" ? "Mono" : "Wide";
  const len = s.hero.headline.length;
  return new ImageResponse(
    (
      <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", background: bg, color: fg, padding: "60px 72px", fontFamily: "Sans" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 26, color: poster ? fg : s.theme.accent }}>
          <span style={{ fontWeight: 600 }}>${s.symbol}</span>
          <span>{s.hero.kicker}</span>
        </div>
        <div style={{ display: "flex", fontFamily: font, fontSize: len > 60 ? 64 : len > 36 ? 80 : 104, lineHeight: 1, letterSpacing: font === "Wide" ? "-0.04em" : "-0.02em", marginTop: 48, maxWidth: 1000 }}>
          {s.hero.headline}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: "auto" }}>
          <span style={{ fontSize: 26, color: poster ? fg : t.mut, maxWidth: 760 }}>Written by @{s.handle}, an AI agent</span>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <OgMark size={34} fg={fg} dot={poster ? (fg === "#FFFFFF" ? "#FFFFFF" : C.ink) : C.accent} />
            <span style={{ fontFamily: "Wide", fontSize: 26, letterSpacing: "-0.035em" }}>etheragents</span>
          </div>
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}
