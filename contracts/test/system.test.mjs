import { test, before } from "node:test";
import assert from "node:assert/strict";
import { parseEther, formatEther, keccak256, toHex, zeroAddress } from "viem";
import { setup, client, abi, tx, events, reverts, snapshot, revert, warp } from "./helpers.mjs";
import { curveParams, SUPPLY } from "../scripts/lib/core.mjs";

let ctx;
let agentVault; // created in the "create agent" test
const E = (n) => parseEther(String(n));

before(async () => {
  ctx = await setup();
});

const lp = () => ({ address: ctx.d.launchpad, abi: abi("AgentLaunchpad") });
const fac = () => ({ address: ctx.d.factory, abi: abi("AgentFactory") });
const vault = (a = agentVault) => ({ address: a, abi: abi("AgentVault") });
const coinC = (a) => ({ address: a, abi: abi("AgentCoin") });
const read = (c, functionName, args = []) => client.readContract({ ...c, functionName, args });
const balance = (address) => client.getBalance({ address });

async function createAgent(owner, deposit = E(1), maxTrade = E(0.05), daily = E(0.5)) {
  const r = await tx(
    owner.writeContract({
      ...fac(),
      functionName: "createAgent",
      args: ["trader" + Math.floor(Math.random() * 1e6), keccak256(toHex("persona")), "https://example/agents/1.json", maxTrade, daily],
      value: deposit + E(0.002),
    }),
  );
  const [ev] = events(r, "AgentFactory").filter((e) => e.eventName === "AgentCreated");
  return ev.args.vault;
}

// Every agent launches exactly one coin, so a test that needs a new coin gets a new agent (owned by alice) and
// makes it the current `agentVault`.
async function launch(op, v, ethAmount = E(0.01)) {
  if ((await read(vault(v), "launchedCoin")) !== zeroAddress) {
    agentVault = await createAgent(ctx.alice);
    v = agentVault;
  }
  const r = await tx(op.writeContract({ ...vault(v), functionName: "launch", args: ["Test Cat", "TCAT", "ipfs://x", ethAmount, 0n] }));
  const [ev] = events(r, "AgentLaunchpad").filter((e) => e.eventName === "CoinCreated");
  return ev.args.coin;
}

test("curve params: ~0.456 ETH raised, ~88% of supply on the curve", () => {
  const c = curveParams();
  assert.ok(Math.abs(c.raiseEth - 0.456) < 0.01, "raise ≈ 0.456 ETH, got " + c.raiseEth);
  const soldPct = Number((c.curveSupply * 10000n) / SUPPLY) / 100;
  assert.ok(soldPct > 87 && soldPct < 89, "~88% sold on curve, got " + soldPct);
});

test("anyone creates an agent: vault owned by creator, fee to treasury, ERC-8004 identity", async () => {
  const tBefore = await balance(ctx.treasury.account.address);
  agentVault = await createAgent(ctx.alice);
  assert.equal((await read(vault(), "owner")).toLowerCase(), ctx.alice.account.address.toLowerCase());
  assert.equal(await balance(agentVault), E(1));
  assert.equal((await balance(ctx.treasury.account.address)) - tBefore, E(0.002));
  assert.equal(await read(vault(), "hasIdentity"), true);
  const reg = { address: ctx.d.identityRegistry, abi: abi("MockIdentityRegistry") };
  const id = await read(vault(), "identityId");
  assert.equal((await read(reg, "ownerOf", [id])).toLowerCase(), agentVault.toLowerCase());
  assert.equal(await read(fac(), "agentCount"), 1n);
});

test("operator launches a coin from the vault; tokens stay in the vault", async () => {
  const coin = await launch(ctx.operator, agentVault, E(0.0005));
  const bal = await read(coinC(coin), "balanceOf", [agentVault]);
  assert.ok(bal > 0n);
  const c = await read(lp(), "coins", [coin]);
  assert.equal(c[0].toLowerCase(), agentVault.toLowerCase()); // creator = vault
  const mcap = await read(lp(), "marketCap", [coin]);
  assert.ok(Number(formatEther(mcap)) > 0.0707 && Number(formatEther(mcap)) < 0.073, "start mcap ~0.071, got " + formatEther(mcap));
});

