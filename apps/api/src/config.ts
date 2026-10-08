// All runtime configuration, from the environment.
const env = process.env;
const num = (v: string | undefined, d: number) => (v === undefined || v === "" ? d : Number(v));

// Any OpenAI-compatible chat-completions gateway works. Presets: Orbio (default when ORBIO_API_KEY is set) and
// OpenRouter; "custom" uses LLM_BASE_URL + LLM_API_KEY; "mock" is the offline brain.
export type LlmProvider = "orbio" | "openrouter" | "custom" | "mock";

const provider = (env.LLM_PROVIDER ||
  (env.ORBIO_API_KEY ? "orbio" : env.OPENROUTER_API_KEY ? "openrouter" : env.LLM_API_KEY ? "custom" : "mock")) as LlmProvider;

const BASE_URLS: Record<string, string> = {
  orbio: "https://api.orbio.so/api/v1",
  openrouter: "https://openrouter.ai/api/v1",
};

/** Accept a private key with or without 0x, ignoring stray spaces, quotes and newlines. */
export function normKey(k?: string): `0x${string}` | undefined {
  if (!k) return undefined;
  const s = k.trim().replace(/^["']|["']$/g, "").replace(/\s+/g, "");
  const h = s.startsWith("0x") ? s : "0x" + s;
  if (!/^0x[0-9a-fA-F]{64}$/.test(h)) throw new Error("OPERATOR_PRIVATE_KEY must be 64 hex characters (0x optional)");
  return h as `0x${string}`;
}

export const config = {
  port: num(env.PORT, 8787),
  publicUrl: (env.API_PUBLIC_URL || `http://localhost:${num(env.PORT, 8787)}`).replace(/\/$/, ""),
  sim: env.SIM === "1" || env.SIM === "true",
  chainId: num(env.CHAIN_ID, env.SIM === "1" ? 31337 : 1),
  rpcUrls: (env.RPC_URL || "http://127.0.0.1:8545").split(",").map((s) => s.trim()).filter(Boolean),
  operatorKey: normKey(env.OPERATOR_PRIVATE_KEY),
  databaseUrl: env.DATABASE_URL,
  dataDir: env.DATA_DIR || ".data",

  llm: {
    provider,
    model: env.LLM_MODEL || (provider === "mock" ? "mock-1" : "deepseek/deepseek-v4.1-flash"),
    baseUrl: (env.LLM_BASE_URL || BASE_URLS[provider] || "").replace(/\/+$/, ""),
    apiKey: env.LLM_API_KEY || (provider === "orbio" ? env.ORBIO_API_KEY : provider === "openrouter" ? env.OPENROUTER_API_KEY : undefined),
    // ask the gateway for strict JSON output; set LLM_JSON_MODE=0 if a gateway or model rejects it
    jsonMode: env.LLM_JSON_MODE !== "0",
    // coin logos: drawn by an image model through the same gateway (LOGOS=0 turns it off)
    logos: env.LOGOS !== "0",
    imageModel: env.LLM_IMAGE_MODEL || "google/gemini-2.5-flash-image",
    concurrency: num(env.LLM_CONCURRENCY, 4),
    timeoutMs: num(env.LLM_TIMEOUT_MS, 45_000),
  },

  brain: {
    enabled: env.BRAIN !== "0",
    tickSeconds: num(env.BRAIN_TICK_SECONDS, 10),
    // each agent wakes up roughly every N seconds (jittered)
    agentIntervalSeconds: num(env.AGENT_INTERVAL_SECONDS, env.SIM === "1" ? 25 : 120),
    minTradeEth: num(env.MIN_TRADE_ETH, env.SIM === "1" ? 0.001 : 0.003),
    gasReserveEth: num(env.GAS_RESERVE_ETH, env.SIM === "1" ? 0 : 0.004),
    // per agent: one launch per cooldown (each launch costs the agent its own first buy and gas)
    launchCooldownSeconds: num(env.LAUNCH_COOLDOWN_SECONDS, env.SIM === "1" ? 900 : 3600),
    // platform-wide cap on launches per hour; 0 = no cap (the default)
    maxLaunchesPerHour: num(env.MAX_LAUNCHES_PER_HOUR, 0),
    slippageBps: num(env.SLIPPAGE_BPS, 500),
    // on mainnet every trade costs gas (reimbursed by the agent's own vault), so cap the pace
    maxTradesPerHour: num(env.MAX_TRADES_PER_HOUR, env.SIM === "1" ? 30 : 4),
    // a coin's website can be rewritten at most this often (each version is an extra, larger LLM call)
    siteCooldownSeconds: num(env.SITE_COOLDOWN_SECONDS, env.SIM === "1" ? 900 : 4 * 3600),
    // every rewrite of a coin's website costs this much from its agent's brain budget (15% of its coin's fees).
    // The first version is on the platform.
    siteCostEth: num(env.SITE_COST_ETH, env.SIM === "1" ? 0.0002 : 0.0005),
    // self-funding: 15% of a coin's fees go to its agent's brain budget. While that budget lasts the agent thinks
    // more often (interval × BOOST_FACTOR) and pays for its own inference, websites and logo out of it.
    boostFactor: num(env.BOOST_FACTOR, 0.4),
    // sponsored launches: an agent with too little ETH still launches its coin (no first buy); the operator pays the
    // gas and the vault can't refund it. Capped per day and skipped when gas is expensive (agents wait and retry).
    sponsorLaunches: env.SPONSOR_LAUNCHES !== "0",
    sponsorMaxEthPerDay: num(env.SPONSOR_MAX_ETH_PER_DAY, 1),
    sponsorMaxGwei: num(env.SPONSOR_MAX_GWEI, 5),
    boostMinEth: num(env.BOOST_MIN_ETH, env.SIM === "1" ? 0.00005 : 0.0002),
    logoCostEth: num(env.LOGO_COST_ETH, 0.0002),
    // inference price used to charge brain budgets (USD per 1M tokens) and the ETH price to convert it
    priceInUsd: num(env.LLM_PRICE_IN_USD, 0.3),
    priceOutUsd: num(env.LLM_PRICE_OUT_USD, 1.2),
    ethUsd: num(env.ETH_USD, 4000),
  },

  // chain mode: the operator key also routes protocol fees and drops $EA rewards (see keeper.ts)
  keeper: {
    enabled: env.KEEPER !== "0",
    everySeconds: num(env.KEEPER_EVERY_SECONDS, 600),
    minRouteEth: num(env.KEEPER_MIN_ROUTE_ETH, 0.01), // don't spend gas routing less than this
    minDropEth: num(env.KEEPER_MIN_DROP_ETH, 0.002),
    dropSlice: num(env.KEEPER_DROP_SLICE, 0.1), // share of the drop pool dropped per round
    dropsPerRound: num(env.KEEPER_DROPS_PER_ROUND, 6),
  },

  house: {
    count: num(env.HOUSE_AGENTS, env.SIM === "1" ? 12 : 0),
    depositEth: num(env.HOUSE_DEPOSIT_ETH, 1),
  },

  indexerPollMs: num(env.INDEXER_POLL_MS, 6000),
  startBlock: env.START_BLOCK ? BigInt(env.START_BLOCK) : undefined,
};

export type Config = typeof config;
