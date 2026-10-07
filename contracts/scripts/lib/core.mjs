// Shared deploy logic: used by scripts/deploy.mjs (local / sepolia / mainnet) and by the tests.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodeAbiParameters, encodeDeployData, getContractAddress, keccak256, concat, pad, toHex, parseEther } from "viem";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const artifact = (name) =>
  JSON.parse(fs.readFileSync(path.join(root, "out", name === "PoolManager" ? "v4/PoolManager.json" : name + ".json"), "utf8"));

export const SUPPLY = 1_000_000_000n * 10n ** 18n;

/// Canonical mainnet addresses (verified on Etherscan / erc-8004 docs).
export const MAINNET = {
  poolManager: "0x000000000004444c5dc75cB358380D2e3dE08A90",
  identityRegistry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
};
/// Sepolia: Uniswap v4 PoolManager + the same deterministic ERC-8004 registry address.
export const SEPOLIA = {
  poolManager: "0xE03A1074c86CFeDd5C142C4F04F1a1536e203543",
  identityRegistry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
};

/// Curve parameters from a start and a graduation market cap (ETH), Auton's shape:
/// constant product with virtual reserves, the pool opens at the curve's final spot price and holds
/// exactly the unsold supply.  r = sqrt(M1/M0); Vt = S·r²/(r²−1); Ve = M0·Vt/S; curveSupply = Vt·(1−1/r).
export function curveParams(startMcapEth = 0.0707, gradMcapEth = 3.8) {
  const r = Math.sqrt(gradMcapEth / startMcapEth);
  const S = 1e9;
  const vt = (S * r * r) / (r * r - 1);
  const ve = (startMcapEth * vt) / S;
  const cs = vt * (1 - 1 / r);
  const tok = (n) => BigInt(Math.floor(n * 1e6)) * 10n ** 12n; // token amounts, 18 decimals
  return {
    virtualEth: parseEther(ve.toFixed(18)),
    virtualToken: tok(vt),
    curveSupply: tok(cs),
    raiseEth: ve * (r - 1),
    startMcapEth,
    gradMcapEth,
  };
}

/// Mine a CREATE2 salt so the hook's address has exactly the beforeInitialize flag (bit 13) in its low 14 bits.
export function mineHookSalt(deployer, initCode) {
  const hash = keccak256(initCode);
  const want = 1n << 13n;
  const mask = (1n << 14n) - 1n;
  for (let i = 0n; ; i++) {
    const salt = pad(toHex(i), { size: 32 });
    const addr = BigInt("0x" + keccak256(concat(["0xff", deployer, salt, hash])).slice(-40));
    if ((addr & mask) === want) return { salt, address: "0x" + addr.toString(16).padStart(40, "0") };
  }
}

/**
 * Deploy the whole system.
 * @param {object} o
 * @param {import('viem').WalletClient} o.wallet  deployer wallet client (account set)
 * @param {import('viem').PublicClient} o.client
 * @param {string} o.admin       final owner of everything (Ownable2Step: must accept on non-local chains)
 * @param {string} o.treasury    receives protocol + creation fees
 * @param {string[]} o.operators brain keys allowed to drive vaults
 * @param {string} [o.poolManager]      existing v4 PoolManager (deploys one when omitted — local only)
 * @param {string} [o.identityRegistry] existing ERC-8004 registry (deploys the mock when omitted — local only)
 * @param {bigint} [o.agentFee]   AgentFactory creation fee
 * @param {bigint} [o.coinFee]    AgentLaunchpad creation fee
 * @param {object} [o.curve]      curveParams()
 * @param {(msg:string)=>void} [o.log]
 */
export async function deployAll(o) {
  const log = o.log || (() => {});
  const curve = o.curve || curveParams();
  const me = o.wallet.account.address;
  const send = async (label, p) => {
    const hash = await p;
    const r = await o.client.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(label + " reverted");
    return r;
  };
  const deploy = async (name, args = []) => {
    const a = artifact(name);
    const hash = await o.wallet.deployContract({ abi: a.abi, bytecode: a.bytecode, args });
    const r = await o.client.waitForTransactionReceipt({ hash });
    if (!r.contractAddress) throw new Error("deploy failed: " + name);
    log(`${name.padEnd(22)} ${r.contractAddress}`);
    return r.contractAddress;
  };
  const write = (address, name, functionName, args = [], value) =>
    send(`${name}.${functionName}`, o.wallet.writeContract({ address, abi: artifact(name).abi, functionName, args, value }));

  const out = { chainId: await o.client.getChainId(), curve: { ...curve, virtualEth: curve.virtualEth.toString(), virtualToken: curve.virtualToken.toString(), curveSupply: curve.curveSupply.toString() } };
  out.poolManager = o.poolManager || (await deploy("PoolManager", [me]));
  out.identityRegistry = o.identityRegistry ?? (await deploy("MockIdentityRegistry"));
  out.create2Deployer = await deploy("Create2Deployer");
  out.launchpad = await deploy("AgentLaunchpad", [me, out.poolManager, o.treasury, curve.virtualEth, curve.virtualToken, curve.curveSupply]);
  out.coinDeployer = await deploy("CoinDeployer", [out.launchpad]);
  await write(out.launchpad, "AgentLaunchpad", "setCoinDeployer", [out.coinDeployer]);

  const hookArt = artifact("GraduationGuardHook");
  const initCode = encodeDeployData({ abi: hookArt.abi, bytecode: hookArt.bytecode, args: [out.poolManager, out.launchpad] });
  const { salt, address: hookAddr } = mineHookSalt(out.create2Deployer, initCode);
  await write(out.create2Deployer, "Create2Deployer", "deploy", [salt, initCode]);
  out.graduationHook = hookAddr;
  log(`${"GraduationGuardHook".padEnd(22)} ${hookAddr}`);
  await write(out.launchpad, "AgentLaunchpad", "setGraduationHook", [hookAddr]);
  if (o.coinFee) await write(out.launchpad, "AgentLaunchpad", "setCreationFee", [o.coinFee]);

  out.factory = await deploy("AgentFactory", [me, out.launchpad, out.identityRegistry, o.treasury, o.agentFee ?? 0n]);
  for (const op of o.operators || []) await write(out.factory, "AgentFactory", "setOperator", [op, true]);
  out.vaultImplementation = await o.client.readContract({ address: out.factory, abi: artifact("AgentFactory").abi, functionName: "implementation" });

  if (o.admin && o.admin.toLowerCase() !== me.toLowerCase()) {
    await write(out.launchpad, "AgentLaunchpad", "transferOwnership", [o.admin]);
    await write(out.factory, "AgentFactory", "transferOwnership", [o.admin]);
    log(`ownership offered to ${o.admin} — it must call acceptOwnership() on the launchpad and the factory`);
  }
  out.admin = o.admin || me;
  out.deployer = me; // constructor owner (needed to verify on Etherscan)
  out.agentFee = (o.agentFee ?? 0n).toString();
  out.treasury = o.treasury;
  out.operators = o.operators || [];
  out.deployedAt = new Date().toISOString();
  out.startBlock = Number(await o.client.getBlockNumber());
  return out;
}

export { getContractAddress, encodeAbiParameters };
