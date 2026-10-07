export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8787").replace(/\/+$/, "");
export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID || 31337);
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "";
export const WC_PROJECT_ID = process.env.NEXT_PUBLIC_WC_PROJECT_ID || "";

/** Turn an API-relative path (or full URL) into an absolute URL. */
export function apiUrl(path: string): string {
  if (!path) return "";
  if (/^(https?:|data:)/.test(path)) return path;
  return API_URL + (path.startsWith("/") ? path : "/" + path);
}

export const agentImg = (seed: string) => apiUrl(`/api/img/agent/${encodeURIComponent(seed)}.svg`);
export const coinImg = (image: string | null | undefined, address?: string | null) =>
  image ? apiUrl(image) : address ? apiUrl(`/api/img/coin/${address}.svg`) : "";
