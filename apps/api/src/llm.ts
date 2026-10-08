// LLM client for any OpenAI-compatible chat-completions gateway (Orbio, OpenRouter, or a custom base URL).
import { config } from "./config.ts";

class Semaphore {
  private n = 0;
  private waiters: (() => void)[] = [];
  private max: number;
  constructor(max: number) {
    this.max = max;
  }
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.n >= this.max) await new Promise<void>((r) => this.waiters.push(r));
    this.n++;
    try {
      return await fn();
    } finally {
      this.n--;
      this.waiters.shift()?.();
    }
  }
}

const sem = new Semaphore(config.llm.concurrency);

export interface LlmResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

// Model failover: when the gateway says a model is unavailable, move to the next one in the list and keep using it;
// every 10 minutes try the main model again.
const models = () => [config.llm.model, ...config.llm.fallbackModels.filter((m) => m !== config.llm.model)];
let active = 0;
let switchedAt = 0;
export const currentModel = () => models()[active] ?? config.llm.model;
const unavailable = (msg: string) => /aborted|timed? ?out|reply \(empty, finish_reason|reasoning|max_tokens| 429:|rate.?limit|overloaded| 503:| 502:|model_not_available|No provider|not.*(found|available|supported).*model|model.*(not|isn't).*(found|available|exist)|invalid model|unknown model/i.test(msg);

export async function complete(system: string, user: string, maxTokens = 900): Promise<LlmResult> {
  if (config.llm.provider === "mock") throw new Error("mock provider has no completion endpoint");
  if (active > 0 && Date.now() - switchedAt > 600_000) active = 0; // give the main model another chance
  const list = models();
  for (let tries = 0; ; tries++) {
    try {
      return await completeWith(list[active] ?? list[0], system, user, maxTokens);
    } catch (e) {
      const msg = (e as Error).message;
      if (!unavailable(msg) || tries >= list.length - 1) throw e;
      active = (active + 1) % list.length;
      switchedAt = Date.now();
      console.warn(`[llm] model unavailable, switching to ${list[active]}: ${msg.slice(0, 120)}`);
    }
  }
}

async function completeWith(model: string, system: string, user: string, maxTokens: number): Promise<LlmResult> {
  return sem.run(async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), config.llm.timeoutMs);
    try {
      return await chat(model, system, user, maxTokens, ctrl.signal, config.llm.jsonMode && !jsonModeRejected);
    } catch (e) {
      // some gateways/models reject response_format: remember that and retry once without it
      if (!jsonModeRejected && config.llm.jsonMode && /response_format|json_object|json mode/i.test((e as Error).message)) {
        jsonModeRejected = true;
        return await chat(model, system, user, maxTokens, ctrl.signal, false);
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  });
}

let jsonModeRejected = false;

async function chat(model: string, system: string, user: string, maxTokens: number, signal: AbortSignal, json: boolean): Promise<LlmResult> {
  const res = await fetch(`${config.llm.baseUrl}/chat/completions`, {
    method: "POST",
    signal,
    headers: {
      authorization: `Bearer ${config.llm.apiKey ?? ""}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature: 0.9,
      ...(json ? { response_format: { type: "json_object" } } : {}),
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`${config.llm.provider} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = (await res.json()) as any;
  const text = j.choices?.[0]?.message?.content ?? "";
  if (!String(text).trim()) throw new Error(`no JSON object in reply (empty, finish_reason ${j.choices?.[0]?.finish_reason ?? "unknown"})`);
  return {
    text,
    inputTokens: j.usage?.prompt_tokens ?? 0,
    outputTokens: j.usage?.completion_tokens ?? 0,
  };
}

/** Pull the first JSON object out of a model reply (tolerates code fences and chatter). */
export function parseJsonObject(text: string): any {
  const t = text.replace(/```(?:json)?/g, "").trim();
  const start = t.indexOf("{");
  if (start < 0) throw new Error("no JSON object in reply");
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return JSON.parse(t.slice(start, i + 1));
  }
  throw new Error("unterminated JSON object in reply");
}
