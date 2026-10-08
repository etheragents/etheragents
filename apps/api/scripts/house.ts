// Create the house agents on-chain (same path as the website's Create flow): AgentFactory.createAgent with the
// persona hash, then POST the persona to the API.
//   RPC_URL=… CHAIN_ID=1 HOUSE_OWNER_KEY=0x… API_URL=https://api… HOUSE_AGENTS=6 HOUSE_DEPOSIT_ETH=0.05 \
//   node apps/api/scripts/house.ts
import { createPublicClient, createWalletClient, http, parseEther, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet, sepolia, hardhat } from "viem/chains";
import { agentFactoryAbi, deploymentFor, personaHash } from "@etheragents/shared";
import { HOUSE } from "../src/house.ts";
import { normKey } from "../src/config.ts";

const chainId = Number(process.env.CHAIN_ID || 31337);
const chain = ({ 1: mainnet, 11155111: sepolia, 31337: hardhat } as const)[chainId as 1] ?? hardhat;
const rpc = process.env.RPC_URL || "http://127.0.0.1:8545";
const api = (process.env.API_URL || "http://localhost:8787").replace(/\/$/, "");
const key = normKey(process.env.HOUSE_OWNER_KEY) as Hex;
if (!key) throw new Error("HOUSE_OWNER_KEY required");
const d = deploymentFor(chainId);
const factory = (process.env.FACTORY_ADDRESS || d?.factory) as Hex;
if (!factory) throw new Error("no factory for chain " + chainId);

const account = privateKeyToAccount(key);
const client = createPublicClient({ chain, transport: http(rpc) });
const wallet = createWalletClient({ chain, transport: http(rpc), account });
const count = Number(process.env.HOUSE_AGENTS || 6);
const deposit = parseEther(process.env.HOUSE_DEPOSIT_ETH || "0.05");
const maxTrade = parseEther(process.env.HOUSE_MAX_TRADE_ETH || "0.01");
const daily = parseEther(process.env.HOUSE_DAILY_ETH || "0.05");

const fee = (await client.readContract({ address: factory, abi: agentFactoryAbi, functionName: "creationFee" })) as bigint;
for (const h of HOUSE.slice(0, count)) {
  const next = (await client.readContract({ address: factory, abi: agentFactoryAbi, functionName: "agentCount" })) as bigint;
  const uri = `${api}/api/agents/${next + 1n}/registration.json`;
  const hash = await wallet.writeContract({
    address: factory,
    abi: agentFactoryAbi,
    functionName: "createAgent",
    args: [h.handle, personaHash({ handle: h.handle, name: h.name, persona: h.persona }), uri, maxTrade, daily],
    value: fee + deposit,
  });
  await client.waitForTransactionReceipt({ hash });
  const res = await fetch(`${api}/api/agents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ txHash: hash, handle: h.handle, name: h.name, persona: h.persona, avatar: h.avatar }),
  });
  const j = (await res.json()) as any;
  if (!res.ok) throw new Error(`${h.handle}: ${j.error}`);
  console.log(`created @${j.agent.handle} #${j.agent.id} vault ${j.agent.vault}`);
}
