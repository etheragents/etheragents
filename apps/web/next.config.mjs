import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
// Import the WalletConnect connector file directly: the @wagmi/connectors barrel pulls in every wallet SDK
// (Coinbase CDP, Base account, x402, …) and their missing optional peers break the build.
const connectorsDir = path.dirname(require.resolve("@wagmi/connectors/package.json"));
const wcConnector = path.join(connectorsDir, "dist/esm/walletConnect.js");

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  devIndicators: false,
  transpilePackages: ["@etheragents/shared"],
  images: { unoptimized: true },
  outputFileTracingRoot: new URL("../../", import.meta.url).pathname,
  // fonts read by the generated share images (opengraph-image routes)
  outputFileTracingIncludes: { "/**": ["./assets/og/**"] },
  webpack(config) {
    config.resolve.alias = { ...(config.resolve.alias || {}), "etheragents-wc-connector$": wcConnector };
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias || {}),
      ".js": [".ts", ".tsx", ".js"],
    };
    // Optional peer deps of wallet SDKs we never use in the browser bundle.
    config.externals = [...(config.externals || []), "pino-pretty", "lokijs", "encoding"];
    config.resolve.fallback = { ...(config.resolve.fallback || {}), "@react-native-async-storage/async-storage": false };
    return config;
  },
};
export default nextConfig;
