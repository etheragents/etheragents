// Keeper (chain mode, operator key): routes fees and drops $EA rewards to holders' agents.
//  - every ~10 min: launchpad.claimProtocolFees() when the brain/burn/treasury shares are worth the gas
//  - every ~10 min: TokenRewards.split() when new $EA rewards arrived
//  - every ~10 min: drop a small slice of the drop pool into a few random agents whose owners hold enough
//    $EA (AgentFactory.holdOk), so rewards spread wide in small cuts
// Buybacks (BuybackBurn.buyAndBurn) need router calldata for wherever $EA trades; run
// contracts/scripts/buyback.mjs for those.
import { agentFactoryAbi, agentLaunchpadAbi, tokenRewardsAbi } from "@etheragents/shared";
import type { Hex } from "viem";
import type { ChainMarket } from "./chain.ts";
import type { Ledger } from "./ledger.ts";
import { config } from "./config.ts";
import { fmtEth, sleep, toEth } from "./util.ts";

export function startKeeper(market: ChainMarket, ledger: Ledger) {
  const k = config.keeper;
  if (!k.enabled || !market.wallet) return;
  const tr = market.d.tokenRewards as Hex | undefined;
  console.log(`[keeper] on: fee routing every ${k.everySeconds}s${tr ? `, $EA drops from ${tr}` : ""}`);
  const send = async (address: Hex, abi: any, functionName: string, args: unknown[] = []) => {
    const hash = await market.wallet!.writeContract({ address, abi, functionName, args, chain: market.client.chain, account: market.wallet!.account! });
    const r = await market.client.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`${functionName} reverted`);
    return hash;
  };
  const read = (address: Hex, abi: any, functionName: string, args: unknown[] = []) => market.client.readContract({ address, abi, functionName, args }) as Promise<any>;

  const round = async () => {
    // 1) protocol fees → treasury / brain fund / buyback
    const lp = market.d.launchpad as Hex;
    const owed = ((await read(lp, agentLaunchpadAbi, "protocolEthOwed")) as bigint) + ((await read(lp, agentLaunchpadAbi, "brainEthOwed")) as bigint) + ((await read(lp, agentLaunchpadAbi, "burnEthOwed")) as bigint);
    if (toEth(owed) >= k.minRouteEth) {
      await send(lp, agentLaunchpadAbi, "claimProtocolFees");
      console.log(`[keeper] routed ${fmtEth(toEth(owed))} ETH of protocol fees`);
    }
    if (!tr) return;
    // 2) split new $EA rewards 60/10/20/10
    const unsplit = (await read(tr, tokenRewardsAbi, "unsplit")) as bigint;
    if (toEth(unsplit) >= k.minRouteEth) {
      await send(tr, tokenRewardsAbi, "split");
      console.log(`[keeper] split ${fmtEth(toEth(unsplit))} ETH of $EA rewards`);
    }
    // 3) drops: a slice of the pool, in small random cuts, to agents whose owners hold
    const pool = (await read(tr, tokenRewardsAbi, "dropPool")) as bigint;
    if (toEth(pool) < k.minDropEth * 2) return;
    const agents = ledger.store.agents.values().filter((a) => !a.house && a.vault && /^0x[0-9a-fA-F]{40}$/.test(a.vault));
    const holders: typeof agents = [];
    for (const a of agents.sort(() => Math.random() - 0.5).slice(0, 60)) {
      const ok = (await read(market.d.factory as Hex, agentFactoryAbi, "holdOk", [a.owner]).catch(() => false)) as boolean;
      if (ok) holders.push(a);
      if (holders.length >= k.dropsPerRound) break;
    }
    if (!holders.length) return;
    const slice = (pool * BigInt(Math.round(k.dropSlice * 10_000))) / 10_000n;
    const weights = holders.map(() => 0.5 + Math.random());
    const total = weights.reduce((s, w) => s + w, 0);
    const amounts = weights.map((w) => (slice * BigInt(Math.round((w / total) * 1e6))) / 1_000_000n);
    const vaults = holders.map((a) => a.vault as Hex);
    await send(tr, tokenRewardsAbi, "drop", [vaults, amounts]);
    holders.forEach((a, i) => {
      const eth = toEth(amounts[i]);
      ledger.activity("drop", `@${a.handle} got a ${fmtEth(eth)} ETH drop from $EA rewards`, { agent: a, eth });
    });
    console.log(`[keeper] dropped ${fmtEth(toEth(slice))} ETH to ${holders.length} agents`);
  };

  (async () => {
    await sleep(15_000);
    for (;;) {
      try {
        await round();
      } catch (e) {
        console.error("[keeper]", (e as Error).message?.slice(0, 200));
      }
      await sleep(k.everySeconds * 1000);
    }
  })();
}
