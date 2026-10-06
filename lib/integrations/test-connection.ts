/**
 * Botão "Testar conexão" de Canais > Conexões e chaves. Só leitura:
 *   uazapi: GET /status e GET /instance/all (com o admintoken);
 *   OpenWA: GET /api/health (com a chave operator).
 * Usa o que vale pro workspace (salvo em Canais > ambiente). Responde só
 * ok ou um código de erro; nunca o valor, nunca o corpo da resposta.
 * Endereço salvo pelo workspace passa de novo pela checagem de SSRF (DNS
 * incluso) antes de cada teste; redirecionamento não é seguido.
 */
import type { FetchLike } from "@/lib/whatsapp/connector";
import type { ResolveOptions } from "@/lib/integrations/credentials";
import { resolveOpenwa, resolveUazapi, type CredentialSource, type IntegrationService } from "@/lib/integrations/credentials";
import { checkPublicUrlWithDns, type LookupAll } from "@/lib/integrations/url-guard";

export const INTEGRATION_TEST_LIMIT = { limit: 10, windowSeconds: 10 * 60 };
const TIMEOUT_MS = 8_000;

export type TestCode = "ok" | "not_configured" | "unauthorized" | "unreachable" | "timeout" | "bad_response" | "url_blocked";

export type ConnectionTestResult = {
  ok: boolean;
  code: TestCode;
  source: CredentialSource | null;
  /** uazapi: quantas instâncias o servidor tem (ocupam dispositivos do plano). */
  instances?: number;
  checkedAt: string;
};

type Deps = ResolveOptions & { fetch?: FetchLike; lookup?: LookupAll; now?: () => number };

async function get(fetchImpl: FetchLike, url: string, headers: Record<string, string>): Promise<{ status: number; body: unknown } | TestCode> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { method: "GET", headers: { Accept: "application/json", ...headers }, redirect: "manual", signal: controller.signal });
    const text = await res.text().catch(() => "");
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    return { status: res.status, body };
  } catch (error) {
    return error instanceof Error && error.name === "AbortError" ? "timeout" : "unreachable";
  } finally {
    clearTimeout(timer);
  }
}

function statusCode(status: number): TestCode {
  if (status === 401 || status === 403) return "unauthorized";
  if (status >= 200 && status < 300) return "ok";
  return "bad_response";
}

function countInstances(body: unknown): number | null {
  if (Array.isArray(body)) return body.length;
  if (body && typeof body === "object") {
    const o = body as Record<string, unknown>;
    const list = Array.isArray(o.instances) ? o.instances : Array.isArray(o.data) ? o.data : null;
    if (list) return list.length;
  }
  return null;
}

export async function testIntegration(service: IntegrationService, workspaceId: string, deps: Deps = {}): Promise<ConnectionTestResult> {
  const fetchImpl: FetchLike = deps.fetch ?? ((input, init) => fetch(input, init));
  const checkedAt = new Date((deps.now ?? Date.now)()).toISOString();
  const done = (code: TestCode, source: CredentialSource | null, extra: Partial<ConnectionTestResult> = {}): ConnectionTestResult => ({
    ok: code === "ok",
    code,
    source,
    checkedAt,
    ...extra,
  });

  if (service === "uazapi") {
    const cfg = await resolveUazapi(workspaceId, deps);
    if (!cfg) return done("not_configured", null);
    if (cfg.source === "workspace") {
      const check = await checkPublicUrlWithDns(cfg.serverUrl, deps.lookup);
      if (!check.ok) return done("url_blocked", cfg.source);
    }
    const status = await get(fetchImpl, `${cfg.serverUrl}/status`, {});
    if (typeof status === "string") return done(status, cfg.source);
    if (status.status >= 300 && status.status < 400) return done("bad_response", cfg.source);
    const all = await get(fetchImpl, `${cfg.serverUrl}/instance/all`, { admintoken: cfg.adminToken });
    if (typeof all === "string") return done(all, cfg.source);
    const code = statusCode(all.status);
    if (code !== "ok") return done(code, cfg.source);
    const instances = countInstances(all.body);
    return instances === null ? done("bad_response", cfg.source) : done("ok", cfg.source, { instances });
  }

  const cfg = await resolveOpenwa(workspaceId, deps);
  if (!cfg) return done("not_configured", null);
  const base = cfg.baseUrl.replace(/\/+$/, "");
  if (cfg.source === "workspace") {
    const check = await checkPublicUrlWithDns(base, deps.lookup);
    if (!check.ok) return done("url_blocked", cfg.source);
  }
  const health = await get(fetchImpl, `${base}/api/health`, { "X-API-Key": cfg.apiKey });
  if (typeof health === "string") return done(health, cfg.source);
  return done(statusCode(health.status), cfg.source);
}
