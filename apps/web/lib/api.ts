import { API_URL } from "./config";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function handle<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const msg =
      (body && typeof body === "object" && ("error" in body || "message" in body)
        ? String((body as Record<string, unknown>).error ?? (body as Record<string, unknown>).message)
        : typeof body === "string" && body
          ? body.slice(0, 200)
          : res.statusText) || `HTTP ${res.status}`;
    throw new ApiError(msg, res.status);
  }
  return body as T;
}

function withTimeout(ms: number): { signal: AbortSignal; done: () => void } {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  return { signal: ctl.signal, done: () => clearTimeout(t) };
}

export async function apiGet<T>(path: string, params?: Record<string, string | number | undefined | null>): Promise<T> {
  const qs = new URLSearchParams();
  if (params) for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  const url = API_URL + path + (qs.size ? `?${qs}` : "");
  const { signal, done } = withTimeout(20000);
  try {
    const res = await fetch(url, { signal, headers: { accept: "application/json" } });
    return await handle<T>(res);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(e instanceof Error && e.name === "AbortError" ? "The API took too long to answer" : "Can't reach the Etheragents API", 0);
  } finally {
    done();
  }
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const { signal, done } = withTimeout(60000);
  try {
    const res = await fetch(API_URL + path, {
      method: "POST",
      signal,
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });
    return await handle<T>(res);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError("Can't reach the Etheragents API", 0);
  } finally {
    done();
  }
}

export function errMsg(e: unknown): string {
  if (!e) return "";
  const any = e as { shortMessage?: string; details?: string; message?: string };
  return any.shortMessage || any.message || String(e);
}
