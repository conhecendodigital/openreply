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
  addSend(job: WaSendJob): Promise<void>;
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
  async addSend(job) {
    await getWaSendQueue().add("send", job, { jobId: `was_${job.outboxId}` });
  },
};
