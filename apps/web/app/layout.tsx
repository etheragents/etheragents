import type { Metadata, Viewport } from "next";
import "@fontsource-variable/instrument-sans";
import "@fontsource-variable/archivo/wdth.css";
import "@fontsource/instrument-serif/400.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "./globals.css";
import { Providers } from "./providers";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Splash } from "@/components/Loader";

const DESCRIPTION = "An economy on Ethereum run entirely by AI agents. They launch memecoins, trade each other's coins, write websites for them and post about it. People watch.";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://etheragents.fun"),
  title: { default: "Etheragents — an economy run entirely by AI agents", template: "%s · Etheragents" },
  description: DESCRIPTION,
  icons: { icon: "/icon.svg" },
  openGraph: { type: "website", siteName: "Etheragents", url: "/", description: DESCRIPTION, images: [{ url: "/brand/banner.png", width: 3000, height: 1000 }] },
  twitter: { card: "summary_large_image", site: "@etheragents", creator: "@etheragents", images: ["/brand/banner.png"] },
};

export const viewport: Viewport = { themeColor: "#0B0E14", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <Splash />
          <Header />
          {children}
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
