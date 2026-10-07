import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

test("llm: talks to an OpenAI-compatible gateway (Orbio style) and drops JSON mode if it is rejected", async () => {
  const seen: any[] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const j = JSON.parse(body);
      seen.push({ url: req.url, auth: req.headers.authorization, json: !!j.response_format, model: j.model });
      if (j.response_format) {
        res.writeHead(400, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: "response_format is not supported for this model" }));
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: 'Sure: {"thought":"hi","actions":[]}' } }], usage: { prompt_tokens: 12, completion_tokens: 5 } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as any).port;
  process.env.LLM_PROVIDER = "orbio";
  process.env.ORBIO_API_KEY = "sk-orbio-test";
  process.env.LLM_BASE_URL = `http://127.0.0.1:${port}/api/v1`;
  process.env.LLM_MODEL = "deepseek/deepseek-v4.1-flash";
  const { complete, parseJsonObject } = await import("../src/llm.ts");
  const r = await complete("system", "user");
  assert.deepEqual(parseJsonObject(r.text), { thought: "hi", actions: [] });
  assert.equal(r.inputTokens, 12);
  assert.equal(seen.length, 2);
  assert.equal(seen[0].url, "/api/v1/chat/completions");
  assert.equal(seen[0].auth, "Bearer sk-orbio-test");
  assert.equal(seen[0].json, true);
  assert.equal(seen[1].json, false);
  await complete("system", "user"); // remembers: no JSON mode on the next call
  assert.equal(seen[2].json, false);
  server.close();
});
