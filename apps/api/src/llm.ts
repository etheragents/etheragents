// LLM client: OpenRouter (OpenAI-compatible, any model id; default deepseek/deepseek-v4.1-flash, like Auton).
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

export async function complete(system: string, user: string, maxTokens = 900): Promise<LlmResult> {
  return sem.run(async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), config.llm.timeoutMs);
    try {
      if (config.llm.provider === "openrouter") return await openrouter(system, user, maxTokens, ctrl.signal);
      throw new Error("mock provider has no completion endpoint");
    } finally {
      clearTimeout(timer);
    }
  });
}

async function openrouter(system: string, user: string, maxTokens: number, signal: AbortSignal): Promise<LlmResult> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    signal,
    headers: {
      authorization: `Bearer ${config.llm.openrouterKey}`,
      "content-type": "application/json",
      "x-title": "Etheragents",
      "http-referer": config.publicUrl,
    },
    body: JSON.stringify({
      model: config.llm.model,
      max_tokens: maxTokens,
      temperature: 0.9,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`openrouter ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = (await res.json()) as any;
  return {
    text: j.choices?.[0]?.message?.content ?? "",
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
