/**
 * Conexões > uazapi: o que a tela lê e grava quando o número é da uazapi.
 * Só no servidor. Mesmas regras do painel (lib/whatsapp/painel.ts):
 * - desconectar NUNCA apaga nada (nem no Lead Engine, nem a instância na uazapi);
 * - o navegador nunca vê o admintoken nem o token da instância;
 * - sem cidade do proxy escolhida, não conecta (o motivo da troca pro uazapi
 *   foi justamente sair por um IP do Brasil).
 */
import { randomBytes } from "node:crypto";
import { getPrisma } from "@/lib/db/client";
import { withSystemRole, type RlsContext } from "@/lib/db/rls";
import { decryptToken, encryptToken } from "@/lib/meta/oauth";
import { WhatsAppConnectorError } from "@/lib/whatsapp/connector";
import {
  loadSession,
  PainelError,
  rls,
  saveStatus,
  SESSION_VIEW_SELECT,
  toSessionView,
  type PainelDeps,
  type SessionView,
} from "@/lib/whatsapp/painel";
import { uazapiWebhookUrl, webhookUrl } from "@/lib/whatsapp/setup";
import {
  listProxyCities,
  listProxyCountries,
  UazapiAdmin,
  UazapiConnector,
  uazapiFromEnv,
  type ProxyRegion,
  type RegionOption,
  type UazapiEnv,
} from "@/lib/whatsapp/uazapi";

/** Limite de números por workspace (igual ao OpenWA). */
const MAX_NUMBERS_PER_WORKSPACE = 5;

function env(deps: PainelDeps) {
  return deps.env ?? process.env;
}

function config(deps: PainelDeps): UazapiEnv {
  const cfg = uazapiFromEnv(env(deps));
  if (!cfg) {
    throw new PainelError("uazapi_off", "The uazapi is not configured on the server yet (UAZAPI_SERVER_URL and UAZAPI_ADMIN_TOKEN).", 503);
  }
  return cfg;
}

/** Erro da uazapi → mensagem simples pra tela (o texto em inglês é traduzido lá). */
export function uazapiMessage(error: unknown): PainelError {
  if (error instanceof PainelError) return error;
  if (error instanceof WhatsAppConnectorError) {
    if (error.status === 401) return new PainelError("uazapi_auth", "The uazapi refused the server key. Check UAZAPI_ADMIN_TOKEN.", 502);
    if (error.status === 429) return new PainelError("uazapi_busy", "The uazapi asked to wait a little. Try again in a minute.", 429);
  }
  return new PainelError("uazapi_error", "The uazapi did not answer. Try again in a minute.", 502);
}

// ─── Vagas e regiões ─────────────────────────────────────────────────────────

export type UazapiOverview = {
  configured: boolean;
  /** Dispositivos do plano (UAZAPI_MAX_INSTANCES, padrão 2). */
  max: number;
  used: number;
  remaining: number;
  /** "server" = contado na própria uazapi; "local" = números uazapi do Lead Engine (a uazapi não respondeu). */
  source: "server" | "local";
};

/**
 * Quantas vagas de dispositivo sobram. A uazapi não informa o tamanho do plano,
 * então o máximo vem de UAZAPI_MAX_INSTANCES; o usado vem da lista de
 * instâncias do servidor (cada instância ocupa uma vaga, mesmo desconectada).
 */
export async function uazapiOverview(deps: PainelDeps): Promise<UazapiOverview> {
  const cfg = uazapiFromEnv(env(deps));
  if (!cfg) return { configured: false, max: 0, used: 0, remaining: 0, source: "local" };
  let used: number;
  let source: UazapiOverview["source"] = "server";
  try {
    used = await new UazapiAdmin({ serverUrl: cfg.serverUrl, adminToken: cfg.adminToken }).countInstances();
  } catch {
    source = "local";
    used = await withSystemRole((tx) => tx.waSession.count({ where: { provider: "UAZAPI" } }), deps.system ?? getPrisma()).catch(() => 0);
  }
  return { configured: true, max: cfg.maxInstances, used, remaining: Math.max(0, cfg.maxInstances - used), source };
}

