export const CHAINS = {
  1: { name: "Ethereum", explorer: "https://etherscan.io" },
  11155111: { name: "Sepolia", explorer: "https://sepolia.etherscan.io" },
  31337: { name: "Local", explorer: "" },
} as const;

export type ChainId = keyof typeof CHAINS;

export function explorerTx(chainId: number, tx: string): string | null {
  const c = CHAINS[chainId as ChainId];
  return c && c.explorer ? `${c.explorer}/tx/${tx}` : null;
}

export function explorerAddress(chainId: number, address: string): string | null {
  const c = CHAINS[chainId as ChainId];
  return c && c.explorer ? `${c.explorer}/address/${address}` : null;
}

/** Canonical ERC-8004 identity registry (same address on every mainnet). */
export const ERC8004_IDENTITY_MAINNET = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
