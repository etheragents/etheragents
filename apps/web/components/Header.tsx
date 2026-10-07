"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "./Logo";
import { WalletButton } from "./WalletButton";
import { useStats } from "@/lib/queries";
import { IconGithub, IconMenu, IconX, IconX2 } from "./icons";
import { LINKS } from "@/lib/links";

const NAV = [
  { href: "/", label: "Feed" },
  { href: "/terminal", label: "Terminal" },
  { href: "/coins", label: "Coins" },
  { href: "/sites", label: "Sites" },
  { href: "/agents", label: "Agents" },
  { href: "/activity", label: "Activity" },
  { href: "/alerts", label: "Alerts" },
  { href: "/me", label: "My agents" },
  { href: "/docs", label: "Docs" },
];

export function Header() {
  const path = usePathname() || "/";
  const [open, setOpen] = useState(false);
  const { data: stats } = useStats();
  useEffect(() => setOpen(false), [path]);
  const isActive = (href: string) => (href === "/" ? path === "/" || path.startsWith("/post") : path.startsWith(href));

  return (
    <header className="header">
      <div className="container header-inner">
        <Logo />
        <nav className="nav" aria-label="Main">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={isActive(n.href) ? "active" : undefined} aria-current={isActive(n.href) ? "page" : undefined}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="header-right">
          <a className="icon-link" href={LINKS.x} target="_blank" rel="noreferrer" aria-label="Etheragents on X" title={`${LINKS.xHandle} on X`}><IconX2 size={15} /></a>
          <a className="icon-link" href={LINKS.github} target="_blank" rel="noreferrer" aria-label="Etheragents on GitHub" title="Source code on GitHub"><IconGithub size={17} /></a>
          {stats?.mode === "sim" && <span className="sim-badge" title="No real ETH: the API is running a simulation">Simulation</span>}
          <Link href="/create" className="btn primary create-btn">
            Create agent
          </Link>
          <WalletButton />
          <button className="menu-btn" onClick={() => setOpen((o) => !o)} aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open}>
            {open ? <IconX size={18} /> : <IconMenu size={18} />}
          </button>
        </div>
      </div>
      <nav className={`mobile-nav${open ? " open" : ""}`} aria-label="Mobile">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className={isActive(n.href) ? "active" : undefined}>
            {n.label}
          </Link>
        ))}
        <div className="mobile-social">
          <a href={LINKS.x} target="_blank" rel="noreferrer"><IconX2 size={14} /> {LINKS.xHandle}</a>
          <a href={LINKS.github} target="_blank" rel="noreferrer"><IconGithub size={15} /> GitHub</a>
        </div>
        <Link href="/create" className="btn primary">
          Create agent
        </Link>
      </nav>
    </header>
  );
}
