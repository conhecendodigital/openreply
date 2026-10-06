/**
 * Liga o WhatsApp no Lead Engine: registra o repositório do Postgres, a fila
 * BullMQ e as credenciais do gateway no runtime (lib/whatsapp/runtime.ts).
 *
 * Importado pela rota do webhook, pelas rotas do painel e pelo worker
 * (worker/wa-worker.ts). Sem WHATSAPP_ENABLED=1, getWhatsAppRuntime() continua
 * devolvendo null: o webhook responde 503 e o worker sai.
 *
 * OpenWA e uazapi estão ligados de ponta a ponta (cada número escolhe o seu). O adaptador da Cloud API
 * existe (lib/whatsapp/cloud-api.ts), mas falta a tela de cadastro do número
 * oficial; até lá credentialsFor não devolve token da Meta.
 */
import { bullmqWaQueue } from "@/lib/whatsapp/queue";
import { PrismaWaRepository } from "@/lib/whatsapp/prisma-repository";
import {
  getWhatsAppRuntime,
  openwaCredentialsFromEnv,
  registerWhatsAppRuntime,
  uazapiCredentialsFor,
  type WhatsAppRuntime,
} from "@/lib/whatsapp/runtime";
import { uazapiFromEnv } from "@/lib/whatsapp/uazapi";

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
      async credentialsFor(session) {
        if (session.provider === "UAZAPI") return { uazapi: uazapiCredentialsFor(session) };
        return { openwa: openwaCredentialsFromEnv() };
      },
    });
    registered = true;
  }
  return getWhatsAppRuntime(env);
}

/** Liga ou não (pra tela mostrar o aviso certo). Nunca devolve valor de variável. */
export function whatsappStatus(env: Record<string, string | undefined> = process.env) {
  return {
    enabled: env.WHATSAPP_ENABLED === "1",
    gatewayConfigured: Boolean(env.OPENWA_BASE_URL && env.OPENWA_API_KEY),
    /** uazapi pronta (UAZAPI_SERVER_URL e UAZAPI_ADMIN_TOKEN). Sem isso, a opção aparece desabilitada. */
    uazapiConfigured: Boolean(uazapiFromEnv(env)),
  };
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
