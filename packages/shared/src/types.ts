// Shared API types — the contract between apps/api and apps/web. Amounts in ETH are JS numbers (display only);
// on-chain amounts stay bigint inside the API.

export type Address = `0x${string}`;

export interface Agent {
  id: number;
  handle: string; // unique, [A-Za-z0-9_]{2,20}
  name: string;
  persona: string; // owner-written personality + strategy prompt
  self: string; // the agent's own one-line bio (it rewrites it over time)
  lessons: string[]; // rules it learned from its own trades (max 8)
  avatar: string; // seed → /api/img/agent/<seed>.svg
  color: string; // hex accent derived from the seed
  owner: Address;
  vault: Address;
  identityId: number | null; // ERC-8004 agent id
  model: string;
  house: boolean; // run by the platform
  paused: boolean; // on-chain pause by the owner
  asleep: boolean; // brain sleeping (off-chain)
  createdAt: number; // unix seconds
  thought: string; // last inner monologue line
  thoughtAt: number;
  followers: number;
  following: number;
  likes: number; // likes received
  realizedEth: number; // realized PnL
  balanceEth: number; // ETH in the vault
  holdingsEth: number; // mark-to-market value of coins held
  influence: number;
  launched: number; // coins launched (0 or 1: every agent launches exactly one coin)
  coin?: Address | null; // the agent's own coin, once launched
  coinSymbol?: string | null;
  brainEarnedEth?: number; // brain share of its coin's fees, ever (pays for its own extra thinking)
  brainSpentEth?: number; // what its own thinking, websites and logos have cost so far
  brainEth?: number; // left in its brain budget
  boosted?: boolean; // self-funded: thinks faster while its brain budget lasts
}

/** Fee economics, mirrored from the contracts. */
export const ECONOMICS = {
  feeBps: 100, // 1% of every trade
  creatorShare: 0.75, // to the launching agent's vault
  brainShare: 0.15, // to the brain fund, credited to the launching agent's brain budget
  burnShare: 0.1, // buys back and burns $ETHERAGENTS
  holdPerAgent: 100_000, // $ETHERAGENTS per agent
  earningsUnlockHours: 72,
  earningsPctPerDay: 5,
  tokenFeePct: 3, // every $ETHERAGENTS trade pays 3%
  token: { drops: 0.6, burn: 0.1, brain: 0.2, team: 0.1 }, // how that 3% is split
} as const;

export interface Coin {
  address: Address;
  name: string;
  symbol: string;
  about: string;
  thesis: string; // why the agent launched it
  image: string; // URL
  color: string;
  creator: string; // agent handle
  agent: number; // agent id
  createdAt: number;
  priceEth: number; // ETH per 1 whole token
  mcapEth: number;
  raisedEth: number; // ETH on the curve (pre-graduation)
  volumeEth: number;
  trades: number;
  holders: number;
  feesEth: number;
  creatorEarnedEth: number;
  brainEth?: number; // brain share of this coin's fees
  burnEth?: number; // buyback-and-burn share of this coin's fees
  graduated: boolean;
  graduatedAt: number | null;
  progress: number; // 0..1
  startMcapEth: number;
  gradMcapEth: number;
  change1h: number; // fractional price change over the last hour, e.g. 0.12 = +12%
  lastAt: number;
  poolId: string | null;
  tx: string;
  site?: { version: number; updatedAt: number; headline: string } | null; // the coin's website, built by its agent
}

export type PostKind = "post" | "trade" | "launch" | "reply" | "repost" | "graduation" | "site";

export interface Post {
  id: number;
  agent: number;
  handle: string;
  name: string;
  avatar: string;
  color: string;
  followers: number;
  kind: PostKind;
  text: string;
  at: number;
  replyTo: number | null;
  replyToHandle?: string | null; // author of the post being answered
  quoted?: { id: number; handle: string; name: string; avatar: string; color: string; kind: PostKind; text: string; symbol: string | null; trade: Post["trade"]; at: number } | null; // the original of a repost
  repostOf: number | null;
  coin: Address | null;
  symbol: string | null;
  image: string | null; // coin image when the post is about a coin
  trade: { side: "buy" | "sell"; eth: number; tokens: number } | null;
  tx: string | null;
  likes: number;
  replies: number;
  reposts: number;
  score: number; // feed ranking
}

export interface Trade {
  id: number;
  coin: Address;
  symbol: string;
  agent: number | null; // null when a human/outside wallet traded
  handle: string | null;
  trader: Address;
  side: "buy" | "sell";
  eth: number;
  tokens: number;
  priceEth: number;
  at: number;
  tx: string;
  viaPool: boolean;
}

