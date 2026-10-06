/**
 * Fila "wa-cerebro": processa os PDFs fora da requisição de envio.
 * Cada job leva o dono (ownerUserId) e roda com a RLS dele.
 */
import { Queue, Worker, type Job } from "bullmq";
import { getRedisConnection, safeJobKey } from "@/lib/queue/client";
import { processKnowledgeDocument, RetryableIngestError, type IngestDeps, type IngestResult } from "@/lib/whatsapp/cerebro/ingest";
import type { CerebroIngestJob } from "@/lib/whatsapp/cerebro/types";

export const CEREBRO_QUEUE_NAME = "wa-cerebro";
export const CEREBRO_INGEST_JOB_NAME = "ingest-pdf";
const ATTEMPTS = 4;

let queue: Queue<CerebroIngestJob> | null = null;

export function getCerebroQueue(): Queue<CerebroIngestJob> {
  if (!queue) {
    queue = new Queue<CerebroIngestJob>(CEREBRO_QUEUE_NAME, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: ATTEMPTS,
        backoff: { type: "exponential", delay: 30_000 },
        removeOnComplete: { count: 500 },
        removeOnFail: { age: 24 * 60 * 60, count: 1000 },
      },
    });
  }
  return queue;
}

/** jobId fixo por documento: enviar de novo enquanto está na fila não duplica. */
export function ingestJobId(documentId: string): string {
  return `cerebro_${safeJobKey(documentId)}`;
}

export interface CerebroQueueLike {
  add(name: string, data: CerebroIngestJob, opts?: { jobId?: string }): Promise<unknown>;
}

export async function enqueueKnowledgeIngest(job: CerebroIngestJob, target: CerebroQueueLike = getCerebroQueue()) {
  await target.add(CEREBRO_INGEST_JOB_NAME, job, { jobId: ingestJobId(job.documentId) });
}

/** Lógica de um job, separada do BullMQ pra testar. */
export async function runIngestJob(
  data: CerebroIngestJob,
  attemptsMade: number,
  deps: IngestDeps,
  attempts = ATTEMPTS
): Promise<IngestResult> {
  try {
    return await processKnowledgeDocument(data, deps);
  } catch (error) {
    const last = attemptsMade + 1 >= attempts;
    // Erro passageiro ou do banco: a fila tenta de novo até a última vez.
    if (!last) throw error;
    const code = error instanceof RetryableIngestError ? error.code : "internal_error";
    await deps.store.markError(data.documentId, data.workspaceId, code);
    return { status: "error", errorCode: code };
  }
}

export function createCerebroWorker(depsForJob: (job: CerebroIngestJob) => IngestDeps | Promise<IngestDeps>, concurrency = 2) {
  return new Worker<CerebroIngestJob>(
    CEREBRO_QUEUE_NAME,
    async (job: Job<CerebroIngestJob>) => {
      const result = await runIngestJob(job.data, job.attemptsMade, await depsForJob(job.data), job.opts.attempts ?? ATTEMPTS);
      // Só códigos e números no log: nada do conteúdo do PDF.
      console.log(`[wa-cerebro] ${job.data.documentId} ${result.status}${"errorCode" in result ? ` ${result.errorCode}` : ""}`);
      return result;
    },
    { connection: getRedisConnection(), concurrency }
  );
}
