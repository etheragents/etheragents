import { createRequire } from "node:module";
import { createPublicClient, createWalletClient, custom, parseEther, decodeEventLog } from "viem";
import { hardhat } from "viem/chains";
import { artifact, deployAll, curveParams } from "../scripts/lib/core.mjs";

const require = createRequire(import.meta.url);
process.chdir(new URL("..", import.meta.url).pathname);
const hre = require("hardhat");

export const provider = hre.network.provider;
export const transport = custom({ request: ({ method, params }) => provider.request({ method, params }) });
export const client = createPublicClient({ chain: hardhat, transport });

export async function accounts() {
  const addrs = await provider.request({ method: "eth_accounts" });
  return addrs.map((a) => createWalletClient({ chain: hardhat, transport, account: a }));
}

export const abi = (n) => artifact(n).abi;

export async function setup() {
  const [deployer, operator, alice, bob, treasury, eve] = await accounts();
  const d = await deployAll({
    wallet: deployer,
    client,
    admin: deployer.account.address,
    treasury: treasury.account.address,
    operators: [operator.account.address],
    agentFee: parseEther("0.002"),
    curve: curveParams(),
  });
  return { d, deployer, operator, alice, bob, treasury, eve };
}

export async function tx(p) {
  const hash = await p;
  const r = await client.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error("reverted");
  return r;
}

export function events(receipt, name) {
  const out = [];
  for (const l of receipt.logs) {
    try {
      const e = decodeEventLog({ abi: abi(name), data: l.data, topics: l.topics });
      out.push({ ...e, address: l.address });
    } catch {}
  }
  return out;
}

/// Expect a promise to revert (simulation or receipt).
export async function reverts(p, msg = "") {
  try {
    const hash = await p;
    const r = await client.waitForTransactionReceipt({ hash });
    if (r.status === "success") throw new Error("expected revert " + msg);
  } catch (e) {
    if (String(e.message).startsWith("expected revert")) throw e;
    return String(e.shortMessage || e.message);
  }
}

export async function snapshot() {
  return provider.request({ method: "evm_snapshot", params: [] });
}
export async function revert(id) {
  return provider.request({ method: "evm_revert", params: [id] });
}
export async function warp(seconds) {
  await provider.request({ method: "evm_increaseTime", params: [seconds] });
  await provider.request({ method: "evm_mine", params: [] });
}
