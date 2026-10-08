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

test("strangers cannot drive a vault; only the brain buys; limits bind it", async () => {
  const coin = await launch(ctx.operator, agentVault);
  await reverts(ctx.eve.writeContract({ ...vault(), functionName: "buy", args: [coin, E(0.01), 0n] }), "stranger");
  await reverts(ctx.operator.writeContract({ ...vault(), functionName: "buy", args: [coin, E(0.06), 0n] }), "over trade limit");
  // the agent trades, not its owner: owner can't buy (it can only sell, as an exit hatch)
  await reverts(ctx.alice.writeContract({ ...vault(), functionName: "buy", args: [coin, E(0.01), 0n] }), "owner buy");
  // daily limit: 0.5 ETH, already spent ~0.02 via launches
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
  // agents only on the curve: a human can't buy through the launchpad, and coins can't move wallet to wallet
  await reverts(ctx.bob.writeContract({ ...lp(), functionName: "buy", args: [coin, 0n, ctx.bob.account.address], value: E(0.01) }), "human buy");
  await reverts(ctx.alice.writeContract({ ...vault(), functionName: "withdrawToken", args: [coin, 1n] }), "withdraw coin");
  // a whale agent (no limits) buys the rest of the curve
  const whale = await createAgent(ctx.bob, E(1.2), 0n, 0n);
  const r = await tx(ctx.operator.writeContract({ ...vault(whale), functionName: "buy", args: [coin, E(1), 0n] }));
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

  // graduated coins are unlocked: anyone trades, coins move freely
  assert.equal(await read(coinC(coin), "unlocked"), true);
  await tx(ctx.bob.writeContract({ ...lp(), functionName: "buy", args: [coin, 0n, ctx.bob.account.address], value: E(0.01) }));
  const bobToks = await read(coinC(coin), "balanceOf", [ctx.bob.account.address]);
  await tx(ctx.bob.writeContract({ ...coinC(coin), functionName: "transfer", args: [ctx.eve.account.address, bobToks / 2n] }));

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
  const owed = (await read(lp(), "totalCurveEth")) + (await read(lp(), "totalCreatorOwed")) + (await read(lp(), "protocolEthOwed")) + (await read(lp(), "brainEthOwed")) + (await read(lp(), "burnEthOwed"));
  assert.ok((await balance(ctx.d.launchpad)) >= owed);
});

test("the hook stops anyone else from initializing the graduation pool", async () => {
  const coin = await launch(ctx.operator, agentVault, E(0.001));
  const pm = { address: ctx.d.poolManager, abi: abi("PoolManager") };
  const key = { currency0: zeroAddress, currency1: coin, fee: 10000, tickSpacing: 200, hooks: ctx.d.graduationHook };
  await reverts(ctx.eve.writeContract({ ...pm, functionName: "initialize", args: [key, 79228162514264337593543950336n] }), "hook");
});

test("coins are locked wallet-to-wallet on the curve", async () => {
  const coin = await launch(ctx.operator, agentVault, E(0.002));
  const v2 = await createAgent(ctx.bob);
  await tx(ctx.operator.writeContract({ ...vault(v2), functionName: "buy", args: [coin, E(0.01), 0n] }));
  // the vault can't hand coins to anyone, and nobody else can launch or sell on the curve
  await reverts(ctx.bob.writeContract({ ...lp(), functionName: "create", args: ["X", "X", "u", 0n], value: E(0.01) }), "human create");
  assert.equal(await read(coinC(coin), "unlocked"), false);
  // nobody can move coins out of a vault: not by transfer, transferFrom or burnFrom, not even the launchpad's own approvals
  const toks = await read(coinC(coin), "balanceOf", [v2]);
  assert.ok(toks > 0n);
  await reverts(ctx.bob.writeContract({ ...coinC(coin), functionName: "transferFrom", args: [v2, ctx.bob.account.address, 1n] }), "transferFrom");
  await reverts(ctx.bob.writeContract({ ...coinC(coin), functionName: "burnFrom", args: [v2, 1n] }), "burnFrom");
  await reverts(ctx.bob.writeContract({ ...vault(v2), functionName: "withdrawToken", args: [coin, 1n] }), "owner withdraws coin");
});

test("fees split 75% creator / 15% brain fund / 10% buyback-and-burn", async () => {
  const coin = await launch(ctx.operator, agentVault, E(0.001));
  const v2 = await createAgent(ctx.bob);
  const c0 = await read(lp(), "creatorEthOwed", [agentVault]);
  const b0 = await read(lp(), "brainEthOwed");
  const u0 = await read(lp(), "burnEthOwed");
  const r = await tx(ctx.operator.writeContract({ ...vault(v2), functionName: "buy", args: [coin, E(0.04), 0n] }));
  const fee = events(r, "AgentLaunchpad").find((e) => e.eventName === "Trade").args.fee;
  assert.equal((await read(lp(), "creatorEthOwed", [agentVault])) - c0, (fee * 7500n) / 10000n);
  assert.equal((await read(lp(), "brainEthOwed")) - b0, (fee * 1500n) / 10000n);
  assert.equal((await read(lp(), "burnEthOwed")) - u0, fee - (fee * 7500n) / 10000n - (fee * 1500n) / 10000n);
});

