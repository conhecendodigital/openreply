/**
 * Servidor uazapi FALSO (HTTP de verdade em 127.0.0.1), com as rotas e os
 * formatos da documentação 2.4.x. Nada aqui chama a uazapi real.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export const FAKE_ADMIN_TOKEN = "admin-token-falso";

export type FakeInstance = {
  id: string;
  name: string;
  token: string;
  status: "disconnected" | "connecting" | "connected" | "hibernated";
  qrcode: string;
  paircode: string;
  region: Record<string, string>;
  webhook: Record<string, unknown> | null;
  phone: string | null;
  profileName: string | null;
  proxyEffective: "internal" | "direct";
};

export type FakeCall = { method: string; path: string; headers: Record<string, string>; body: unknown };

export const FAKE_CITIES = [
  { value: "campinas", label: "Campinas", state: "sp", state_label: "São Paulo", raw_city: "campinas" },
  { value: "saopaulo", label: "São Paulo", state: "sp", state_label: "São Paulo", raw_city: "sao_paulo" },
  { value: "riodejaneiro", label: "Rio de Janeiro", state: "rj", state_label: "Rio de Janeiro", raw_city: "rio_de_janeiro" },
];

export class FakeUazapi {
  server: Server | null = null;
  url = "";
  calls: FakeCall[] = [];
  instances: FakeInstance[] = [];
  /** Instâncias criadas fora do Lead Engine (pelo painel da uazapi). */
  extraInstances = 0;
  /** Simula servidor antigo sem proxy gerenciado. */
  noManagedProxy = false;
  /** Próximo envio dá tempo esgotado (sem resposta). */
  hangNextSend = false;
  /** QR devolvido pras instâncias novas (data URL). */
  qrcode = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  /** Responde 500 no próximo envio. */
  failNextSend = false;
  private seq = 0;

  async start(port = 0): Promise<string> {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve) => this.server!.listen(port, "127.0.0.1", resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this.url;
  }

  async stop(): Promise<void> {
    if (this.server) {
      this.server.closeAllConnections?.();
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    }
  }

  reset() {
    this.calls = [];
    this.instances = [];
    this.extraInstances = 0;
    this.noManagedProxy = false;
    this.hangNextSend = false;
    this.failNextSend = false;
  }

  byToken(token: string | undefined): FakeInstance | undefined {
    return this.instances.find((i) => i.token === token);
  }

  /** O celular leu o QR: a instância vira connected. */
  pair(id: string, phone = "5511912345678", profileName = "Loja Teste") {
    const inst = this.instances.find((i) => i.id === id);
    if (!inst) throw new Error("instância não existe");
    inst.status = "connected";
    inst.phone = phone;
    inst.profileName = profileName;
  }

  private send(res: ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  }

  private instanceView(i: FakeInstance) {
    return {
      id: i.id,
      name: i.name,
      status: i.status,
      qrcode: i.status === "connecting" && !i.paircode ? i.qrcode : "",
      paircode: i.status === "connecting" ? i.paircode : "",
      profileName: i.profileName ?? "",
      owner: i.phone ?? "",
    };
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    let body: Record<string, unknown> = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      return this.send(res, 400, { error: "invalid payload" });
    }
    const url = new URL(req.url ?? "/", "http://x");
    const path = url.pathname;
    const method = req.method ?? "GET";
    const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, String(v)]));
    this.calls.push({ method, path, headers, body });

    // Públicas
    if (method === "GET" && path === "/proxy-managed/countries") {
      if (this.noManagedProxy) return this.send(res, 404, { error: "not found" });
      return this.send(res, 200, { countries: [{ value: "br", label: "Brazil" }, { value: "pt", label: "Portugal" }] });
    }
    if (method === "GET" && path === "/proxy-managed/cities") {
      if (this.noManagedProxy) return this.send(res, 404, { error: "not found" });
      const country = url.searchParams.get("country") ?? "br";
      const search = (url.searchParams.get("search") ?? "").toLowerCase();
      const cities = country === "br" ? FAKE_CITIES.filter((c) => !search || c.value.includes(search)) : [{ value: "lisboa", label: "Lisboa" }];
      return this.send(res, 200, { country, cities });
    }

    // "CDN" das mídias (fileURL de /message/download)
    if (method === "GET" && path.startsWith("/files/")) {
      res.writeHead(200, { "content-type": "image/jpeg" });
      res.end(Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
      return;
    }

    // Administrativas
    if (path === "/instance/all" || path === "/instance/create") {
      if (headers.admintoken !== FAKE_ADMIN_TOKEN) return this.send(res, 401, { error: "Unauthorized" });
      if (method === "GET" && path === "/instance/all") {
        const extra = Array.from({ length: this.extraInstances }, (_, n) => ({ id: `x${n}`, name: `manual-${n}`, status: "disconnected" }));
        return this.send(res, 200, [...this.instances.map((i) => this.instanceView(i)), ...extra]);
      }
      if (method === "POST" && path === "/instance/create") {
        if (this.instances.length + this.extraInstances >= 2) return this.send(res, 429, { error: "instance limit reached" });
        if (body.proxy_managed_city && !FAKE_CITIES.some((c) => c.value === body.proxy_managed_city)) {
          return this.send(res, 400, { error: "invalid proxy region" });
        }
        this.seq += 1;
        const inst: FakeInstance = {
          id: `r${this.seq}abc`,
          name: String(body.name),
          token: `tok-${this.seq}-${"z".repeat(24)}`,
          status: "disconnected",
          qrcode: this.qrcode,
          paircode: "",
          region: {
            country: String(body.proxy_managed_country ?? ""),
            state: String(body.proxy_managed_state ?? ""),
            city: String(body.proxy_managed_city ?? ""),
          },
          webhook: null,
          phone: null,
          profileName: null,
          proxyEffective: "internal",
        };
        this.instances.push(inst);
        return this.send(res, 200, {
          response: "Instance created successfully",
          instance: this.instanceView(inst),
          name: inst.name,
          token: inst.token,
        });
      }
    }

    // Da instância (header token)
    const inst = this.byToken(headers.token);
    if (!inst) return this.send(res, 401, { error: "instance info not found" });
    if (method === "DELETE" && path === "/instance") {
      // Nunca deveria ser chamado pelo Lead Engine.
      this.instances = this.instances.filter((i) => i !== inst);
      return this.send(res, 200, { response: "Instance Deleted" });
    }
    if (method === "POST" && path === "/instance/connect") {
      inst.status = "connecting";
      inst.paircode = body.phone ? "ABCD-1234" : "";
      if (body.proxy_managed_city) {
        inst.region = { country: String(body.proxy_managed_country), state: String(body.proxy_managed_state ?? ""), city: String(body.proxy_managed_city) };
      }
      return this.send(res, 200, { connected: false, loggedIn: false, jid: null, instance: this.instanceView(inst), request_id: "req-1" });
    }
    if (method === "GET" && path === "/instance/status") {
      return this.send(res, 200, {
        instance: this.instanceView(inst),
        status: {
          connected: inst.status === "connected",
          loggedIn: inst.status === "connected",
          jid: inst.status === "connected" ? { user: inst.phone, agent: 0, device: 0, server: "s.whatsapp.net" } : null,
        },
      });
    }
    if (method === "GET" && path === "/instance/proxy") {
      return this.send(res, 200, { mode: "internal", effective_mode: inst.proxyEffective, fallback: { active: false, reason: "", since: 0 } });
    }
    if (method === "POST" && path === "/instance/disconnect") {
      inst.status = "disconnected";
      return this.send(res, 200, { instance: this.instanceView(inst), response: "Disconnected" });
    }
    if (method === "POST" && path === "/instance/reset") {
      return this.send(res, 200, { response: "Instance reset started", resetting: true, instanceId: inst.id, queuedRecoveryAttempted: true });
    }
    if (method === "POST" && path === "/webhook") {
      inst.webhook = body;
      return this.send(res, 200, [{ id: "wh-1", ...body }]);
    }
    if (method === "POST" && (path === "/send/text" || path === "/send/media")) {
      if (this.hangNextSend) {
        this.hangNextSend = false;
        return; // nunca responde
      }
      if (this.failNextSend) {
        this.failNextSend = false;
        return this.send(res, 500, { error: "server not available" });
      }
      this.seq += 1;
      const messageid = `3EB0${this.seq.toString().padStart(6, "0")}`;
      return this.send(res, 200, {
        id: `${inst.phone}:${messageid}`,
        messageid,
        chatid: `${body.number}@s.whatsapp.net`,
        fromMe: true,
        messageTimestamp: 1791300000000 + this.seq,
        status: "Sent",
        response: { status: "success", message: "Message sent successfully" },
      });
    }
    if (method === "POST" && path === "/message/presence") return this.send(res, 200, { response: "Chat presence sent successfully" });
    if (method === "POST" && path === "/message/markread") {
      return this.send(res, 200, { results: (body.id as string[]).map((id) => ({ message_id: id, status: "success" })) });
    }
    if (method === "POST" && path === "/chat/read") return this.send(res, 200, { response: "ok" });
    if (method === "POST" && path === "/message/download") {
      return this.send(res, 200, { fileURL: `${this.url}/files/${body.id}.jpg`, mimetype: "image/jpeg" });
    }
    return this.send(res, 404, { error: "not found" });
  }
}
