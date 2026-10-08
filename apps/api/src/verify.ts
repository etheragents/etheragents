// Etherscan verification (chain mode): every agent coin gets its source published on Etherscan by itself.
// Every AgentCoin has the same code; only the constructor arguments (name, symbol) differ, so one trimmed
// standard-JSON input (data/agentcoin-input.json, compiles to the exact deployed bytecode) covers all of them.
// Runs every minute: coins already verified are skipped, new ones are submitted, pending ones are checked.
// Needs ETHERSCAN_API_KEY; without it this does nothing.
import fs from "node:fs";
import { encodeAbiParameters, parseAbi, type Hex } from "viem";
import type { ChainMarket } from "./chain.ts";
import type { Ledger } from "./ledger.ts";
import { sleep } from "./util.ts";

const COMPILER = "v0.8.26+commit.8a97fa7a";
const SUPPLY = 1_000_000_000n * 10n ** 18n;
const erc = parseAbi(["function name() view returns (string)", "function symbol() view returns (string)"]);

export function startVerifier(market: ChainMarket, ledger: Ledger) {
  const key = process.env.ETHERSCAN_API_KEY?.trim();
  if (!key || process.env.VERIFY_COINS === "0") return;
  const input = fs.readFileSync(new URL("./data/agentcoin-input.json", import.meta.url), "utf8");
  const API = `https://api.etherscan.io/v2/api?chainid=${market.chainId}`;
  const launchpad = market.d.launchpad as Hex;
  const done = new Set<string>();
  const pending = new Map<string, string>(); // coin → Etherscan guid
  const tries = new Map<string, number>();

  const get = async (params: Record<string, string>) => {
    const q = new URLSearchParams({ apikey: key, ...params });
    return (await (await fetch(`${API}&${q}`, { signal: AbortSignal.timeout(20_000) })).json()) as { status: string; result: any };
  };

  const step = async (coin: string) => {
    const guid = pending.get(coin);
    if (guid) {
      const r = await get({ module: "contract", action: "checkverifystatus", guid });
      const msg = String(r.result);
      if (/pass|already verified/i.test(msg)) {
        done.add(coin);
        pending.delete(coin);
        console.log(`[verify] ${coin} verified on Etherscan`);
      } else if (!/pending|queue/i.test(msg)) {
        pending.delete(coin);
        console.error(`[verify] ${coin} failed: ${msg.slice(0, 160)}`);
      }
      return;
    }
    const src = await get({ module: "contract", action: "getsourcecode", address: coin });
    if (src.status === "1" && src.result?.[0]?.SourceCode) {
      done.add(coin);
      return;
    }
    const n = (tries.get(coin) ?? 0) + 1;
    tries.set(coin, n);
    if (n > 8) return; // give up quietly after 8 submissions (resets on restart)
    const [name, symbol] = await Promise.all([
      market.client.readContract({ address: coin as Hex, abi: erc, functionName: "name" }),
      market.client.readContract({ address: coin as Hex, abi: erc, functionName: "symbol" }),
    ]);
    const args = encodeAbiParameters(
      [{ type: "string" }, { type: "string" }, { type: "uint256" }, { type: "address" }],
      [name, symbol, SUPPLY, launchpad],
    ).slice(2);
    const body = new URLSearchParams({
      apikey: key,
      module: "contract",
      action: "verifysourcecode",
      contractaddress: coin,
      sourceCode: input,
      codeformat: "solidity-standard-json-input",
      contractname: "src/AgentCoin.sol:AgentCoin",
      compilerversion: COMPILER,
      constructorArguements: args,
    });
    const r = (await (await fetch(API, { method: "POST", body, signal: AbortSignal.timeout(30_000) })).json()) as { status: string; result: string };
    if (r.status === "1") pending.set(coin, r.result);
    else if (/already verified/i.test(r.result)) done.add(coin);
    else console.error(`[verify] ${coin} not submitted yet: ${String(r.result).slice(0, 160)}`); // e.g. Etherscan hasn't indexed a brand-new coin
  };

  console.log("[verify] coins are verified on Etherscan automatically");
  (async () => {
    await sleep(20_000);
    for (;;) {
      const coins = ledger.store.coins.values().map((c) => c.address.toLowerCase()).filter((c) => !done.has(c));
      for (const c of coins) {
        try {
          await step(c);
        } catch (e) {
          console.error("[verify]", c, (e as Error).message?.slice(0, 160));
        }
        await sleep(1_200); // stay well under Etherscan's rate limit
      }
      await sleep(60_000);
    }
  })();
}