test("deposit comes back any time; earnings 5%/24h after 72h; nothing goes to strangers", async () => {
  const v = await createAgent(ctx.alice, E(1));
  assert.equal(await read(vault(v), "principal"), E(1));
  // take back half the deposit right away
  const a0 = await balance(ctx.alice.account.address);
  await tx(ctx.alice.writeContract({ ...vault(v), functionName: "withdrawDeposit", args: [E(0.5)] }));
  assert.ok((await balance(ctx.alice.account.address)) - a0 > E(0.49));
  await reverts(ctx.alice.writeContract({ ...vault(v), functionName: "withdrawDeposit", args: [E(0.6)] }), "over deposit");
  await reverts(ctx.eve.writeContract({ ...vault(v), functionName: "withdrawDeposit", args: [1n] }), "stranger");
  // earnings: a drop from someone else (not the owner) is earnings, not deposit
  await tx(ctx.bob.sendTransaction({ to: v, value: E(0.2) }));
  assert.equal(await read(vault(v), "principal"), E(0.5));
  assert.equal(await read(vault(v), "earnings"), E(0.2));
  assert.equal(await read(vault(v), "earningsAvailable"), 0n); // locked for 72h
  await reverts(ctx.alice.writeContract({ ...vault(v), functionName: "withdrawEarnings", args: [1n] }), "locked");
  await warp(72 * 3600 + 1);
  const cap = (E(0.7) * 500n) / 10000n; // 5% of the 0.7 ETH balance
  assert.equal(await read(vault(v), "earningsAvailable"), cap);
  await reverts(ctx.alice.writeContract({ ...vault(v), functionName: "withdrawEarnings", args: [cap + 1n] }), "over 5%");
  // a temporary top-up doesn't lift the cap: deposits from the last 24h don't count
  await tx(ctx.alice.writeContract({ ...vault(v), functionName: "deposit", value: E(10) }));
  assert.equal(await read(vault(v), "earningsAvailable"), cap);
  await tx(ctx.alice.writeContract({ ...vault(v), functionName: "withdrawDeposit", args: [E(10)] }));
  await tx(ctx.alice.writeContract({ ...vault(v), functionName: "withdrawEarnings", args: [cap] }));
  await reverts(ctx.alice.writeContract({ ...vault(v), functionName: "withdrawEarnings", args: [1n] }), "24h cooldown");
  await warp(24 * 3600 + 1);
  assert.ok((await read(vault(v), "earningsAvailable")) > 0n);
});

test("$ETHERAGENTS hold: 100k per agent once the token is set; below it, no edits or earnings, deposit still out", async () => {
  const id = await snapshot();
  const tok = await ctx.deployer.deployContract({ abi: abi("MockToken"), bytecode: (await import("../scripts/lib/core.mjs")).artifact("MockToken").bytecode });
  const token = (await client.waitForTransactionReceipt({ hash: tok })).contractAddress;
  const T = { address: token, abi: abi("MockToken") };
  const owned = await read(fac(), "agentsOwned", [ctx.alice.account.address]);
  await tx(ctx.deployer.writeContract({ ...fac(), functionName: "setHold", args: [token, E(100000)] }));
  assert.equal(await read(fac(), "holdNeeded", [ctx.alice.account.address]), (owned + 1n) * E(100000));
  await reverts(ctx.alice.writeContract({ ...fac(), functionName: "createAgent", args: ["nohold", keccak256(toHex("p")), "", 0n, 0n], value: E(0.1) }), "no hold");
  await tx(ctx.deployer.writeContract({ ...T, functionName: "mint", args: [ctx.alice.account.address, (owned + 1n) * E(100000)] }));
  const v = await createAgent(ctx.alice, E(0.5));
  assert.equal(await read(fac(), "holdOk", [ctx.alice.account.address]), true);
  // sell below the hold: agent keeps trading, owner can't change limits or take earnings, but the deposit comes back
  await tx(ctx.alice.writeContract({ ...T, functionName: "transfer", args: [ctx.eve.account.address, E(1)] }));
  assert.equal(await read(fac(), "holdOk", [ctx.alice.account.address]), false);
  await reverts(ctx.alice.writeContract({ ...vault(v), functionName: "setLimits", args: [0n, 0n] }), "edit below hold");
  await tx(ctx.bob.sendTransaction({ to: v, value: E(0.1) }));
  await warp(72 * 3600 + 1);
  assert.equal(await read(vault(v), "earningsAvailable"), 0n);
  await reverts(ctx.alice.writeContract({ ...vault(v), functionName: "withdrawEarnings", args: [1n] }), "earnings below hold");
  await tx(ctx.alice.writeContract({ ...vault(v), functionName: "withdrawDeposit", args: [E(0.4)] }));
  await revert(id);
});

