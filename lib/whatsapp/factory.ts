/**
 * Escolhe o adaptador pelo `provider` do número (WaSession.provider).
 * Trocar um número de conector = trocar `provider` + credenciais; a fila e o
 * webhook não mudam.
 */
import { CloudApiConnector } from "@/lib/whatsapp/cloud-api";
import type { FetchLike, WhatsAppConnector } from "@/lib/whatsapp/connector";
import { OpenWAConnector } from "@/lib/whatsapp/openwa";
import type { WaSessionRecord } from "@/lib/whatsapp/types";

/** Credenciais já decifradas pelo chamador. Nunca logar. */
export interface ConnectorCredentials {
  openwa?: { baseUrl: string; apiKey: string };
  cloudApi?: { accessToken: string; graphVersion?: string };
}

export interface ConnectorFactoryDeps {
  credentials: ConnectorCredentials;
  fetch?: FetchLike;
}

export type ConnectorFactory = (session: WaSessionRecord) => Promise<WhatsAppConnector> | WhatsAppConnector;

export function createConnector(
  session: Pick<WaSessionRecord, "provider" | "providerSessionId" | "riskAcceptedAt" | "wabaId">,
  deps: ConnectorFactoryDeps
): WhatsAppConnector {
  if (session.provider === "OPENWA") {
    const creds = deps.credentials.openwa;
    if (!creds) throw new Error("Credenciais do OpenWA ausentes");
    return new OpenWAConnector({
      baseUrl: creds.baseUrl,
      apiKey: creds.apiKey,
      sessionId: session.providerSessionId,
      riskAcceptedAt: session.riskAcceptedAt,
      fetch: deps.fetch,
    });
  }
  if (session.provider === "CLOUD_API") {
    const creds = deps.credentials.cloudApi;
    if (!creds) throw new Error("Credenciais da Cloud API ausentes");
    return new CloudApiConnector({
      accessToken: creds.accessToken,
      phoneNumberId: session.providerSessionId,
      wabaId: session.wabaId ?? null,
      graphVersion: creds.graphVersion,
      fetch: deps.fetch,
    });
  }
  throw new Error("Conector desconhecido");
}
