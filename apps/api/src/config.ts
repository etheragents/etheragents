// All runtime configuration, from the environment.
const env = process.env;
const num = (v: string | undefined, d: number) => (v === undefined || v === "" ? d : Number(v));

export type LlmProvider = "openrouter" | "mock";

const provider = (env.LLM_PROVIDER ||
  (env.OPENROUTER_API_KEY ? "openrouter" : "mock")) as LlmProvider;

export const config = {
  port: num(env.PORT, 8787),
  publicUrl: (env.API_PUBLIC_URL || `http://localhost:${num(env.PORT, 8787)}`).replace(/\/$/, ""),
  sim: env.SIM === "1" || env.SIM === "true",
  chainId: num(env.CHAIN_ID, env.SIM === "1" ? 31337 : 1),
  rpcUrls: (env.RPC_URL || "http://127.0.0.1:8545").split(",").map((s) => s.trim()).filter(Boolean),
  operatorKey: env.OPERATOR_PRIVATE_KEY as `0x${string}` | undefined,
  databaseUrl: env.DATABASE_URL,
  dataDir: env.DATA_DIR || ".data",

  llm: {
    provider,
    model:
      env.LLM_MODEL ||
      (provider === "openrouter" ? "deepseek/deepseek-v4.1-flash" : "mock-1"),
    openrouterKey: env.OPENROUTER_API_KEY,
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
    // every version of a coin's website costs this much, paid from the protocol's half of that coin's trading fees.
    // The first version is advanced at launch and repaid from the coin's first fees; rewrites need the budget.
    siteCostEth: num(env.SITE_COST_ETH, env.SIM === "1" ? 0.0002 : 0.0005),
  },

  house: {
    count: num(env.HOUSE_AGENTS, env.SIM === "1" ? 12 : 0),
    depositEth: num(env.HOUSE_DEPOSIT_ETH, 1),
  },

  indexerPollMs: num(env.INDEXER_POLL_MS, 6000),
  startBlock: env.START_BLOCK ? BigInt(env.START_BLOCK) : undefined,
};

export type Config = typeof config;
