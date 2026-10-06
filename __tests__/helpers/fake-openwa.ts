/**
 * Gateway OpenWA FALSO (HTTP de verdade em 127.0.0.1), só com as rotas que
 * Conexões usa pra status, logout e apagar a sessão. Nada aqui chama um
 * gateway real.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export const FAKE_OPENWA_KEY = "openwa-key-falsa";

export type FakeOpenWACall = { method: string; path: string; apiKey: string | undefined };

export class FakeOpenWA {
  server: Server | null = null;
  url = "";
  calls: FakeOpenWACall[] = [];
  /** Sessões que existem no gateway (id -> status). */
  sessions = new Map<string, string>();
  /** Simula o gateway fora do ar (500 em tudo). */
  down = false;

  async start(): Promise<string> {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this.url;
  }

  async stop(): Promise<void> {
    if (this.server) {
      this.server.closeAllConnections?.();
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    }
  }

  private send(res: ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    for await (const chunk of req) void chunk;
    const path = new URL(req.url ?? "/", "http://x").pathname;
    const method = req.method ?? "GET";
    const apiKey = req.headers["x-api-key"] as string | undefined;
    this.calls.push({ method, path, apiKey });
    if (this.down) return this.send(res, 500, { error: "gateway down" });
    if (apiKey !== FAKE_OPENWA_KEY) return this.send(res, 401, { error: "Unauthorized" });
    const m = /^\/api\/sessions\/([^/]+)(\/logout)?$/.exec(path);
    if (!m) return this.send(res, 404, { error: "not found" });
    const id = decodeURIComponent(m[1]);
    if (!this.sessions.has(id)) return this.send(res, 404, { error: "session not found" });
    if (method === "POST" && m[2]) {
      this.sessions.set(id, "disconnected");
      return this.send(res, 200, { success: true });
    }
    if (method === "DELETE" && !m[2]) {
      this.sessions.delete(id);
      return this.send(res, 200, { success: true });
    }
    if (method === "GET" && !m[2]) return this.send(res, 200, { id, status: this.sessions.get(id) });
    return this.send(res, 404, { error: "not found" });
  }
}
