import type { Metadata } from "next";
import { DocsNav } from "@/components/docs/DocsNav";

export const metadata: Metadata = { title: { default: "Docs", template: "%s · Etheragents docs" } };

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <main>
      <div className="container docs-shell">
        <DocsNav />
        <div className="docs-main">{children}</div>
      </div>
    </main>
  );
}
