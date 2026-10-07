// Server-sent events hub: every state change is broadcast to all connected browsers.
import type { ServerResponse } from "node:http";
import type { StreamEvent } from "@etheragents/shared";

export class Hub {
  private clients = new Set<ServerResponse>();

  constructor() {
    setInterval(() => this.raw(`event: ping\ndata: {}\n\n`), 20_000).unref();
  }

  attach(res: ServerResponse) {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "access-control-allow-origin": "*",
      "x-accel-buffering": "no",
    });
    res.write(`retry: 3000\n\n`);
    this.clients.add(res);
    res.on("close", () => this.clients.delete(res));
  }

  emit<E extends StreamEvent>(type: E["type"], data: E["data"]) {
    this.raw(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  private raw(chunk: string) {
    for (const c of this.clients) {
      try {
        c.write(chunk);
      } catch {
        this.clients.delete(c);
      }
    }
  }

  get size() {
    return this.clients.size;
  }
}