const COUNTRY = /^[a-z]{2}$/;
const CITY = /^[a-z0-9_-]{1,64}$/;

/** Países e cidades do proxy (listas da própria uazapi). Brasil é o padrão. */
export async function uazapiRegions(
  input: { country?: unknown; search?: unknown },
  deps: PainelDeps
): Promise<{ countries: RegionOption[]; country: string; cities: RegionOption[] }> {
  const cfg = config(deps);
  const country = typeof input.country === "string" && COUNTRY.test(input.country) ? input.country : "br";
  const search = typeof input.search === "string" ? input.search.trim().slice(0, 40) || null : null;
  try {
    const [countries, cities] = await Promise.all([listProxyCountries(cfg.serverUrl), listProxyCities(cfg.serverUrl, country, search)]);
    return { countries, country, cities };
  } catch (error) {
    throw regionError(error);
  }
}

function regionError(error: unknown): PainelError {
  if (error instanceof WhatsAppConnectorError && (error.status === 404 || error.status === 405)) {
    return new PainelError(
      "proxy_list_missing",
      "This uazapi server does not offer the list of cities (managed proxy). Without a city the number does not connect here. Ask the uazapi support to turn on the managed proxy.",
      502
    );
  }
  return new PainelError("proxy_list_off", "Could not load the list of cities from the uazapi. Try again in a minute.", 502);
}

const PROXY_REQUIRED =
  "Choose the country and the city of the connection first. Without that, the number would connect from the IP of a server abroad, and WhatsApp blocks numbers like that fast.";

/** Confere a cidade na lista da uazapi (o estado e o nome vêm de lá, não do navegador). */
async function resolveRegion(cfg: UazapiEnv, raw: unknown): Promise<ProxyRegion & { label: string }> {
  const p = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const country = typeof p.country === "string" ? p.country.trim().toLowerCase() : "";
  const city = typeof p.city === "string" ? p.city.trim() : "";
  if (!COUNTRY.test(country) || !CITY.test(city)) throw new PainelError("proxy_required", PROXY_REQUIRED, 400);
  let cities: RegionOption[];
  try {
    cities = await listProxyCities(cfg.serverUrl, country, null);
  } catch (error) {
    throw regionError(error);
  }
  const found = cities.find((c) => c.value === city);
  if (!found) throw new PainelError("proxy_invalid", "This city is not on the uazapi list. Choose a city from the list.", 400);
  return { country, state: found.state ?? null, city: found.value, label: found.label };
}

// ─── Conectar, status, reconectar, reiniciar, desconectar ────────────────────

type Method = { method: "qr" | "code"; phone: string | null };

function parseMethod(input: { method?: unknown; phone?: unknown }): Method {
  if (input.method !== "code") return { method: "qr", phone: null };
  const phone = typeof input.phone === "string" ? input.phone.replace(/\D/g, "") : "";
  if (!/^\d{10,15}$/.test(phone)) {
    throw new PainelError("phone_required", "To connect by code, type the number of this WhatsApp with country and area code (example: 55 11 91234-5678).", 400);
  }
  return { method: "code", phone };
}

export type UazapiConnectResult = {
  session: SessionView;
  qr: string | null;
  pairCode: string | null;
  /** true = a uazapi disse que a sessão está saindo sem proxy (direct). */
  proxyWarning: boolean;
};

async function proxyIsDirect(connector: UazapiConnector): Promise<boolean> {
  try {
    const p = await connector.getProxy();
    return p.effectiveMode === "direct";
  } catch {
    return false;
  }
}

/**
 * Conectar um número novo pela uazapi: termo de risco, cidade do proxy,
 * vaga livre no plano. Cria a instância já com a região, guarda o token e o
 * segredo do webhook só cifrados, registra o webhook e pede QR ou código.
 */
