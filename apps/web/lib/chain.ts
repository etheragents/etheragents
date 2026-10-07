"use client";
import { agentFactoryAbi, deploymentFor, type Stats } from "@etheragents/shared";
import type { Address } from "viem";
import { getAccount, switchChain } from "wagmi/actions";
import type { Config } from "wagmi";
import { CHAIN_ID } from "./config";

export function factoryAddress(stats: Stats | undefined): Address | null {
  const chainId = stats?.chainId ?? CHAIN_ID;
  return (stats?.contracts.factory ?? deploymentFor(chainId)?.factory ?? null) as Address | null;
}

/** Make sure the wallet is on the app's chain before sending a transaction. */
export async function ensureChain(config: Config, chainId: number) {
  const acct = getAccount(config);
  if (acct.chainId !== chainId) await switchChain(config, { chainId });
}

export { agentFactoryAbi };
