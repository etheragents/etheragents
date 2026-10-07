// Bonding-curve math for the docs (mirrors contracts/scripts/lib/core.mjs and the launchpad).
export function curveModel(startMcapEth = 0.0707, gradMcapEth = 3.8, supply = 1e9) {
  const r = Math.sqrt(gradMcapEth / startMcapEth);
  const vt = (supply * r * r) / (r * r - 1);
  const ve = (startMcapEth * vt) / supply;
  const curveSupply = vt * (1 - 1 / r);
  const at = (sold: number) => {
    const price = (ve * vt) / (vt - sold) ** 2; // ETH per token
    return { sold, price, mcap: price * supply, raised: (ve * sold) / (vt - sold) };
  };
  return { r, vt, ve, curveSupply, raise: ve * (r - 1), supply, at };
}
