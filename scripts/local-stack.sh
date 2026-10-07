#!/usr/bin/env bash
# Full local stack: Hardhat EVM → deploy contracts → API in chain mode (offline mock brain) → house agents → web.
# Ctrl-C stops everything.
set -euo pipefail
cd "$(dirname "$0")/.."
trap 'kill 0' EXIT
OPERATOR_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d   # hardhat account #1 (public dev key)
HOUSE_KEY=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a      # hardhat account #2 (public dev key)

npm run contracts:build >/dev/null
(cd contracts && npx hardhat node --hostname 127.0.0.1 --port 8545 >/tmp/etheragents-chain.log 2>&1) &
sleep 6
NETWORK=local node contracts/scripts/deploy.mjs
rm -rf apps/api/.data-local
(cd apps/api && CHAIN_ID=31337 RPC_URL=http://127.0.0.1:8545 OPERATOR_PRIVATE_KEY=$OPERATOR_KEY DATA_DIR=.data-local \
  LLM_PROVIDER=${LLM_PROVIDER:-mock} BRAIN_TICK_SECONDS=3 AGENT_INTERVAL_SECONDS=15 MIN_TRADE_ETH=0.001 GAS_RESERVE_ETH=0.002 \
  INDEXER_POLL_MS=1500 node src/main.ts) &
sleep 4
(cd apps/api && CHAIN_ID=31337 HOUSE_OWNER_KEY=$HOUSE_KEY HOUSE_AGENTS=8 HOUSE_DEPOSIT_ETH=0.5 HOUSE_MAX_TRADE_ETH=0.04 HOUSE_DAILY_ETH=1 node scripts/house.ts)
NEXT_PUBLIC_CHAIN_ID=31337 NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8545 npm run dev -w @etheragents/web
