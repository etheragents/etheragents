// ChainMarket: the brain's operator key drives AgentVaults on Ethereum; an indexer turns launchpad/factory logs into
// ledger events (for every trader — agents and humans alike). Every agent action waits for its receipt and then for
// the indexer to pass that block, so state has a single source of truth: the chain.
import {
  createPublicClient,
  createWalletClient,
  fallback,
  http,
  parseEventLogs,
  type Hex,
  type Log,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet, sepolia, hardhat } from "viem/chains";
import { agentFactoryAbi, agentLaunchpadAbi, agentVaultAbi, deploymentFor, personaHash, type Deployment } from "@etheragents/shared";
import { config } from "./config.ts";
import type { AgentRec, CoinRec } from "./store.ts";
import type { Ledger } from "./ledger.ts";
import { curve, pool, SUPPLY, BPS, type LaunchParams, type Market } from "./market.ts";
import { colorFor, HttpError, now, randomSeed, sleep, toEth } from "./util.ts";

// vault ABI + the launchpad's custom errors, so reverts bubble up with readable names (Slippage, …)
const VAULT_ABI_WITH_ERRORS = [...agentVaultAbi, ...agentLaunchpadAbi.filter((x) => x.type === "error")] as const;

const CHAINS = { 1: mainnet, 11155111: sepolia, 31337: hardhat } as const;
const BLOCK_CHUNK = 1000n;

export class ChainMarket implements Market {
  readonly mode = "chain" as const;
  readonly client: PublicClient;
  readonly wallet: WalletClient | null;
  readonly d: Deployment;
  private coinFee = 0n;
  agentFeeEth = 0; // AgentFactory.creationFee, read at start
  private queue: Promise<unknown> = Promise.resolve();
  private syncing: Promise<void> | null = null;
  private blockTimes = new Map<bigint, number>();

  private ledger: Ledger;
  readonly chainId: number;
  constructor(ledger: Ledger, chainId: number) {
    this.ledger = ledger;
    this.chainId = chainId;
    const d = deploymentFor(chainId);
    const factory = (process.env.FACTORY_ADDRESS || d?.factory) as Hex | undefined;
    const launchpad = (process.env.LAUNCHPAD_ADDRESS || d?.launchpad) as Hex | undefined;
    if (!factory || !launchpad) throw new Error(`no deployment for chain ${chainId} — run the deploy script or set FACTORY_ADDRESS/LAUNCHPAD_ADDRESS`);
    this.d = { ...(d as Deployment), factory, launchpad, startBlock: Number(process.env.START_BLOCK || d?.startBlock || 0) };
    const chain = CHAINS[chainId as keyof typeof CHAINS] ?? { ...hardhat, id: chainId };
    const transport = fallback(config.rpcUrls.map((u) => http(u, { timeout: 20_000, retryCount: 2 })));
    this.client = createPublicClient({ chain, transport }) as PublicClient;
    this.wallet = config.operatorKey ? createWalletClient({ chain, transport, account: privateKeyToAccount(config.operatorKey) }) : null;
    if (!this.wallet) console.warn("[chain] OPERATOR_PRIVATE_KEY not set — indexing only, agents cannot act");
  }

  async start() {
    this.coinFee = (await this.client.readContract({ address: this.d.launchpad, abi: agentLaunchpadAbi, functionName: "creationFee" })) as bigint;
    this.agentFeeEth = toEth((await this.client.readContract({ address: this.d.factory, abi: agentFactoryAbi, functionName: "creationFee" })) as bigint);
    const m = this.ledger.store.meta;
    if (BigInt(m.lastBlock) < BigInt(this.d.startBlock) - 1n) m.lastBlock = String(BigInt(this.d.startBlock) - 1n);
    if (this.wallet) {
      const op = this.wallet.account!.address;
      const ok = await this.client.readContract({ address: this.d.factory, abi: agentFactoryAbi, functionName: "isOperator", args: [op] });
      console.log(`[chain] operator ${op} ${ok ? "is authorised" : "is NOT an operator on the factory — agents cannot act"}`);
    }
    const loop = async () => {
      for (;;) {
        try {
          await this.sync();
        } catch (e) {
          console.error("[indexer]", (e as Error).message);
        }
        await sleep(config.indexerPollMs);
      }
    };
    loop();
    setInterval(() => this.refreshAllBalances().catch(() => {}), 60_000).unref();
  }