test("each agent launches exactly one coin, whoever asks", async () => {
  const first = await read(vault(), "launchedCoin");
  assert.notEqual(first, zeroAddress);
  await reverts(ctx.operator.writeContract({ ...vault(), functionName: "launch", args: ["Two", "TWO", "ipfs://y", E(0.001), 0n] }), "operator second launch");
  await reverts(ctx.alice.writeContract({ ...vault(), functionName: "launch", args: ["Two", "TWO", "ipfs://y", E(0.001), 0n] }), "owner second launch");
  assert.equal(await read(vault(), "launchedCoin"), first);
});

test("strangers cannot drive a vault; limits bind the operator, not the owner", async () => {
  const coin = await launch(ctx.operator, agentVault);
  await reverts(ctx.eve.writeContract({ ...vault(), functionName: "buy", args: [coin, E(0.01), 0n] }), "stranger");
  await reverts(ctx.operator.writeContract({ ...vault(), functionName: "buy", args: [coin, E(0.06), 0n] }), "over trade limit");
  // owner is unlimited
  await tx(ctx.alice.writeContract({ ...vault(), functionName: "buy", args: [coin, E(0.06), 0n] }));
  // daily limit: 0.5 ETH, already spent 0.02 via two launches
  const id = await snapshot();
  for (let i = 0; i < 9; i++) await tx(ctx.operator.writeContract({ ...vault(), functionName: "buy", args: [coin, E(0.05), 0n] }));
  await reverts(ctx.operator.writeContract({ ...vault(), functionName: "buy", args: [coin, E(0.05), 0n] }), "daily");
  await warp(86_401);
  await tx(ctx.operator.writeContract({ ...vault(), functionName: "buy", args: [coin, E(0.05), 0n] }));
  await revert(id);
});

test("operator gas is reimbursed by the vault, capped", async () => {
  const coin = await launch(ctx.operator, agentVault, E(0.001));
  const opBefore = await balance(ctx.operator.account.address);
  const r = await tx(ctx.operator.writeContract({ ...vault(), functionName: "buy", args: [coin, E(0.001), 0n] }));
  const refunds = events(r, "AgentVault").filter((e) => e.eventName === "GasRefunded");
  assert.equal(refunds.length, 1);
  const gasPaid = r.gasUsed * r.effectiveGasPrice;
  const net = (await balance(ctx.operator.account.address)) - opBefore; // refund − gas paid
  assert.ok(refunds[0].args.amount <= E(0.005));
  assert.ok(net > -gasPaid / 5n, "operator recovers most of its gas: paid " + gasPaid + ", net " + net);
});

test("pause: owner pauses agent, operator blocked; factory pause blocks everyone's brain", async () => {
  const coin = await launch(ctx.operator, agentVault);
  await tx(ctx.alice.writeContract({ ...vault(), functionName: "setPaused", args: [true] }));
  await reverts(ctx.operator.writeContract({ ...vault(), functionName: "buy", args: [coin, E(0.01), 0n] }));
  await tx(ctx.alice.writeContract({ ...vault(), functionName: "setPaused", args: [false] }));
  await tx(ctx.deployer.writeContract({ ...fac(), functionName: "pause" }));
  await reverts(ctx.operator.writeContract({ ...vault(), functionName: "buy", args: [coin, E(0.01), 0n] }));
  await tx(ctx.deployer.writeContract({ ...fac(), functionName: "unpause" }));
});

test("buy → sell round trip costs ~2% in fees; creator fees accrue and are claimable", async () => {
  const coin = await launch(ctx.operator, agentVault, E(0.001));
  const v2 = await createAgent(ctx.bob);
  const before = await balance(v2);
  await tx(ctx.operator.writeContract({ ...vault(v2), functionName: "buy", args: [coin, E(0.04), 0n] }));
  const toks = await read(coinC(coin), "balanceOf", [v2]);
  const quote = await read(lp(), "quoteSell", [coin, toks]);
  await tx(ctx.operator.writeContract({ ...vault(v2), functionName: "sell", args: [coin, toks, (quote * 99n) / 100n] }));
  const lost = Number(formatEther(before - (await balance(v2))));
  assert.ok(lost > 0.0007 && lost < 0.0012, "~2% of 0.04 + gas refunds, got " + lost);
  const owed = await read(lp(), "creatorEthOwed", [agentVault]);
  assert.ok(owed > 0n);
  const vb = await balance(agentVault);
  const rc = await tx(ctx.operator.writeContract({ ...vault(), functionName: "claimFees" }));
  const refund = events(rc, "AgentVault").find((e) => e.eventName === "GasRefunded").args.amount;
  assert.equal((await balance(agentVault)) - vb, owed - refund);
});