export async function createUazapiSession(
  ctx: RlsContext & { workspaceId: string },
  input: { acceptRisk: unknown; displayName?: unknown; method?: unknown; phone?: unknown; proxy?: unknown },
  deps: PainelDeps
): Promise<UazapiConnectResult> {
  if (input.acceptRisk !== true) {
    throw new PainelError("risk_not_accepted", "Read and accept the risk notice before connecting a number.", 400);
  }
  const e = env(deps);
  if (e.WHATSAPP_ENABLED !== "1") throw new PainelError("whatsapp_off", "WhatsApp is not turned on on the server yet.", 503);
  if (!webhookUrl(e)) throw new PainelError("no_webhook_url", "The server has no public https address for the webhook yet.", 503);
  const cfg = config(deps);
  const method = parseMethod(input);
  const region = await resolveRegion(cfg, input.proxy);

  const existing = await rls(ctx, deps, (tx) => tx.waSession.count({ where: { workspaceId: ctx.workspaceId } }));
  if (existing >= MAX_NUMBERS_PER_WORKSPACE) throw new PainelError("too_many", "This workspace already has 5 numbers.", 409);
  const slots = await uazapiOverview(deps);
  if (slots.remaining <= 0) {
    throw new PainelError(
      "no_slots",
      "Your uazapi plan has no free device. A disconnected number still uses its device: reconnect it instead of creating a new one.",
      409
    );
  }

  const displayName = typeof input.displayName === "string" ? input.displayName.trim().slice(0, 60) || null : null;
  const name = `le-${ctx.workspaceId.slice(-10)}-${randomBytes(4).toString("hex")}`;
  let created: { instanceId: string; token: string };
  try {
    created = await new UazapiAdmin({ serverUrl: cfg.serverUrl, adminToken: cfg.adminToken }).createInstance(name, region);
  } catch (error) {
    if (error instanceof WhatsAppConnectorError && error.status === 429) {
      throw new PainelError("no_slots", "The uazapi says your plan has no free device.", 409);
    }
    if (error instanceof WhatsAppConnectorError && error.status === 400) {
      throw new PainelError("proxy_rejected", "The uazapi refused this city. Choose another city from the list.", 400);
    }
    throw uazapiMessage(error);
  }

  // Segredo forte por número: vai na URL do webhook (a uazapi não assina o corpo). Só cifrado no banco.
  const secret = randomBytes(32).toString("base64url");
  const row = await rls(ctx, deps, (tx) =>
    tx.waSession.create({
      data: {
        workspaceId: ctx.workspaceId,
        ownerUserId: ctx.userId,
        provider: "UAZAPI",
        providerSessionId: created.instanceId,
        displayName,
        status: "PENDING",
        webhookSecretEnc: encryptToken(secret),
        instanceTokenEnc: encryptToken(created.token),
        riskAcceptedAt: new Date(),
        proxyCountry: region.country,
        proxyState: region.state,
        proxyCity: region.city,
        proxyCityLabel: region.label,
      },
      select: SESSION_VIEW_SELECT,
    })
  );
  const connector = new UazapiConnector({ serverUrl: cfg.serverUrl, instanceToken: created.token });
  try {
    const hook = uazapiWebhookUrl(row.id, secret, e);
    if (!hook) throw new PainelError("no_webhook_url", "The server has no public https address for the webhook yet.", 503);
    await connector.ensureWebhook(hook);
    const started = await connector.connect({ phone: method.phone, region });
    const session = await saveStatus(ctx, deps, row.id, started.status, null, null);
    return { session, qr: started.qr, pairCode: started.pairCode ?? null, proxyWarning: await proxyIsDirect(connector) };
  } catch (error) {
    // O número fica salvo (nada apagado); a tela oferece "Conectar de novo".
    throw uazapiMessage(error);
  }
}

type Secrets = { token: string; secret: string | null; region: (ProxyRegion & { label: string | null }) | null };