  // ───────────── actions ─────────────

  private requireWallet(): WalletClient {
    if (!this.wallet) throw new HttpError(503, "operator key not configured");
    return this.wallet;
  }

  /** Serialised: one operator nonce stream. Simulate → send → wait → index up to that block. */
  private exec(fn: () => Promise<Hex>): Promise<{ hash: Hex; logs: Log[] }> {
    const run = async () => {
      const hash = await fn();
      const r = await this.client.waitForTransactionReceipt({ hash, timeout: 180_000 });
      if (r.status !== "success") throw new Error("transaction reverted " + hash);
      await this.syncTo(r.blockNumber);
      return { hash, logs: r.logs as Log[] };
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  private async write(a: AgentRec, functionName: string, args: unknown[]) {
    const w = this.requireWallet();
    const { request } = await this.client.simulateContract({
      address: a.vault as Hex,
      abi: VAULT_ABI_WITH_ERRORS,
      functionName: functionName as never,
      args: args as never,
      account: w.account!,
    });
    return w.writeContract(request as never);
  }

  async launch(a: AgentRec, p: LaunchParams) {
    const uri = "data:application/json," + encodeURIComponent(JSON.stringify({ about: p.about.slice(0, 200), thesis: p.thesis.slice(0, 280), agent: a.handle }));
    const value = p.ethWei + this.coinFee;
    const fake = { virtualEth: this.d.curve.virtualEth, virtualToken: this.d.curve.virtualToken, curveSupply: this.d.curve.curveSupply, ethReserve: "0", tokensSold: "0" };
    const minOut = p.ethWei > 0n ? (curve.buy(fake, p.ethWei).out * (BPS - BigInt(config.brain.slippageBps))) / BPS : 0n;
    const { hash, logs } = await this.exec(() => this.write(a, "launch", [p.name, p.symbol, uri, value, minOut]));
    const ev = parseEventLogs({ abi: agentLaunchpadAbi, logs: logs as never, eventName: "CoinCreated" })[0] as any;
    const coin = ev ? this.ledger.store.coins.get(String(ev.args.coin).toLowerCase()) : undefined;
    if (!coin) throw new Error("launch indexed without a coin");
    await this.refreshBalance(a);
    return { coin, tx: hash };
  }

  async buy(a: AgentRec, c: CoinRec, ethWei: bigint) {
    // quote inside the queue: earlier queued trades have been mined and indexed by then
    const { hash, logs } = await this.exec(() =>
      this.write(a, "buy", [c.address, ethWei, (this.quoteBuy(c, ethWei) * (BPS - BigInt(config.brain.slippageBps))) / BPS]),
    );
    const ev = parseEventLogs({ abi: agentVaultAbi, logs: logs as never, eventName: "Bought" })[0] as any;
    await this.refreshBalance(a);
    return { tx: hash, tokensWei: (ev?.args.tokensOut as bigint) ?? 0n };
  }

  async sell(a: AgentRec, c: CoinRec, tokensWei: bigint) {
    const held = (await this.client.readContract({ address: c.address, abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] }], functionName: "balanceOf", args: [a.vault as Hex] })) as bigint;
    if (tokensWei > held) tokensWei = held;
    if (tokensWei <= 0n) throw new HttpError(400, "nothing to sell");
    const { hash, logs } = await this.exec(() =>
      this.write(a, "sell", [c.address, tokensWei, (this.quoteSell(c, tokensWei) * (BPS - BigInt(config.brain.slippageBps))) / BPS]),
    );
    const ev = parseEventLogs({ abi: agentVaultAbi, logs: logs as never, eventName: "Sold" })[0] as any;
    await this.refreshBalance(a);
    return { tx: hash, ethWei: (ev?.args.ethOut as bigint) ?? 0n };
  }

  async claimFees(a: AgentRec) {
    const owed = (await this.client.readContract({ address: this.d.launchpad, abi: agentLaunchpadAbi, functionName: "creatorEthOwed", args: [a.vault as Hex] })) as bigint;
    if (owed < 5n * 10n ** 15n) return; // claim once worth the gas (0.005 ETH)
    await this.exec(() => this.write(a, "claimFees", []));
    a.feesClaimedEth += toEth(owed);
    await this.refreshBalance(a);
  }

  async refreshBalance(a: AgentRec) {
    const b = await this.client.getBalance({ address: a.vault as Hex });
    if (b.toString() !== a.balanceWei) {
      a.balanceWei = b.toString();
      this.ledger.emitAgent(a);
    }
  }

  async refreshAllBalances() {
    for (const a of this.ledger.store.agents.values()) await this.refreshBalance(a).catch(() => {});
  }

  quoteBuy(c: CoinRec, ethWei: bigint) {
    return c.graduated ? pool.buy(c, ethWei).out : curve.buy(c, ethWei).out;
  }
  quoteSell(c: CoinRec, tokensWei: bigint) {
    return c.graduated ? pool.sell(c, tokensWei).out : curve.sell(c, tokensWei).out;
  }

  contracts() {
    return { factory: this.d.factory, launchpad: this.d.launchpad, identityRegistry: this.d.identityRegistry ?? null };
  }
  curve() {
    return { startMcapEth: this.d.curve.startMcapEth, gradMcapEth: this.d.curve.gradMcapEth, raiseEth: this.d.curve.raiseEth };
  }

  // ───────────── agent registration (POST /api/agents) ─────────────

  /** Verify a createAgent transaction and return the on-chain facts. */
  async verifyCreation(txHash: Hex, expect: { handle: string; name: string; persona: string }) {
    const r = await this.client.waitForTransactionReceipt({ hash: txHash, timeout: 120_000 });
    if (r.status !== "success") throw new HttpError(400, "transaction failed");
    const ev = parseEventLogs({ abi: agentFactoryAbi, logs: r.logs as never, eventName: "AgentCreated" }).find(
      (l: any) => l.address.toLowerCase() === this.d.factory.toLowerCase(),
    ) as any;
    if (!ev) throw new HttpError(400, "no AgentCreated event from the Etheragents factory in that transaction");
    if (ev.args.handle !== expect.handle) throw new HttpError(400, "handle does not match the on-chain record");
    if (ev.args.personaHash !== personaHash(expect)) throw new HttpError(400, "persona does not match the hash committed on-chain");
    await this.syncTo(r.blockNumber);
    return { agentId: Number(ev.args.agentId), vault: ev.args.vault as Hex, owner: ev.args.owner as Hex };
  }

  // ───────────── indexer ─────────────

  async syncTo(block: bigint) {
    while (BigInt(this.ledger.store.meta.lastBlock) < block) {
      await this.sync();
      if (BigInt(this.ledger.store.meta.lastBlock) < block) await sleep(1000);
    }
  }

  sync(): Promise<void> {
    if (!this.syncing) this.syncing = this.syncOnce().finally(() => (this.syncing = null));
    return this.syncing;
  }

  private async syncOnce() {
    const head = await this.client.getBlockNumber();
    const m = this.ledger.store.meta;
    let from = BigInt(m.lastBlock) + 1n;
    while (from <= head) {
      const to = from + BLOCK_CHUNK - 1n > head ? head : from + BLOCK_CHUNK - 1n;
      const logs = await this.client.getLogs({ address: [this.d.factory, this.d.launchpad], fromBlock: from, toBlock: to });
      logs.sort((a, b) => (a.blockNumber === b.blockNumber ? Number(a.logIndex! - b.logIndex!) : Number(a.blockNumber! - b.blockNumber!)));
      for (const l of logs) await this.apply(l);
      m.lastBlock = to.toString();
      this.ledger.store.bumpMeta();
      from = to + 1n;
    }
  }

  private async blockTime(n: bigint): Promise<number> {
    const hit = this.blockTimes.get(n);
    if (hit) return hit;
    const b = await this.client.getBlock({ blockNumber: n });
    const t = Number(b.timestamp);
    this.blockTimes.set(n, t);
    if (this.blockTimes.size > 5000) this.blockTimes.clear();
    return t;
  }

  private async apply(l: Log) {
    const at = await this.blockTime(l.blockNumber!);
    const tx = l.transactionHash!;
    const isFactory = l.address.toLowerCase() === this.d.factory.toLowerCase();
    const [ev] = parseEventLogs({ abi: (isFactory ? agentFactoryAbi : agentLaunchpadAbi) as never, logs: [l] as never }) as any[];
    if (!ev) return;
    const a = ev.args;
    switch (ev.eventName) {
      case "AgentCreated": {
        if (this.ledger.agentByVault(a.vault)) return;
        const seed = randomSeed();
        const rec: AgentRec = {
          id: Number(a.agentId),
          handle: uniqueHandle(this.ledger, a.handle),
          name: a.handle,
          persona: "",
          self: "",
          lessons: [],
          avatar: seed,
          color: colorFor(seed),
          owner: a.owner,
          vault: a.vault,
          identityId: null,
          model: config.llm.model,
          house: false,
          paused: false,
          asleep: true, // until its owner submits the persona
          createdAt: at,
          thought: "waiting for my persona…",
          thoughtAt: at,
          followers: 0,
          following: 0,
          likes: 0,
          realizedEth: 0,
          balanceEth: 0,
          holdingsEth: 0,
          influence: 0,
          launched: 0,
          balanceWei: (a.deposit as bigint).toString(),
          personaHash: a.personaHash,
          maxTradeEth: 0,
          dailyLimitEth: 0,
          windowStart: at,
          spentInWindowEth: 0,
          nextActAt: now() + 30,
          lastLaunchAt: 0,
          controlNonce: 0,
          memory: [],
          lastError: null,
          feesClaimedEth: 0,
        };
        this.ledger.store.agents.set(rec);
        this.ledger.activity("create", `@${rec.handle} was created`, { agent: rec, eth: toEth(a.deposit), tx });
        this.ledger.emitAgent(rec);
        this.readVaultInfo(rec).catch(() => {});
        return;
      }
      case "CoinCreated": {
        let about = "";
        let thesis = "";
        if (typeof a.uri === "string" && a.uri.startsWith("data:application/json,")) {
          try {
            const j = JSON.parse(decodeURIComponent(a.uri.slice("data:application/json,".length)));
            about = String(j.about ?? "");
            thesis = String(j.thesis ?? "");
          } catch {}
        }
        this.ledger.onCoinCreated({
          coin: a.coin,
          creator: a.creator,
          name: a.name,
          symbol: a.symbol,
          uri: a.uri,
          virtualEth: a.virtualEth,
          virtualToken: a.virtualToken,
          curveSupply: a.curveSupply,
          supply: SUPPLY,
          tx,
          at,
          about,
          thesis,
        });
        return;
      }
      case "Trade": {
        const c = this.ledger.store.coins.get(String(a.coin).toLowerCase());
        if (!c) return;
        let priceEth: number;
        if (a.viaPool) {
          const p = (await this.client.readContract({ address: this.d.launchpad, abi: agentLaunchpadAbi, functionName: "price", args: [a.coin], blockNumber: l.blockNumber! })) as bigint;
          priceEth = Number(p) / 1e18;
          // keep a constant-product view of the pool for quotes: k from graduation, reserves from price
          const k = Number(BigInt(c.poolEth || "0")) * Number(BigInt(c.poolTokens || "0"));
          if (k > 0 && priceEth > 0) {
            c.poolEth = BigInt(Math.floor(Math.sqrt(k * priceEth))).toString();
            c.poolTokens = BigInt(Math.floor(Math.sqrt(k / priceEth))).toString();
          }
        } else {
          priceEth = curve.price({ virtualEth: c.virtualEth, virtualToken: c.virtualToken, ethReserve: a.ethReserve.toString(), tokensSold: a.tokensSold.toString() });
        }
        this.ledger.onTrade({
          coin: a.coin,
          trader: a.isBuy ? a.recipient : a.trader, // whose position changes: the receiver of a buy, the seller of a sell
          side: a.isBuy ? "buy" : "sell",
          ethWei: a.ethAmount,
          tokensWei: a.tokenAmount,
          feeWei: a.fee,
          ethReserveWei: a.viaPool ? undefined : a.ethReserve,
          tokensSoldWei: a.viaPool ? undefined : a.tokensSold,
          priceEth,
          viaPool: a.viaPool,
          tx,
          at,
        });
        return;
      }
      case "Graduated":
        this.ledger.onGraduated({ coin: a.coin, poolId: a.poolId, ethLiquidityWei: a.ethLiquidity, tokenLiquidityWei: a.tokenLiquidity, burnedWei: a.burned, tx, at });
        return;
      case "FeesCollected":
        this.ledger.onFeesCollected(a.coin, a.ethFees);
        return;
    }
  }

  private async readVaultInfo(rec: AgentRec) {
    const [hasId, idv, maxT, daily] = await Promise.all([
      this.client.readContract({ address: rec.vault as Hex, abi: agentVaultAbi, functionName: "hasIdentity" }),
      this.client.readContract({ address: rec.vault as Hex, abi: agentVaultAbi, functionName: "identityId" }),
      this.client.readContract({ address: rec.vault as Hex, abi: agentVaultAbi, functionName: "maxTradeWei" }),
      this.client.readContract({ address: rec.vault as Hex, abi: agentVaultAbi, functionName: "dailyLimitWei" }),
    ]);
    rec.identityId = hasId ? Number(idv) : null;
    rec.maxTradeEth = toEth(maxT as bigint);
    rec.dailyLimitEth = toEth(daily as bigint);
    this.ledger.emitAgent(rec);
  }

  /** Re-read on-chain pause flags (owners pause from their wallet). */
  async refreshPaused(rec: AgentRec) {
    const p = (await this.client.readContract({ address: rec.vault as Hex, abi: agentVaultAbi, functionName: "paused" })) as boolean;
    const [maxT, daily] = await Promise.all([
      this.client.readContract({ address: rec.vault as Hex, abi: agentVaultAbi, functionName: "maxTradeWei" }),
      this.client.readContract({ address: rec.vault as Hex, abi: agentVaultAbi, functionName: "dailyLimitWei" }),
    ]);
    rec.maxTradeEth = toEth(maxT as bigint);
    rec.dailyLimitEth = toEth(daily as bigint);
    if (p !== rec.paused) {
      rec.paused = p;
      this.ledger.emitAgent(rec);
    }
  }
}

export function uniqueHandle(ledger: Ledger, wanted: string): string {
  let h = wanted.replace(/[^A-Za-z0-9_]/g, "").slice(0, 20) || "agent";
  if (h.length < 2) h = h + "_x";
  let i = 2;
  const base = h;
  while (ledger.agentByHandle(h)) h = `${base.slice(0, 17)}_${i++}`;
  return h;
}
