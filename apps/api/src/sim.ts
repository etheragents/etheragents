// SimMarket: the whole economy in memory, with the exact curve math of AgentLaunchpad and a constant-product
// stand-in for the graduated Uniswap v4 pool. Lets the platform run end-to-end with no chain (SIM=1).
import { keccak256, toHex } from "viem";
import type { AgentRec, CoinRec } from "./store.ts";
import type { Ledger } from "./ledger.ts";
import { curve, curveParams, pool, SUPPLY, type LaunchParams, type Market } from "./market.ts";
import { HttpError } from "./util.ts";

export class SimMarket implements Market {
  readonly mode = "sim" as const;
  readonly params = curveParams();

  private ledger: Ledger;
  readonly chainId: number;
  constructor(ledger: Ledger, chainId: number) {
    this.ledger = ledger;
    this.chainId = chainId;
  }

  async start() {}

  private nonce(tag: string) {
    const m = this.ledger.store.meta;
    m.simNonce++;
    this.ledger.store.bumpMeta();
    return keccak256(toHex(`${tag}:${m.simNonce}:${Date.now()}`));
  }
  address(tag: string): `0x${string}` {
    return `0x${this.nonce(tag).slice(26)}`;
  }
  private txHash() {
    return this.nonce("tx");
  }

  private debit(a: AgentRec, wei: bigint) {
    const b = BigInt(a.balanceWei);
    if (wei > b) throw new HttpError(400, "insufficient vault balance");
    a.balanceWei = (b - wei).toString();
  }
  private credit(a: AgentRec | undefined, wei: bigint) {
    if (!a) return;
    a.balanceWei = (BigInt(a.balanceWei) + wei).toString();
  }

  async launch(a: AgentRec, p: LaunchParams) {
    const tx = this.txHash();
    const coinAddr = this.address("coin");
    const uri = JSON.stringify({ about: p.about, thesis: p.thesis });
    const coin = this.ledger.onCoinCreated({
      coin: coinAddr,
      creator: a.vault,
      name: p.name,
      symbol: p.symbol,
      uri,
      virtualEth: this.params.virtualEth,
      virtualToken: this.params.virtualToken,
      curveSupply: this.params.curveSupply,
      supply: SUPPLY,
      tx,
      about: p.about,
      thesis: p.thesis,
    });
    if (p.ethWei > 0n) await this.buy(a, coin, p.ethWei, tx);
    return { coin, tx };
  }

  async buy(a: AgentRec, c: CoinRec, ethWei: bigint, txIn?: string) {
    const tx = txIn ?? this.txHash();
    this.debit(a, ethWei);
    if (c.graduated) {
      const q = pool.buy(c, ethWei);
      c.poolEth = (BigInt(c.poolEth) + q.inNet).toString();
      c.poolTokens = (BigInt(c.poolTokens) - q.out).toString();
      this.payFees(c, q.fee);
      this.ledger.onTrade({ coin: c.address, trader: a.vault, side: "buy", ethWei, tokensWei: q.out, feeWei: 0n, priceEth: pool.price(c), viaPool: true, tx });
      this.ledger.onFeesCollected(c.address, q.fee);
      return { tx, tokensWei: q.out };
    }
    const q = curve.buy(c, ethWei);
    if (q.out <= 0n) throw new HttpError(400, "trade too small");
    this.credit(a, q.refund);
    c.ethReserve = (BigInt(c.ethReserve) + q.net).toString();
    c.tokensSold = (BigInt(c.tokensSold) + q.out).toString();
    this.payFees(c, q.fee);
    this.ledger.onTrade({
      coin: c.address,
      trader: a.vault,
      side: "buy",
      ethWei: q.net + q.fee,
      tokensWei: q.out,
      feeWei: q.fee,
      ethReserveWei: BigInt(c.ethReserve),
      tokensSoldWei: BigInt(c.tokensSold),
      priceEth: curve.price(c),
      viaPool: false,
      tx,
    });
    if (q.last) this.graduate(c, tx);
    return { tx, tokensWei: q.out };
  }

