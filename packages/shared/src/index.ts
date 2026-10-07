export * from "./types.ts";
export * from "./chains.ts";
export * from "./persona.ts";
export * from "./abi.ts";
import { deploymentsData } from "./deployments.ts";

export interface Deployment {
  chainId: number;
  network?: string;
  poolManager: `0x${string}`;
  identityRegistry: `0x${string}`;
  launchpad: `0x${string}`;
  factory: `0x${string}`;
  coinDeployer: `0x${string}`;
  graduationHook: `0x${string}`;
  vaultImplementation: `0x${string}`;
  admin: `0x${string}`;
  treasury: `0x${string}`;
  operators: `0x${string}`[];
  startBlock: number;
  curve: { startMcapEth: number; gradMcapEth: number; raiseEth: number; virtualEth: string; virtualToken: string; curveSupply: string };
}

export const deployments = deploymentsData as unknown as Record<string, Deployment>;
export function deploymentFor(chainId: number): Deployment | null {
  return deployments[String(chainId)] ?? null;
}