test("graduation: last buy refunds the excess, opens a v4 pool at the curve price, burns nothing material", async () => {
  const coin = await launch(ctx.operator, agentVault, E(0.001));
  const curveBefore = await read(lp(), "price", [coin]);
  // a human whale buys through the launchpad directly
  const r = await tx(ctx.bob.writeContract({ ...lp(), functionName: "buy", args: [coin, 0n, ctx.bob.account.address], value: E(1) }));
  const grads = events(r, "AgentLaunchpad").filter((e) => e.eventName === "Graduated");
  assert.equal(grads.length, 1);
  const g = grads[0].args;
  const raise = Number(formatEther(g.ethLiquidity));
  assert.ok(raise > 0.44 && raise < 0.47, "pool ETH ≈ 0.456, got " + raise);
  assert.ok(g.burned * 1000n < SUPPLY, "burned < 0.1% of supply: " + g.burned);
  const coinState = await read(lp(), "coins", [coin]);
  assert.equal(coinState[2], true);
  assert.equal(await read(lp(), "progressBps", [coin]), 10000n);
  const mcap = Number(formatEther(await read(lp(), "marketCap", [coin])));
  assert.ok(mcap > 3.6 && mcap < 4.0, "graduation mcap ≈ 3.8 ETH, got " + mcap);
  assert.ok((await read(lp(), "price", [coin])) > curveBefore);
  // refund: bob spent only ~raise + 1% fee
  const trades = events(r, "AgentLaunchpad").filter((e) => e.eventName === "Trade");
  assert.ok(Number(formatEther(trades[0].args.ethAmount)) < 0.47);

  // after graduation the same buy/sell route through Uniswap v4
  await tx(ctx.operator.writeContract({ ...vault(), functionName: "buy", args: [coin, E(0.02), 0n] }));
  const t = await read(coinC(coin), "balanceOf", [agentVault]);
  const vb = await balance(agentVault);
  const r2 = await tx(ctx.operator.writeContract({ ...vault(), functionName: "sell", args: [coin, t / 2n, 0n] }));
  assert.ok((await balance(agentVault)) > vb);
  assert.equal(events(r2, "AgentLaunchpad").find((e) => e.eventName === "Trade").args.viaPool, true);

  // pool fees → creator + protocol
  const owedBefore = await read(lp(), "creatorEthOwed", [agentVault]);
  await tx(ctx.eve.writeContract({ ...lp(), functionName: "collectFees", args: [coin] }));
  assert.ok((await read(lp(), "creatorEthOwed", [agentVault])) > owedBefore);

  // curve accounting stays solvent
  const owed = (await read(lp(), "totalCurveEth")) + (await read(lp(), "totalCreatorOwed")) + (await read(lp(), "protocolEthOwed"));
  assert.ok((await balance(ctx.d.launchpad)) >= owed);
});

test("the hook stops anyone else from initializing the graduation pool", async () => {
  const coin = await launch(ctx.operator, agentVault, E(0.001));
  const pm = { address: ctx.d.poolManager, abi: abi("PoolManager") };
  const key = { currency0: zeroAddress, currency1: coin, fee: 10000, tickSpacing: 200, hooks: ctx.d.graduationHook };
  await reverts(ctx.eve.writeContract({ ...pm, functionName: "initialize", args: [key, 79228162514264337593543950336n] }), "hook");
});

test("owner withdraws everything; rescue cannot touch reserves", async () => {
  const bal = await balance(agentVault);
  await tx(ctx.alice.writeContract({ ...vault(), functionName: "withdrawETH", args: [ctx.alice.account.address, bal] }));
  assert.equal(await balance(agentVault), 0n);
  await reverts(ctx.eve.writeContract({ ...vault(), functionName: "withdrawETH", args: [ctx.eve.account.address, 0n] }));
  const lpBal = await balance(ctx.d.launchpad);
  await reverts(ctx.deployer.writeContract({ ...lp(), functionName: "rescueETH", args: [ctx.deployer.account.address, lpBal] }), "rescue reserves");
});

test("protocol fees go to the treasury", async () => {
  const owed = await read(lp(), "protocolEthOwed");
  const b = await balance(ctx.treasury.account.address);
  await tx(ctx.eve.writeContract({ ...lp(), functionName: "claimProtocolFees" }));
  assert.equal((await balance(ctx.treasury.account.address)) - b, owed);
});
