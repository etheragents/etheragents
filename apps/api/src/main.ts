// Etheragents API: store + ledger + market (sim or chain) + brain + HTTP/SSE.
import { config } from "./config.ts";
import { Store } from "./store.ts";
import { Hub } from "./hub.ts";
import { Ledger } from "./ledger.ts";
import { SimMarket } from "./sim.ts";
import { ChainMarket } from "./chain.ts";
import { Brain } from "./brain.ts";
import { startInfluence } from "./influence.ts";
import { startKeeper } from "./keeper.ts";
import { startVerifier } from "./verify.ts";
import { createServer, createAgentRec } from "./app.ts";
import { HOUSE } from "./house.ts";
import { toWei } from "./util.ts";
import type { Market } from "./market.ts";

const store = new Store();
await store.open(config.databaseUrl, config.dataDir);
const hub = new Hub();
const ledger = new Ledger(store, hub, config.chainId);
const market: Market = config.sim ? new SimMarket(ledger, config.chainId) : new ChainMarket(ledger, config.chainId);
await market.start();

// simulation: seed the house agents on first boot
if (market instanceof SimMarket && store.agents.size === 0 && config.house.count > 0) {
  for (const [i, h] of HOUSE.slice(0, config.house.count).entries()) {
    const a = createAgentRec({
      id: i + 1,
      handle: h.handle,
      name: h.name,
      persona: h.persona,
      avatar: h.avatar,
      self: h.self,
      owner: "0x0000000000000000000000000000000000E7e4",
      vault: market.address("vault"),
      balanceWei: toWei(config.house.depositEth * (0.6 + Math.random() * 0.9)).toString(),
      house: true,
    });
    a.nextActAt = Math.floor(Date.now() / 1000) + 2 + i * 2;
    a.maxTradeEth = 0.06; // limits a careful owner might set on-chain
    a.dailyLimitEth = 0; // the simulation runs fast; a daily cap would freeze it for the rest of the day
    store.agents.set(a);
  }
  store.meta.nextAgentId = config.house.count + 1;
  store.bumpMeta();
  console.log(`[sim] seeded ${config.house.count} house agents`);
}
// simulation: keep house agents trading (older saved state had a 1.5 ETH daily cap that freezes them for the day)
if (market instanceof SimMarket) {
  for (const a of store.agents.values()) {
    if (a.house && a.dailyLimitEth > 0) {
      a.dailyLimitEth = 0;
      store.agents.touch(a);
    }
  }
}

const brain = new Brain(ledger, market);
brain.start();
if (market instanceof ChainMarket) {
  startKeeper(market, ledger);
  startVerifier(market, ledger);
}
startInfluence(ledger);

const server = createServer({ ledger, hub, market, brain });
server.listen(config.port, () => {
  console.log(`[api] Etheragents ${market.mode} mode, chain ${market.chainId}, listening on :${config.port}`);
});

const flush = setInterval(() => store.flush(), 5000);
const shutdown = async () => {
  clearInterval(flush);
  server.close();
  await store.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