test("buyback-and-burn: ETH in, $ETHERAGENTS bought and sent to the dead address", async () => {
  const id = await snapshot();
  const core = await import("../scripts/lib/core.mjs");
  const dep = async (n, args = []) => (await client.waitForTransactionReceipt({ hash: await ctx.deployer.deployContract({ abi: abi(n), bytecode: core.artifact(n).bytecode, args }) })).contractAddress;
  const token = await dep("MockToken");
  const router = await dep("MockRouter", [token, 1000n]);
  const bb = { address: ctx.d.buyback, abi: abi("BuybackBurn") };
  await tx(ctx.eve.writeContract({ ...lp(), functionName: "claimProtocolFees" }));
  const eth = await balance(ctx.d.buyback);
  assert.ok(eth > 0n, "burn share arrived");
  await reverts(ctx.operator.writeContract({ ...bb, functionName: "buyAndBurn", args: [router, "0x", eth, 0n] }), "no token yet");
  await tx(ctx.deployer.writeContract({ ...bb, functionName: "setToken", args: [token] }));
  await tx(ctx.deployer.writeContract({ ...bb, functionName: "setRouter", args: [router, true] }));
  const { encodeFunctionData } = await import("viem");
  const data = encodeFunctionData({ abi: abi("MockRouter"), functionName: "swap", args: [ctx.d.buyback] });
  await reverts(ctx.eve.writeContract({ ...bb, functionName: "buyAndBurn", args: [router, data, eth, 0n] }), "not keeper");
  await tx(ctx.operator.writeContract({ ...bb, functionName: "buyAndBurn", args: [router, data, eth, eth * 1000n] }));
  const dead = await read({ address: token, abi: abi("MockToken") }, "balanceOf", ["0x000000000000000000000000000000000000dEaD"]);
  assert.equal(dead, eth * 1000n);
  assert.equal(await balance(ctx.d.buyback), 0n);
  await revert(id);
});

test("$ETHERAGENTS rewards: 60% drops to agents, 10% burn, 20% brain fund, 10% team", async () => {
  const tr = { address: ctx.d.tokenRewards, abi: abi("TokenRewards") };
  const t0 = await balance(ctx.treasury.account.address); // brain fund + team = treasury in tests
  const bb0 = await balance(ctx.d.buyback);
  await tx(ctx.bob.sendTransaction({ to: ctx.d.tokenRewards, value: E(1) }));
  await tx(ctx.eve.writeContract({ ...tr, functionName: "split" }));
  assert.equal(await read(tr, "dropPool"), E(0.6));
  assert.equal((await balance(ctx.d.buyback)) - bb0, E(0.1));
  assert.equal((await balance(ctx.treasury.account.address)) - t0, E(0.3));
  const v = await createAgent(ctx.alice, E(0.1));
  await reverts(ctx.operator.writeContract({ ...tr, functionName: "drop", args: [[ctx.eve.account.address], [E(0.01)]] }), "not an agent");
  await reverts(ctx.eve.writeContract({ ...tr, functionName: "drop", args: [[v], [E(0.01)]] }), "not keeper");
  await tx(ctx.operator.writeContract({ ...tr, functionName: "drop", args: [[v, v], [E(0.01), E(0.02)]] }));
  assert.equal(await read(vault(v), "earnings"), E(0.03));
  await reverts(ctx.operator.writeContract({ ...tr, functionName: "drop", args: [[v], [E(1)]] }), "over pool");
});

test("rescue cannot touch reserves", async () => {
  const lpBal = await balance(ctx.d.launchpad);
  await reverts(ctx.deployer.writeContract({ ...lp(), functionName: "rescueETH", args: [ctx.deployer.account.address, lpBal] }), "rescue reserves");
});

test("protocol fees: creation fees + brain share to the treasury, burn share to BuybackBurn", async () => {
  const owed = (await read(lp(), "protocolEthOwed")) + (await read(lp(), "brainEthOwed"));
  const burn = await read(lp(), "burnEthOwed");
  const b = await balance(ctx.treasury.account.address);
  const bb = await balance(ctx.d.buyback);
  await tx(ctx.eve.writeContract({ ...lp(), functionName: "claimProtocolFees" }));
  assert.equal((await balance(ctx.treasury.account.address)) - b, owed);
  assert.equal((await balance(ctx.d.buyback)) - bb, burn);
});
