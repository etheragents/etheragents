#!/usr/bin/env node
// Buy back and burn $EA with the ETH waiting in BuybackBurn, through a Uniswap V2-style router
// (swapExactETHForTokensSupportingFeeOnTransferTokens). Run by a keeper (an operator key) or the admin.
//   NETWORK=mainnet RPC_URL=… KEEPER_PRIVATE_KEY=0x… node scripts/buyback.mjs [ethAmount]
// Optional: ROUTER (default Uniswap V2 Router02 on mainnet), WETH, SLIPPAGE_BPS (default 300).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, encodeFunctionData, formatEther, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet, sepolia, hardhat } from "viem/chains";
import { artifact } from "./lib/core.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NETWORK = process.env.NETWORK || "local";
const chain = { local: hardhat, sepolia, mainnet }[NETWORK];
const rpc = process.env.RPC_URL;
const normKey = (k) => { if (!k) return k; const s = String(k).trim().replace(/^["']|["']$/g, "").replace(/\s+/g, ""); const h = s.startsWith("0x") ? s : "0x" + s; if (!/^0x[0-9a-fA-F]{64}$/.test(h)) throw new Error("private key must be 64 hex characters (0x optional); check the secret has no spaces or quotes"); return h; };
const pk = normKey(process.env.KEEPER_PRIVATE_KEY);
if (!chain || !rpc || !pk) throw new Error("set NETWORK, RPC_URL and KEEPER_PRIVATE_KEY");
const ROUTER = process.env.ROUTER || "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
const WETH = process.env.WETH || "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const slip = BigInt(process.env.SLIPPAGE_BPS || 300);

const client = createPublicClient({ chain, transport: http(rpc) });
const wallet = createWalletClient({ chain, transport: http(rpc), account: privateKeyToAccount(pk) });
const d = JSON.parse(fs.readFileSync(path.join(root, "deployments", `${chain.id}.json`), "utf8"));
const bb = { address: d.buyback, abi: artifact("BuybackBurn").abi };
const token = await client.readContract({ ...bb, functionName: "token" });
if (/^0x0+$/.test(token)) throw new Error("BuybackBurn has no token yet — run scripts/token-live.mjs first");
const bal = await client.getBalance({ address: d.buyback });
const eth = process.argv[2] ? parseEther(process.argv[2]) : bal;
if (eth === 0n || eth > bal) throw new Error(`BuybackBurn holds ${formatEther(bal)} ETH`);

const routerAbi = [
  { type: "function", name: "getAmountsOut", stateMutability: "view", inputs: [{ type: "uint256" }, { type: "address[]" }], outputs: [{ type: "uint256[]" }] },
  { type: "function", name: "swapExactETHForTokensSupportingFeeOnTransferTokens", stateMutability: "payable", inputs: [{ type: "uint256" }, { type: "address[]" }, { type: "address" }, { type: "uint256" }], outputs: [] },
];
const quote = (await client.readContract({ address: ROUTER, abi: routerAbi, functionName: "getAmountsOut", args: [eth, [WETH, token]] }))[1];
const minOut = (quote * (10000n - slip)) / 10000n;
const data = encodeFunctionData({ abi: routerAbi, functionName: "swapExactETHForTokensSupportingFeeOnTransferTokens", args: [minOut, [WETH, token], d.buyback, BigInt(Math.floor(Date.now() / 1000) + 600)] });
const hash = await wallet.writeContract({ ...bb, functionName: "buyAndBurn", args: [ROUTER, data, eth, minOut] });
const r = await client.waitForTransactionReceipt({ hash });
console.log(r.status === "success" ? `bought and burned ~${quote} $EA wei with ${formatEther(eth)} ETH: ${hash}` : "reverted");
