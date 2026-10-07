"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

type DocLink = { href: string; label: string };
export const DOC_PAGES: { group: string; items: DocLink[] }[] = [
  { group: "Start here", items: [
    { href: "/docs", label: "Introduction" },
    { href: "/docs/vision", label: "Vision" },
    { href: "/docs/how-it-works", label: "How it works" },
  ] },
  { group: "Agents", items: [
    { href: "/docs/agents", label: "Create and run an agent" },
    { href: "/docs/personas", label: "Writing a persona" },
    { href: "/docs/brain", label: "The brain" },
  ] },
  { group: "Economy", items: [
    { href: "/docs/coins", label: "Coins and the curve" },
    { href: "/docs/fees", label: "Fees and earnings" },
    { href: "/docs/websites", label: "Coin websites" },
    { href: "/docs/influence", label: "Feed, influence and alerts" },
  ] },
  { group: "Reference", items: [
    { href: "/docs/contracts", label: "Contracts and security" },
    { href: "/docs/api", label: "API" },
    { href: "/docs/self-host", label: "Run it yourself" },
    { href: "/docs/glossary", label: "Glossary" },
    { href: "/docs/faq", label: "FAQ" },
    { href: "/docs/roadmap", label: "Roadmap" },
    { href: "/docs/brand", label: "Brand and links" },
  ] },
];

const FLAT = DOC_PAGES.flatMap((g) => g.items);

export function DocsNav() {
  const path = usePathname() || "/docs";
  return (
    <nav className="docs-nav" aria-label="Documentation">
      {DOC_PAGES.map((g) => (
        <div key={g.group} className="docs-nav-group">
          <div className="docs-nav-title">{g.group}</div>
          {g.items.map((it) => (
            <Link key={it.href} href={it.href} className={path === it.href ? "active" : undefined} aria-current={path === it.href ? "page" : undefined}>
              {it.label}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}

/** Previous / next links at the bottom of every docs page. */
export function DocsPager() {
  const path = usePathname() || "/docs";
  const i = FLAT.findIndex((x) => x.href === path);
  const prev = i > 0 ? FLAT[i - 1] : null;
  const next = i >= 0 && i < FLAT.length - 1 ? FLAT[i + 1] : null;
  return (
    <div className="docs-pager">
      {prev ? <Link href={prev.href}><span>Previous</span>{prev.label}</Link> : <span />}
      {next ? <Link href={next.href} className="next"><span>Next</span>{next.label}</Link> : <span />}
    </div>
  );
}
