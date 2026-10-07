"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAccount, useConnect } from "wagmi";
import { useOwner } from "@/lib/owner";
import { useStats } from "@/lib/queries";
import { shortAddr } from "@/lib/format";
import { errMsg } from "@/lib/api";
import { IconWallet } from "./icons";

export function WalletButton() {
  const { address, kind, useDemo, signOut } = useOwner();
  const { connectors, connect, isPending, error } = useConnect();
  const { isConnected } = useAccount();
  const { data: stats } = useStats();
  const sim = stats?.mode === "sim";
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  useEffect(() => {
    if (isConnected) setOpen(false);
  }, [isConnected]);

  const hasInjected = mounted && typeof window !== "undefined" && !!(window as unknown as { ethereum?: unknown }).ethereum;
  // de-duplicate EIP-6963 + generic injected entries
  const seen = new Set<string>();
  const list = connectors.filter((c) => {
    const k = c.name.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    if (c.type === "injected" && c.id === "injected" && !hasInjected) return false;
    return true;
  });

  if (!mounted) {
    return (
      <button className="btn" disabled>
        <IconWallet size={15} /> <span className="hide-xs">Connect</span>
      </button>
    );
  }

  return (
    <div className="wallet" ref={ref}>
      {address ? (
        <button className="btn" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span className={`wallet-dot${kind === "demo" ? " demo" : ""}`} />
          <span className="mono" style={{ fontSize: 12.5 }}>{shortAddr(address)}</span>
        </button>
      ) : (
        <button className="btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} disabled={isPending}>
          <IconWallet size={15} /> <span className="hide-xs">{isPending ? "Connecting…" : "Connect"}</span>
        </button>
      )}
      {open && (
        <div className="menu" role="menu">
          {address ? (
            <>
              <div className="note">
                {kind === "demo" ? "Demo wallet (simulation only)" : "Connected wallet"}
                <div className="mono" style={{ color: "var(--text)", marginTop: 3, fontSize: 12 }}>{address}</div>
              </div>
              <div className="sep" />
              <Link href="/me" onClick={() => setOpen(false)}>My agents</Link>
              <Link href="/create" onClick={() => setOpen(false)}>Create agent</Link>
              <div className="sep" />
              <button onClick={() => { signOut(); setOpen(false); }}>Disconnect</button>
            </>
          ) : (
            <>
              {list.map((c) => (
                <button key={c.uid} onClick={() => connect({ connector: c })}>
                  {c.icon ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.icon} alt="" width={18} height={18} style={{ borderRadius: 4 }} />
                  ) : (
                    <IconWallet size={16} />
                  )}
                  {c.id === "injected" ? "Browser wallet" : c.name}
                </button>
              ))}
              {list.length === 0 && <div className="note">No browser wallet found.</div>}
              {sim && (
                <>
                  <div className="sep" />
                  <button onClick={() => { useDemo(); setOpen(false); }}>
                    <span className="wallet-dot demo" /> Use demo wallet
                  </button>
                  <div className="note">Simulation mode: a demo address kept in this browser lets you create and manage agents without a wallet.</div>
                </>
              )}
              {error && <div className="note" style={{ color: "var(--sell)" }}>{errMsg(error)}</div>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
