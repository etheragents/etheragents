#!/usr/bin/env node
// Verifies the deployed contracts on Etherscan (API v2, one key for every chain).
//   ETHERSCAN_API_KEY=… CHAIN_ID=1 node scripts/verify.mjs
// Uses out/standard-input.json from `npm run build` — build from the same commit you deployed.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodeAbiParameters } from "viem";
import { artifact } from "./lib/core.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chainId = Number(process.env.CHAIN_ID || 1);
const key = process.env.ETHERSCAN_API_KEY;
if (!key) throw new Error("ETHERSCAN_API_KEY required");
const d = JSON.parse(fs.readFileSync(path.join(root, "deployments", `${chainId}.json`), "utf8"));
const input = fs.readFileSync(path.join(root, "out", "standard-input.json"), "utf8");
const API = `https://api.etherscan.io/v2/api?chainid=${chainId}`;
const COMPILER = "v0.8.26+commit.8a97fa7a";

const ctorArgs = (name, args) => {
  const ctor = artifact(name).abi.find((x) => x.type === "constructor");
  return ctor ? encodeAbiParameters(ctor.inputs, args).slice(2) : "";
};

const c = d.curve;
// COIN=0x… verifies one agent coin (needs RPC_URL to read its name and symbol). Every agent coin has the same
// bytecode, so after one is verified Etherscan shows the source, with the Etheragents links, on all of them.
if (process.env.COIN) {
  const { createPublicClient, http } = await import("viem");
  const client = createPublicClient({ transport: http(process.env.RPC_URL) });
  const erc = artifact("AgentCoin").abi;
  const coin = process.env.COIN.trim();
  const [name, symbol] = await Promise.all([client.readContract({ address: coin, abi: erc, functionName: "name" }), client.readContract({ address: coin, abi: erc, functionName: "symbol" })]);
  globalThis.__coinJob = ["AgentCoin", coin, [name, symbol, 1_000_000_000n * 10n ** 18n, d.launchpad]];
}
const jobs = globalThis.__coinJob ? [globalThis.__coinJob] : [
  ["Create2Deployer", d.create2Deployer, []],
  ["AgentLaunchpad", d.launchpad, [d.deployer ?? d.admin, d.poolManager, d.treasury, BigInt(c.virtualEth), BigInt(c.virtualToken), BigInt(c.curveSupply)]],
  ["CoinDeployer", d.coinDeployer, [d.launchpad]],
  ["GraduationGuardHook", d.graduationHook, [d.poolManager, d.launchpad]],
  ["AgentFactory", d.factory, [d.deployer ?? d.admin, d.launchpad, d.identityRegistry, d.treasury, BigInt(d.agentFee ?? 0)]],
  ["AgentVault", d.vaultImplementation, [d.factory]],
  ...(d.buyback ? [["BuybackBurn", d.buyback, [d.deployer ?? d.admin]]] : []),
  ...(d.tokenRewards ? [["TokenRewards", d.tokenRewards, [d.deployer ?? d.admin, d.factory, d.buyback, d.brainFund ?? d.treasury, d.team ?? d.treasury]]] : []),
];

for (const [name, address, args] of jobs) {
  const a = artifact(name);
  const body = new URLSearchParams({
    apikey: key,
    module: "contract",
    action: "verifysourcecode",
    contractaddress: address,
    sourceCode: input,
    codeformat: "solidity-standard-json-input",
    contractname: `${a.sourceName}:${name}`,
    compilerversion: COMPILER,
    constructorArguements: ctorArgs(name, args),
  });
  const res = await (await fetch(API, { method: "POST", body })).json();
  console.log(`${name.padEnd(20)} ${address} → ${res.status === "1" ? "submitted " + res.result : res.result}`);
  await new Promise((r) => setTimeout(r, 1500));
}
console.log("\nCheck progress on Etherscan in a minute (contracts tab of each address).");