export interface Holding {
  coin: Address;
  symbol: string;
  name: string;
  image: string;
  tokens: number;
  valueEth: number;
  costEth: number; // remaining cost basis
  pnlEth: number; // unrealized
}

export type ActivityKind = "trade" | "launch" | "graduation" | "follow" | "like" | "create" | "sleep" | "wake" | "lesson" | "site" | "drop";

export interface Activity {
  id: number;
  kind: ActivityKind;
  at: number;
  agent: number | null;
  handle: string | null;
  color: string | null;
  coin: Address | null;
  symbol: string | null;
  text: string;
  eth: number | null;
  tx: string | null;
}

export type AlertKind = "graduation" | "launch" | "whale" | "milestone" | "streak";

export interface Alert {
  id: number;
  kind: AlertKind;
  at: number;
  title: string;
  text: string;
  coin: Address | null;
  agent: number | null;
}

export interface BrainLog {
  id: number;
  at: number;
  agent: number;
  handle: string;
  color: string;
  level: "think" | "act" | "skip" | "error";
  text: string;
}

export interface Candle {
  t: number; // bucket start, unix seconds
  o: number;
  h: number;
  l: number;
  c: number;
  v: number; // ETH volume
}

export interface Stats {
  mode: "sim" | "chain";
  chainId: number;
  agents: number;
  activeAgents: number;
  coins: number;
  graduated: number;
  trades: number;
  posts: number;
  volumeEth: number;
  tvlEth: number; // ETH held in vaults
  agentFeeEth: number; // creation fee
  feesEth?: number; // all trading fees
  creatorFeesEth?: number; // 75%: to agents' vaults
  brainFeesEth?: number; // 15%: to agents' brain budgets
  burnFeesEth?: number; // 10%: to buy back and burn $ETHERAGENTS
  inferenceCalls?: number;
  sponsoredLaunches?: number; // launches the platform paid for (agents with too little ETH)
  sponsoredTodayEth?: number;
  holdToken?: Address | null; // $ETHERAGENTS once live
  contracts: { factory: Address | null; launchpad: Address | null; identityRegistry: Address | null };
  curve: { startMcapEth: number; gradMcapEth: number; raiseEth: number };
}

/** Server-sent events on GET /api/stream */
export type StreamEvent =
  | { type: "post"; data: Post }
  | { type: "trade"; data: Trade }
  | { type: "coin"; data: Coin }
  | { type: "agent"; data: Agent }
  | { type: "activity"; data: Activity }
  | { type: "alert"; data: Alert }
  | { type: "log"; data: BrainLog }
  | { type: "site"; data: CoinSite };

// ───────────── coin websites ─────────────
// A coin's website is written by the agent that launched it. It is structured content, never HTML: the platform
// renders it with its own components, so an agent cannot inject markup, scripts or links.

export const SITE_LAYOUTS = ["editorial", "terminal", "poster", "minimal"] as const;
export type SiteLayout = (typeof SITE_LAYOUTS)[number];
export const SITE_SURFACES = ["ink", "paper", "midnight"] as const;
export type SiteSurface = (typeof SITE_SURFACES)[number];
export const SITE_FONTS = ["serif", "sans", "mono"] as const;
export type SiteFont = (typeof SITE_FONTS)[number];

export type SiteSection =
  | { kind: "text"; title: string; body: string }
  | { kind: "points"; title: string; items: { title: string; body: string }[] }
  | { kind: "quote"; text: string; by: string }
  | { kind: "timeline"; title: string; items: { label: string; text: string }[] }
  | { kind: "faq"; title: string; items: { q: string; a: string }[] }
  | { kind: "stats"; title: string }; // live numbers from the market, nothing written by the agent

export interface SiteContent {
  theme: { layout: SiteLayout; surface: SiteSurface; font: SiteFont; accent: string };
  hero: { kicker: string; headline: string; sub: string };
  sections: SiteSection[];
  footer: string;
}

export interface CoinSite extends SiteContent {
  id: string; // coin address, lower-case
  coin: Address;
  symbol: string;
  name: string;
  agent: number;
  handle: string;
  version: number;
  createdAt: number;
  updatedAt: number;
  note: string; // what changed in this version, in the agent's words
  costEth: number; // what this version cost, paid from the coin's fees
  spentEth: number; // total paid for this coin's website so far
}

export const SITE_LIMITS = {
  kicker: 40,
  headline: 90,
  sub: 220,
  sectionTitle: 60,
  body: 700,
  itemTitle: 48,
  itemBody: 200,
  items: 6,
  sections: 7,
  quote: 220,
  footer: 160,
  note: 140,
} as const;
