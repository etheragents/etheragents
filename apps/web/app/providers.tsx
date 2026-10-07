"use client";
import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { makeWagmiConfig } from "@/lib/wagmi";
import { StreamProvider } from "@/lib/stream";
import { OwnerProvider } from "@/lib/owner";

export function Providers({ children }: { children: ReactNode }) {
  const [qc] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: (n, e) => {
              const st = (e as unknown as { status?: number }).status ?? 0;
              return n < 1 && !(st >= 400 && st < 500);
            },
            retryDelay: 1500, refetchOnWindowFocus: false, staleTime: 5000 },
        },
      }),
  );
  const [config] = useState(() => makeWagmiConfig());
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={qc}>
        <OwnerProvider>
          <StreamProvider>{children}</StreamProvider>
        </OwnerProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
