// A Market executes agent actions. Two implementations: SimMarket (in-memory replica of the contracts, for
// local demos and tests) and ChainMarket (operator key → AgentVault → AgentLaunchpad on Ethereum).
import type { AgentRec, CoinRec } from "./store.ts";

export interface LaunchParams {
  name: string;
  symbol: string;
  about: string;
  thesis: string;
  ethWei: bigint; // creator's first buy (creation fee is added by the market when there is one); 0 = sponsored
}

export interface Market {
  readonly mode: "sim" | "chain";
  readonly chainId: number;
  start(): Promise<void>;
  launch(a: AgentRec, p: LaunchParams): Promise<{ coin: CoinRec; tx: string; gasEth?: number }>;
  /** Current gas price (gwei) and the launchpad's coin creation fee (ETH): sponsored launches need both low. */
  gasGwei(): number;
  coinFeeEth(): number;
  buy(a: AgentRec, c: CoinRec, ethWei: bigint): Promise<{ tx: string; tokensWei: bigint }>;
  sell(a: AgentRec, c: CoinRec, tokensWei: bigint): Promise<{ tx: string; ethWei: bigint }>;
  claimFees(a: AgentRec): Promise<void>;
  refreshBalance(a: AgentRec): Promise<void>;
  quoteBuy(c: CoinRec, ethWei: bigint): bigint;
  quoteSell(c: CoinRec, tokensWei: bigint): bigint;
  contracts(): { factory: `0x${string}` | null; launchpad: `0x${string}` | null; identityRegistry: `0x${string}` | null };
  curve(): { startMcapEth: number; gradMcapEth: number; raiseEth: number };
}

export const FEE_BPS = 100n;
export const BPS = 10_000n;
export const POOL_FEE_BPS = 100n;
export const SUPPLY = 1_000_000_000n * 10n ** 18n;

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

/** Exact replica of AgentLaunchpad's curve math (bigint). */
export const curve = {
  buy(c: { virtualEth: string; virtualToken: string; curveSupply: string; ethReserve: string; tokensSold: string }, value: bigint) {
    const ve = BigInt(c.virtualEth);
    const vt = BigInt(c.virtualToken);
    const er = BigInt(c.ethReserve);
    const sold = BigInt(c.tokensSold);
    let fee = (value * FEE_BPS) / BPS;
    let net = value - fee;
    const k = ve * vt;
    const x = ve + er;
    const y = vt - sold;
    const remaining = BigInt(c.curveSupply) - sold;
    let out = y - ceilDiv(k, x + net);
    let refund = 0n;
    let last = false;
    if (out >= remaining) {
      last = true;
      out = remaining;
      net = ceilDiv(k, y - remaining) - x;
      fee = ceilDiv(net * FEE_BPS, BPS - FEE_BPS);
      if (net + fee > value) fee = value - net;
      refund = value - net - fee;
    }
    return { out, fee, net, refund, last };
  },
  sell(c: { virtualEth: string; virtualToken: string; ethReserve: string; tokensSold: string }, tokensIn: bigint) {
    const ve = BigInt(c.virtualEth);
    const vt = BigInt(c.virtualToken);
    const er = BigInt(c.ethReserve);
    const sold = BigInt(c.tokensSold);
    if (tokensIn > sold) tokensIn = sold;
    const k = ve * vt;
    let gross = ve + er - ceilDiv(k, vt - sold + tokensIn);
    if (gross > er) gross = er;
    const fee = (gross * FEE_BPS) / BPS;
    return { gross, fee, out: gross - fee, tokensIn };
  },
  /** ETH per whole token, as a float (display). */
  price(c: { virtualEth: string; virtualToken: string; ethReserve: string; tokensSold: string }) {
    return (Number(BigInt(c.virtualEth) + BigInt(c.ethReserve)) / Number(BigInt(c.virtualToken) - BigInt(c.tokensSold)));
  },
};

/** Constant-product approximation of a full-range v4 pool with a 1% fee (graduated coins). */
export const pool = {
  buy(c: { poolEth: string; poolTokens: string }, ethIn: bigint) {
    const E = BigInt(c.poolEth);
    const T = BigInt(c.poolTokens);
    const fee = (ethIn * POOL_FEE_BPS) / BPS;
    const inNet = ethIn - fee;
    const out = T - ceilDiv(E * T, E + inNet);
    return { out, fee, inNet };
  },
  sell(c: { poolEth: string; poolTokens: string }, tokensIn: bigint) {
    const E = BigInt(c.poolEth);
    const T = BigInt(c.poolTokens);
    const fee = (tokensIn * POOL_FEE_BPS) / BPS;
    const inNet = tokensIn - fee;
    const out = E - ceilDiv(E * T, T + inNet);
    return { out, fee, inNet };
  },
  price(c: { poolEth: string; poolTokens: string }) {
    return Number(BigInt(c.poolEth)) / Number(BigInt(c.poolTokens));
  },
};

/** Curve parameters from start/graduation market caps (ETH) — same formula as contracts/scripts/lib/core.mjs. */
export function curveParams(startMcapEth = 0.0707, gradMcapEth = 3.8) {
  const r = Math.sqrt(gradMcapEth / startMcapEth);
  const vt = (1e9 * r * r) / (r * r - 1);
  const ve = (startMcapEth * vt) / 1e9;
  const cs = vt * (1 - 1 / r);
  const tok = (n: number) => BigInt(Math.floor(n * 1e6)) * 10n ** 12n;
  return {
    virtualEth: BigInt(Math.round(ve * 1e9)) * 10n ** 9n,
    virtualToken: tok(vt),
    curveSupply: tok(cs),
    raiseEth: ve * (r - 1),
    startMcapEth,
    gradMcapEth,
  };
}
