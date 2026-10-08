#!/usr/bin/env node
// Run once $EA is live. Switches on the 100,000-per-agent hold and points buyback-and-burn at the token.
//   NETWORK=mainnet RPC_URL=… ADMIN_PRIVATE_KEY=0x… ETHERAGENTS_TOKEN=0x… node scripts/token-live.mjs
// Optional: HOLD_PER_AGENT (default 100000), ROUTER (default: Uniswap V2 Router02 on mainnet).
// The admin key must own the AgentFactory and BuybackBurn (accept ownership first).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, parseUnits, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet, sepolia, hardhat } from "viem/chains";
import { artifact } from "./lib/core.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NETWORK = process.env.NETWORK || "local";
const chain = { local: hardhat, sepolia, mainnet }[NETWORK];
const rpc = process.env.RPC_URL || (NETWORK === "local" ? "http://127.0.0.1:8545" : null);
const normKey = (k) => { if (!k) return k; const s = String(k).trim().replace(/^["']|["']$/g, "").replace(/\s+/g, ""); const h = s.startsWith("0x") ? s : "0x" + s; if (!/^0x[0-9a-fA-F]{64}$/.test(h)) throw new Error("private key must be 64 hex characters (0x optional); check the secret has no spaces or quotes"); return h; };
const pk = normKey(process.env.ADMIN_PRIVATE_KEY) || (NETWORK === "local" ? "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" : null);
const token = process.env.ETHERAGENTS_TOKEN;
if (!chain || !rpc || !pk) throw new Error("set NETWORK, RPC_URL and ADMIN_PRIVATE_KEY");
if (!isAddress(token || "")) throw new Error("set ETHERAGENTS_TOKEN to the $EA token address");
const ROUTER = process.env.ROUTER || (NETWORK === "mainnet" ? "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D" : null);

const client = createPublicClient({ chain, transport: http(rpc) });
const wallet = createWalletClient({ chain, transport: http(rpc), account: privateKeyToAccount(pk) });
const d = JSON.parse(fs.readFileSync(path.join(root, "deployments", `${chain.id}.json`), "utf8"));
const send = async (address, name, functionName, args) => {
  const hash = await wallet.writeContract({ address, abi: artifact(name).abi, functionName, args });
  const r = await client.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${name}.${functionName} reverted`);
  console.log(`  ✓ ${name}.${functionName}  ${hash}`);
};

const decimals = await client.readContract({ address: token, abi: [{ type: "function", name: "decimals", inputs: [], outputs: [{ type: "uint8" }], stateMutability: "view" }], functionName: "decimals" });
const per = parseUnits(process.env.HOLD_PER_AGENT || "100000", decimals);
console.log(`$EA ${token} (${decimals} decimals) on ${NETWORK}`);
await send(d.factory, "AgentFactory", "setHold", [token, per]);
if (d.buyback) {
  const current = await client.readContract({ address: d.buyback, abi: artifact("BuybackBurn").abi, functionName: "token" });
  if (/^0x0+$/.test(current)) await send(d.buyback, "BuybackBurn", "setToken", [token]);
  if (ROUTER) await send(d.buyback, "BuybackBurn", "setRouter", [ROUTER, true]);
}
d.holdToken = token;
fs.writeFileSync(path.join(root, "deployments", `${chain.id}.json`), JSON.stringify(d, null, 2));
console.log(`\nDone. Every agent now needs ${process.env.HOLD_PER_AGENT || "100000"} $EA in its owner's wallet.`);
console.log(`Next: send $EA's creator rewards to TokenRewards ${d.tokenRewards} (the API keeper splits and drops them).`);
