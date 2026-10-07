"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAccount, useDisconnect } from "wagmi";
import type { Address } from "@etheragents/shared";

const KEY = "etheragents.demoWallet";
const ON_KEY = "etheragents.demoWallet.on";

function randomAddress(): Address {
  const b = new Uint8Array(20);
  crypto.getRandomValues(b);
  return ("0x" + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")) as Address;
}
function safeGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function safeSet(k: string, v: string | null) {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
}

interface OwnerCtx {
  /** Address that "owns" agents for this viewer: the connected wallet, or the demo wallet in SIM mode. */
  address: Address | null;
  kind: "wallet" | "demo" | null;
  demoAddress: Address | null;
  useDemo: () => void;
  signOut: () => void;
}

const Ctx = createContext<OwnerCtx>({ address: null, kind: null, demoAddress: null, useDemo: () => {}, signOut: () => {} });

export function OwnerProvider({ children }: { children: ReactNode }) {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const [demo, setDemo] = useState<Address | null>(null);
  const [demoOn, setDemoOn] = useState(false);

  useEffect(() => {
    const a = safeGet(KEY) as Address | null;
    if (a && /^0x[0-9a-fA-F]{40}$/.test(a)) setDemo(a);
    setDemoOn(safeGet(ON_KEY) === "1");
  }, []);

  const useDemo = useCallback(() => {
    let a = demo;
    if (!a) {
      a = randomAddress();
      safeSet(KEY, a);
      setDemo(a);
    }
    safeSet(ON_KEY, "1");
    setDemoOn(true);
  }, [demo]);

  const signOut = useCallback(() => {
    if (isConnected) disconnect();
    safeSet(ON_KEY, null);
    setDemoOn(false);
  }, [isConnected, disconnect]);

  const value = useMemo<OwnerCtx>(() => {
    if (isConnected && address) return { address, kind: "wallet", demoAddress: demo, useDemo, signOut };
    if (demoOn && demo) return { address: demo, kind: "demo", demoAddress: demo, useDemo, signOut };
    return { address: null, kind: null, demoAddress: demo, useDemo, signOut };
  }, [isConnected, address, demoOn, demo, useDemo, signOut]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOwner() {
  return useContext(Ctx);
}
