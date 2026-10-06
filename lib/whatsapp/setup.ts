/**
 * Liga o WhatsApp no Lead Engine: registra o repositório do Postgres, a fila
 * BullMQ e as credenciais do gateway no runtime (lib/whatsapp/runtime.ts).
 *
 * Importado pela rota do webhook, pelas rotas do painel e pelo worker
 * (worker/wa-worker.ts). Sem WHATSAPP_ENABLED=1, getWhatsAppRuntime() continua
 * devolvendo null: o webhook responde 503 e o worker sai.
 *
 * Credenciais (06/10/2026, Canais > Conexões e chaves): o que o dono salvou em
 * Canais pro workspace do número vale antes das variáveis UAZAPI_* e OPENWA_*
 * (lib/integrations/credentials.ts). WHATSAPP_ENABLED continua só no ambiente.
 *
 * OpenWA e uazapi estão ligados de ponta a ponta (cada número escolhe o seu). O adaptador da Cloud API
 * existe (lib/whatsapp/cloud-api.ts), mas falta a tela de cadastro do número
 * oficial; até lá credentialsFor não devolve token da Meta.
 */
import type { PrismaClient } from "@/app/generated/prisma/client";
import { envConfigured, resolveOpenwa, resolveUazapi } from "@/lib/integrations/credentials";
import { bullmqWaQueue } from "@/lib/whatsapp/queue";
import { PrismaWaRepository } from "@/lib/whatsapp/prisma-repository";
import { getWhatsAppRuntime, registerWhatsAppRuntime, type WhatsAppRuntime } from "@/lib/whatsapp/runtime";
import type { ConnectorCredentials } from "@/lib/whatsapp/factory";
import type { WaSessionRecord } from "@/lib/whatsapp/types";

let repo: PrismaWaRepository | null = null;

export function getWaRepository(): PrismaWaRepository {
  if (!repo) repo = new PrismaWaRepository();
  return repo;
}

let registered = false;

/** Registra uma vez por processo. Seguro chamar em toda requisição. */
export function ensureWhatsAppRuntime(env: Record<string, string | undefined> = process.env): WhatsAppRuntime | null {
  // Desligado: nem abre conexão com o banco.
  if (env.WHATSAPP_ENABLED !== "1") return null;
  if (!registered) {
    registerWhatsAppRuntime({
      repo: getWaRepository(),
      queue: bullmqWaQueue,
      credentialsFor: (session) => sessionCredentials(session),
    });
    registered = true;
  }
  return getWhatsAppRuntime(env);
}

/**
 * Credenciais do conector de UM número, pelo workspace dele: Canais > ambiente.
 * uazapi: endereço do servidor (do workspace ou UAZAPI_SERVER_URL) + token da
 * instância (decifrado pelo repositório). O admintoken nunca vai pro envio.
 */
export async function sessionCredentials(
  session: Pick<WaSessionRecord, "provider" | "workspaceId" | "instanceToken">,
  opts: { env?: Record<string, string | undefined>; system?: PrismaClient } = {}
): Promise<ConnectorCredentials> {
  if (session.provider === "UAZAPI") {
    const cfg = await resolveUazapi(session.workspaceId, opts);
    if (!cfg || !session.instanceToken) return { uazapi: undefined };
    return { uazapi: { serverUrl: cfg.serverUrl, instanceToken: session.instanceToken } };
  }
  if (session.provider === "OPENWA") {
    const cfg = await resolveOpenwa(session.workspaceId, opts);
    return { openwa: cfg ? { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey } : undefined };
  }
  return {};
}

/** Liga ou não, só pelo ambiente (pra tela mostrar o aviso certo). Nunca devolve valor de variável. */
export function whatsappStatus(env: Record<string, string | undefined> = process.env) {
  return {
    enabled: env.WHATSAPP_ENABLED === "1",
    gatewayConfigured: envConfigured("openwa", env),
    /** uazapi pronta (UAZAPI_SERVER_URL e UAZAPI_ADMIN_TOKEN). Sem isso, a opção aparece desabilitada. */
    uazapiConfigured: envConfigured("uazapi", env),
  };
}

/** Igual a whatsappStatus, contando também o que o workspace salvou em Canais. */
export async function whatsappStatusFor(
  workspaceId: string | null | undefined,
  opts: { env?: Record<string, string | undefined>; system?: PrismaClient } = {}
) {
  const env = opts.env ?? process.env;
  const base = whatsappStatus(env);
  if (!workspaceId) return base;
  const [openwa, uazapi] = await Promise.all([
    resolveOpenwa(workspaceId, { ...opts, env }).catch(() => null),
    resolveUazapi(workspaceId, { ...opts, env }).catch(() => null),
  ]);
  return { ...base, gatewayConfigured: Boolean(openwa), uazapiConfigured: Boolean(uazapi) };
}

/**
 * URL pública do nosso webhook, que o gateway chama. WHATSAPP_WEBHOOK_URL
 * manda; senão, a URL do app (BETTER_AUTH_URL ou NEXTAUTH_URL) + a rota.
 * null quando não dá pra montar uma URL https.
 */
export function webhookUrl(env: Record<string, string | undefined> = process.env): string | null {
  const explicit = env.WHATSAPP_WEBHOOK_URL?.trim();
  const base = (env.BETTER_AUTH_URL || env.NEXTAUTH_URL || "").trim().replace(/\/+$/, "");
  const url = explicit || (base ? `${base}/api/whatsapp/webhook` : "");
  return url.startsWith("https://") ? url : null;
}

/**
 * URL do webhook de UM número na uazapi: a base de webhookUrl() + /uazapi/<id>/<segredo>.
 * A uazapi não assina o corpo, então o segredo vai na URL (ver uazapi-webhook.ts).
 */
export function uazapiWebhookUrl(sessionId: string, secret: string, env: Record<string, string | undefined> = process.env): string | null {
  const base = webhookUrl(env);
  if (!base) return null;
  return `${base.replace(/\/+$/, "")}/uazapi/${encodeURIComponent(sessionId)}/${encodeURIComponent(secret)}`;
}
