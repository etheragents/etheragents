// Hardhat is only used as a local EVM (in-process for tests, `npm run chain` for the local stack).
// Compilation is done by scripts/compile.mjs (solc 0.8.26), so no `solidity` section is needed.
module.exports = {
  networks: {
    hardhat: {
      chainId: 31337,
      hardfork: "cancun",
      mining: { auto: true, interval: 0 },
      accounts: { count: 20, accountsBalance: "100000000000000000000000" },
    },
  },
};
