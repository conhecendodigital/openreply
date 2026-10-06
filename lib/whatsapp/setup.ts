/**
 * Liga o WhatsApp no Lead Engine: registra o repositório do Postgres, a fila
 * BullMQ e as credenciais do gateway no runtime (lib/whatsapp/runtime.ts).
 *
 * Importado pela rota do webhook, pelas rotas do painel e pelo worker
 * (worker/wa-worker.ts). Sem WHATSAPP_ENABLED=1, getWhatsAppRuntime() continua
 * devolvendo null: o webhook responde 503 e o worker sai.
 *
 * Só o OpenWA está ligado de ponta a ponta nesta fase. O adaptador da Cloud API
 * existe (lib/whatsapp/cloud-api.ts), mas falta a tela de cadastro do número
 * oficial; até lá credentialsFor não devolve token da Meta.
 */
import { bullmqWaQueue } from "@/lib/whatsapp/queue";
import { PrismaWaRepository } from "@/lib/whatsapp/prisma-repository";
import { getWhatsAppRuntime, openwaCredentialsFromEnv, registerWhatsAppRuntime, type WhatsAppRuntime } from "@/lib/whatsapp/runtime";

let repo: PrismaWaRepository | null = null;

export function getWaRepository(): PrismaWaRepository {
  if (!repo) repo = new PrismaWaRepository();
  return repo;
}

let registered = false;

/** Registra uma vez por processo. Seguro chamar em toda requisição. */
export function ensureWhatsAppRuntime(): WhatsAppRuntime | null {
  if (!registered) {
    registerWhatsAppRuntime({
      repo: getWaRepository(),
      queue: bullmqWaQueue,
      async credentialsFor() {
        return { openwa: openwaCredentialsFromEnv() };
      },
    });
    registered = true;
  }
  return getWhatsAppRuntime();
}

/** Liga ou não (pra tela mostrar o aviso certo). Nunca devolve valor de variável. */
export function whatsappStatus(env: Record<string, string | undefined> = process.env) {
  return {
    enabled: env.WHATSAPP_ENABLED === "1",
    gatewayConfigured: Boolean(env.OPENWA_BASE_URL && env.OPENWA_API_KEY),
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
