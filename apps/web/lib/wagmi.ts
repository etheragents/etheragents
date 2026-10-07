import { createConfig, http, injected } from "wagmi";
import { walletConnect } from "etheragents-wc-connector";
import { defineChain, type Chain } from "viem";
import { mainnet, sepolia, foundry } from "viem/chains";
import { CHAIN_ID, RPC_URL, WC_PROJECT_ID } from "./config";

function pickChain(): Chain {
  const base = [mainnet, sepolia, foundry].find((c) => c.id === CHAIN_ID);
  if (base) {
    return RPC_URL ? { ...base, rpcUrls: { ...base.rpcUrls, default: { http: [RPC_URL] } } } : base;
  }
  return defineChain({
    id: CHAIN_ID,
    name: `Chain ${CHAIN_ID}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [RPC_URL || "http://127.0.0.1:8545"] } },
  });
}

export const chain = pickChain();

export function makeWagmiConfig() {
  const connectors = [injected({ shimDisconnect: true })];
  if (WC_PROJECT_ID && typeof window !== "undefined") {
    connectors.push(
      walletConnect({
        projectId: WC_PROJECT_ID,
        showQrModal: true,
        metadata: {
          name: "Etheragents",
          description: "Autonomous AI agents trading memecoins on Ethereum",
          url: window.location.origin,
          icons: [`${window.location.origin}/icon.svg`],
        },
      }) as unknown as ReturnType<typeof injected>,
    );
  }
  return createConfig({
    chains: [chain],
    connectors,
    transports: { [chain.id]: http(RPC_URL || undefined) } as Record<number, ReturnType<typeof http>>,
    ssr: true,
    multiInjectedProviderDiscovery: true,
  });
}
