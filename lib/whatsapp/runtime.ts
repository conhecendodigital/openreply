/**
 * Ponto único de ligação do WhatsApp com o resto do Lead Engine.
 *
 * Hoje (antes da Fase 0) nada está registrado e o webhook responde 503. Quando
 * a Fase 0 entregar o schema "whatsapp" no Prisma, ela registra aqui um
 * WaRepository com prismaSystem (webhook/worker) e as credenciais decifradas.
 * Ver docs/whatsapp-conector.md.
 */
import type { ConnectorCredentials } from "@/lib/whatsapp/factory";
import type { WaQueuePort } from "@/lib/whatsapp/queue";
import type { WaRepository } from "@/lib/whatsapp/repository";
import type { WaSessionRecord } from "@/lib/whatsapp/types";

export interface WhatsAppRuntime {
  repo: WaRepository;
  queue: WaQueuePort;
  /** Credenciais do conector daquele número, já decifradas. Nunca logar. */
  credentialsFor(session: WaSessionRecord): Promise<ConnectorCredentials>;
}

let runtime: WhatsAppRuntime | null = null;

export function registerWhatsAppRuntime(next: WhatsAppRuntime | null): void {
  runtime = next;
}

/** null = WhatsApp desligado (sem repositório registrado ou WHATSAPP_ENABLED != "1"). */
export function getWhatsAppRuntime(env: Record<string, string | undefined> = process.env): WhatsAppRuntime | null {
  if (env.WHATSAPP_ENABLED !== "1") return null;
  return runtime;
}

/** Segredos do app Meta aceitos no X-Hub-Signature-256 (rotação: aceita os dois). */
export function metaAppSecretsFromEnv(env: Record<string, string | undefined> = process.env): Array<string | undefined> {
  return [env.WHATSAPP_APP_SECRET, env.FACEBOOK_APP_SECRET];
}

/** Credenciais do gateway OpenWA (só no servidor). */
export function openwaCredentialsFromEnv(env: Record<string, string | undefined> = process.env): ConnectorCredentials["openwa"] {
  if (!env.OPENWA_BASE_URL || !env.OPENWA_API_KEY) return undefined;
  return { baseUrl: env.OPENWA_BASE_URL, apiKey: env.OPENWA_API_KEY };
}

/**
 * Credenciais da uazapi pra UM número: endereço do servidor (UAZAPI_SERVER_URL)
 * e o token daquela instância (decifrado pelo repositório). O admintoken não
 * entra aqui: só o painel usa, pra criar instância.
 */
export function uazapiCredentialsFor(
  session: Pick<WaSessionRecord, "provider" | "instanceToken">,
  env: Record<string, string | undefined> = process.env
): ConnectorCredentials["uazapi"] {
  const serverUrl = env.UAZAPI_SERVER_URL?.trim().replace(/\/+$/, "");
  if (session.provider !== "UAZAPI" || !serverUrl || !session.instanceToken) return undefined;
  return { serverUrl, instanceToken: session.instanceToken };
}