  async sell(a: AgentRec, c: CoinRec, tokensWei: bigint) {
    const tx = this.txHash();
    const pos = this.ledger.position(a.vault, c.address);
    const held = pos ? BigInt(pos.tokens) : 0n;
    if (tokensWei > held) tokensWei = held;
    if (tokensWei <= 0n) throw new HttpError(400, "nothing to sell");
    if (c.graduated) {
      const q = pool.sell(c, tokensWei);
      c.poolTokens = (BigInt(c.poolTokens) + q.inNet).toString();
      c.poolEth = (BigInt(c.poolEth) - q.out).toString();
      c.supply = (BigInt(c.supply) - q.fee).toString(); // token-side pool fees are burned
      this.credit(a, q.out);
      this.ledger.onTrade({ coin: c.address, trader: a.vault, side: "sell", ethWei: q.out, tokensWei, feeWei: 0n, priceEth: pool.price(c), viaPool: true, tx });
      return { tx, ethWei: q.out };
    }
    const q = curve.sell(c, tokensWei);
    if (q.out <= 0n) throw new HttpError(400, "trade too small");
    c.ethReserve = (BigInt(c.ethReserve) - q.gross).toString();
    c.tokensSold = (BigInt(c.tokensSold) - q.tokensIn).toString();
    this.payFees(c, q.fee);
    this.credit(a, q.out);
    this.ledger.onTrade({
      coin: c.address,
      trader: a.vault,
      side: "sell",
      ethWei: q.gross,
      tokensWei: q.tokensIn,
      feeWei: q.fee,
      ethReserveWei: BigInt(c.ethReserve),
      tokensSoldWei: BigInt(c.tokensSold),
      priceEth: curve.price(c),
      viaPool: false,
      tx,
    });
    return { tx, ethWei: q.out };
  }

  /** The creator's 75% of the fee goes straight to the creator's vault (the sim auto-claims). The brain share is
   *  credited by the ledger; the burn share leaves the sim. */
  private payFees(c: CoinRec, feeWei: bigint) {
    if (feeWei <= 0n) return;
    const creator = this.ledger.store.agents.get(c.agent);
    if (creator) {
      const share = (feeWei * 7500n) / 10000n;
      this.credit(creator, share);
      creator.feesClaimedEth += Number(share) / 1e18;
      this.ledger.store.agents.touch(creator);
    }
  }

  private graduate(c: CoinRec, tx: string) {
    const ethAmt = BigInt(c.ethReserve);
    const x = BigInt(c.virtualEth) + ethAmt;
    const y = BigInt(c.virtualToken) - BigInt(c.tokensSold);
    const unsold = SUPPLY - BigInt(c.tokensSold);
    let tokenAmt = (ethAmt * y) / x;
    if (tokenAmt > unsold) tokenAmt = unsold;
    this.ledger.onGraduated({
      coin: c.address,
      poolId: this.nonce("pool"),
      ethLiquidityWei: ethAmt,
      tokenLiquidityWei: tokenAmt,
      burnedWei: unsold - tokenAmt,
      tx,
    });
  }

  gasGwei() {
    return 0;
  }
  coinFeeEth() {
    return 0;
  }

  async claimFees() {}
  async refreshBalance() {}

  quoteBuy(c: CoinRec, ethWei: bigint) {
    return c.graduated ? pool.buy(c, ethWei).out : curve.buy(c, ethWei).out;
  }
  quoteSell(c: CoinRec, tokensWei: bigint) {
    return c.graduated ? pool.sell(c, tokensWei).out : curve.sell(c, tokensWei).out;
  }

  contracts() {
    return { factory: null, launchpad: null, identityRegistry: null };
  }
  curve() {
    return { startMcapEth: this.params.startMcapEth, gradMcapEth: this.params.gradMcapEth, raiseEth: this.params.raiseEth };
  }
}
