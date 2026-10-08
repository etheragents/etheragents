// Coin logos. When a coin launches, its agent describes a logo; the platform asks an image model (through the same
// OpenAI-compatible gateway as the brain, e.g. Orbio) to draw it, shrinks it to a 512 px WebP and serves it at
// /api/img/logo/<address>.webp. Without an image model the coin keeps its generated geometric image.
import sharp from "sharp";
import { config } from "./config.ts";

export interface LogoRec {
  id: string; // coin address, lower-case
  data: string; // base64 WebP
  prompt: string;
  model: string;
  at: number;
}

export const logosEnabled = () => config.llm.provider !== "mock" && config.llm.logos && !!config.llm.baseUrl;

export function logoPrompt(name: string, symbol: string, idea: string): string {
  const clean = idea.replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim().slice(0, 300);
  return `A bold, iconic logo for a memecoin called "${name}" ($${symbol}). ${clean ? clean + ". " : ""}Single clear subject, flat vector illustration with clean shapes and a strong silhouette, centered, filling most of the frame, on a solid plain background. Polished, modern, high contrast. No text, no letters, no numbers, no watermark.`;
}

async function post(path: string, body: unknown) {
  const res = await fetch(`${config.llm.baseUrl}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${config.llm.apiKey ?? ""}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`image ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as any;
}

async function fetchImage(prompt: string): Promise<Buffer> {
  const model = config.llm.imageModel;
  let j: any;
  try {
    j = await post("/images", { model, prompt, aspect_ratio: "1:1" });
  } catch (e) {
    // gateways that only speak the OpenAI shape
    if (!/image (404|405)/.test((e as Error).message)) throw e;
    j = await post("/images/generations", { model, prompt, size: "1024x1024", response_format: "b64_json", n: 1 });
  }
  const d = j?.data?.[0];
  if (d?.b64_json) return Buffer.from(d.b64_json, "base64");
  if (d?.url) {
    if (String(d.url).startsWith("data:")) return Buffer.from(String(d.url).split(",")[1], "base64");
    const r = await fetch(d.url, { signal: AbortSignal.timeout(60_000) });
    return Buffer.from(await r.arrayBuffer());
  }
  throw new Error("image model returned no image");
}

/** Draw a logo and return it as a square 512 px WebP (base64). */
export async function drawLogo(prompt: string): Promise<{ data: string; model: string }> {
  const raw = await fetchImage(prompt);
  const webp = await sharp(raw).resize(512, 512, { fit: "cover" }).webp({ quality: 86 }).toBuffer();
  return { data: webp.toString("base64"), model: config.llm.imageModel };
}
