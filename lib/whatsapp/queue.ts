/**
 * Filas do WhatsApp (BullMQ, mesmo Redis do Lead Engine).
 *   wa-ingest: evento normalizado do webhook → grava contato/conversa/mensagem.
 *   wa-send:   envio com regra das 24h e ritmo humano (lib/whatsapp/outbound.ts).
 * As funções de negócio recebem um WaQueuePort, então os testes usam uma fila falsa.
 */
import { Queue } from "bullmq";
import { getRedisConnection, safeJobKey } from "@/lib/queue/client";
import type { BubblePlan } from "@/lib/whatsapp/pacing";
import type { NormalizedEvent, OutboundRequest } from "@/lib/whatsapp/types";

export const WA_INGEST_QUEUE = "wa-ingest";
export const WA_SEND_QUEUE = "wa-send";

export interface WaIngestJob {
  dedupeKey: string;
  sessionId: string;
  ownerUserId: string;
  event: NormalizedEvent;
}

export interface WaSendJob {
  outboxId: string;
  request: OutboundRequest;
  /** Bolhas já planejadas (texto e tempos). Mídia e template viram 1 item. */
  plan: BubblePlan[];
  /** Próxima bolha a mandar. Atualizado a cada envio, então retentativa não repete bolha. */
  nextIndex: number;
}

export interface WaQueuePort {
  addIngest(job: WaIngestJob): Promise<void>;
  /** delayMs: espera antes do 1º "digitando..." (atraso humano do agente fica na fila, não no worker). */
  addSend(job: WaSendJob, options?: { delayMs?: number }): Promise<void>;
}

/** jobId determinístico: o BullMQ ignora o mesmo id enquanto o job existir. */
export function ingestJobId(dedupeKey: string): string {
  return `wai_${safeJobKey(dedupeKey)}`;
}

let ingestQueue: Queue<WaIngestJob> | null = null;
let sendQueue: Queue<WaSendJob> | null = null;

export function getWaIngestQueue(): Queue<WaIngestJob> {
  if (!ingestQueue) {
    ingestQueue = new Queue<WaIngestJob>(WA_INGEST_QUEUE, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 2_000 },
        removeOnComplete: { count: 2000 },
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    });
  }
  return ingestQueue;
}

export function getWaSendQueue(): Queue<WaSendJob> {
  if (!sendQueue) {
    sendQueue = new Queue<WaSendJob>(WA_SEND_QUEUE, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: { count: 2000 },
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    });
  }
  return sendQueue;
}

export const bullmqWaQueue: WaQueuePort = {
  async addIngest(job) {
    await getWaIngestQueue().add("ingest", job, { jobId: ingestJobId(job.dedupeKey) });
  },
  async addSend(job, options) {
    await getWaSendQueue().add("send", job, {
      jobId: sendJobId(job.outboxId),
      ...(options?.delayMs && options.delayMs > 0 ? { delay: Math.round(options.delayMs) } : {}),
    });
  },
};

export function sendJobId(outboxId: string): string {
  return `was_${safeJobKey(outboxId)}`;
}

/**
 * Tira da fila um envio que ainda não começou (atrasado ou esperando).
 * Envio que já está saindo não para aqui: ele confere podeEnviar antes de
 * cada bolha. Devolve true se tirou.
 */
export async function removePendingSend(outboxId: string): Promise<boolean> {
  const job = await getWaSendQueue().getJob(sendJobId(outboxId));
  if (!job) return false;
  const state = await job.getState();
  if (state !== "delayed" && state !== "waiting" && state !== "prioritized") return false;
  try {
    await job.remove();
    return true;
  } catch {
    return false;
  }
}

// ─── Fila dos agentes (wa-agent) ─────────────────────────────────────────────

export const WA_AGENT_QUEUE = "wa-agent";

export interface WaAgentJob {
  /** inbound = mensagem nova do contato; owner = o dono respondeu pelo celular (confere ~30 s depois). */
  kind: "inbound" | "owner";
  ownerUserId: string;
  workspaceId: string;
  sessionId: string;
  conversationId: string;
  messageId: string;
}

/** Espera pra juntar mensagens seguidas do contato antes de rodar o agente. */
export const AGENT_INBOUND_DELAY_MS = 4_000;
/** Espera pro eco do próprio envio virar AGENT/USER_APP antes de decidir que foi o dono. */
export const AGENT_OWNER_DELAY_MS = 30_000;

let agentQueue: Queue<WaAgentJob> | null = null;

export function getWaAgentQueue(): Queue<WaAgentJob> {
  if (!agentQueue) {
    agentQueue = new Queue<WaAgentJob>(WA_AGENT_QUEUE, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: "exponential", delay: 10_000 },
        removeOnComplete: { count: 2000 },
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    });
  }
  return agentQueue;
}

export async function enqueueAgentJob(job: WaAgentJob): Promise<void> {
  const delay = job.kind === "owner" ? AGENT_OWNER_DELAY_MS : AGENT_INBOUND_DELAY_MS;
  await getWaAgentQueue().add(job.kind, job, { jobId: `waa_${job.kind}_${safeJobKey(job.messageId)}`, delay });
}