async function loadSecrets(ctx: RlsContext, deps: PainelDeps, sessionId: string): Promise<Secrets> {
  const row = await rls(ctx, deps, (tx) =>
    tx.waSession.findFirst({
      where: { id: sessionId, workspaceId: ctx.workspaceId ?? "", provider: "UAZAPI" },
      select: { instanceTokenEnc: true, webhookSecretEnc: true, proxyCountry: true, proxyState: true, proxyCity: true, proxyCityLabel: true },
    })
  );
  if (!row) throw new PainelError("not_found", "Number not found.", 404);
  if (!row.instanceTokenEnc) throw new PainelError("uazapi_token_missing", "This number has no uazapi token saved. Connect it again as a new number.", 409);
  let token: string;
  let secret: string | null = null;
  try {
    token = decryptToken(row.instanceTokenEnc);
    secret = row.webhookSecretEnc ? decryptToken(row.webhookSecretEnc) : null;
  } catch {
    throw new PainelError("uazapi_token_unreadable", "The saved uazapi token could not be opened (ENCRYPTION_KEY changed?).", 500);
  }
  return {
    token,
    secret,
    region: row.proxyCountry && row.proxyCity ? { country: row.proxyCountry, state: row.proxyState, city: row.proxyCity, label: row.proxyCityLabel } : null,
  };
}

/** Conector de um número da uazapi já salvo (token aberto só aqui). */
export async function uazapiConnectorFor(ctx: RlsContext, deps: PainelDeps, sessionId: string): Promise<UazapiConnector> {
  const cfg = config(deps);
  const s = await loadSecrets(ctx, deps, sessionId);
  return new UazapiConnector({ serverUrl: cfg.serverUrl, instanceToken: s.token });
}

/** QR, código e status direto da uazapi (a tela chama a cada poucos segundos até conectar). */
export async function refreshUazapi(ctx: RlsContext, sessionId: string, deps: PainelDeps): Promise<{ session: SessionView; qr: string | null; pairCode: string | null }> {
  const connector = await uazapiConnectorFor(ctx, deps, sessionId);
  try {
    const info = await connector.getInfo();
    const session = await saveStatus(ctx, deps, sessionId, info.status, info.phoneE164, info.pushName);
    return { session, qr: info.qr, pairCode: info.pairCode };
  } catch (error) {
    throw uazapiMessage(error);
  }
}

/** Reconectar (QR ou código de novo) na mesma instância, com a mesma cidade. Não mexe nas conversas. */
export async function reconnectUazapi(
  ctx: RlsContext,
  sessionId: string,
  input: { method?: unknown; phone?: unknown },
  deps: PainelDeps
): Promise<UazapiConnectResult> {
  const cfg = config(deps);
  const method = parseMethod(input);
  const s = await loadSecrets(ctx, deps, sessionId);
  if (!s.region) throw new PainelError("proxy_required", PROXY_REQUIRED, 400);
  const connector = new UazapiConnector({ serverUrl: cfg.serverUrl, instanceToken: s.token });
  try {
    const hook = s.secret ? uazapiWebhookUrl(sessionId, s.secret, env(deps)) : null;
    if (hook) await connector.ensureWebhook(hook);
    const started = await connector.connect({ phone: method.phone, region: s.region });
    const session = await saveStatus(ctx, deps, sessionId, started.status, null, null);
    return { session, qr: started.qr, pairCode: started.pairCode ?? null, proxyWarning: await proxyIsDirect(connector) };
  } catch (error) {
    throw uazapiMessage(error);
  }
}

/** Reiniciar a conexão (sessão travada) sem novo pareamento e sem apagar nada. */
export async function restartUazapi(ctx: RlsContext, sessionId: string, deps: PainelDeps): Promise<{ session: SessionView; resetting: boolean }> {
  const connector = await uazapiConnectorFor(ctx, deps, sessionId);
  try {
    const out = await connector.reset();
    const row = await loadSession(ctx, deps, sessionId);
    return { session: toSessionView(row), resetting: out.resetting };
  } catch (error) {
    throw uazapiMessage(error);
  }
}

/** Logout na uazapi. A instância continua lá (a vaga do plano também) e nada é apagado aqui. */
export async function disconnectUazapi(ctx: RlsContext, sessionId: string, deps: PainelDeps): Promise<boolean> {
  try {
    const connector = await uazapiConnectorFor(ctx, deps, sessionId);
    await connector.disconnect();
    return true;
  } catch {
    return false;
  }
}
