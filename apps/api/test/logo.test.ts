import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import sharp from "sharp";

test("logos: draws through the gateway's image endpoint and stores a 512px WebP", async () => {
  const png = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "#8EA0FF" } }).png().toBuffer();
  const seen: any[] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ url: req.url, body: JSON.parse(body) });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ b64_json: png.toString("base64"), media_type: "image/png" }] }));
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  process.env.LLM_PROVIDER = "orbio";
  process.env.ORBIO_API_KEY = "sk-orbio-test";
  process.env.LLM_BASE_URL = `http://127.0.0.1:${(server.address() as any).port}/api/v1`;
  const { drawLogo, logoPrompt, logosEnabled } = await import("../src/logo.ts");
  assert.equal(logosEnabled(), true);
  const prompt = logoPrompt("Velvet Finch", "VELVET", "a small velvet bird, purple and gold https://spam.example");
  assert.ok(!prompt.includes("http"));
  const { data, model } = await drawLogo(prompt);
  assert.equal(seen[0].url, "/api/v1/images");
  assert.equal(seen[0].body.model, model);
  const meta = await sharp(Buffer.from(data, "base64")).metadata();
  assert.equal(meta.format, "webp");
  assert.equal(meta.width, 512);
  server.close();
});
