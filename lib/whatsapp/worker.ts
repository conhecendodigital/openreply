/**
 * Workers BullMQ do WhatsApp: wa-ingest e wa-send. Processo separado do site,
 * igual ao dm-worker (worker/wa-worker.ts chama createWaWorkers).
 */
import { DelayedError, Worker, type Job } from "bullmq";
import { getRedisConnection } from "@/lib/queue/client";
import { createConnector } from "@/lib/whatsapp/factory";
import { processIngestJob, type IngestDeps } from "@/lib/whatsapp/ingest";
import { processSendJob } from "@/lib/whatsapp/outbound";
import { RedisSendRateLimiter, type SendRateLimiter } from "@/lib/whatsapp/pacing";
import { WA_INGEST_QUEUE, WA_SEND_QUEUE, type WaIngestJob, type WaSendJob } from "@/lib/whatsapp/queue";
import type { WhatsAppRuntime } from "@/lib/whatsapp/runtime";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));

export interface WaWorkerOptions {
  runtime: WhatsAppRuntime;
  hooks?: Pick<IngestDeps, "onInboundMessage" | "onSessionEvent">;
  limiter?: SendRateLimiter;
}

export function createWaWorkers({ runtime, hooks, limiter = new RedisSendRateLimiter() }: WaWorkerOptions) {
  const ingest = new Worker<WaIngestJob>(
    WA_INGEST_QUEUE,
    async (job) => processIngestJob(job.data, { repo: runtime.repo, ...hooks }),
    { connection: getRedisConnection(), concurrency: 10 }
  );

  const send = new Worker<WaSendJob>(
    WA_SEND_QUEUE,
    async (job: Job<WaSendJob>, token?: string) => {
      const result = await processSendJob(job.data, {
        repo: runtime.repo,
        getConnector: async (session) => createConnector(session, { credentials: await runtime.credentialsFor(session) }),
        limiter,
        sleep,
        onProgress: async (nextIndex) => {
          await job.updateData({ ...job.data, nextIndex });
        },
      });
      if (result.status === "rate_limited") {
        // Passou do limite por minuto do número: volta pra fila no próximo minuto.
        await job.updateData({ ...job.data, nextIndex: result.nextIndex });
        await job.moveToDelayed(Date.now() + result.retryAfterMs + 250, token);
        throw new DelayedError();
      }
      return result;
    },
    {
      connection: getRedisConnection(),
      // Envios do mesmo número saem em ordem; o ritmo humano deixa cada job lento de propósito.
      concurrency: 4,
      lockDuration: 120_000,
    }
  );

  return {
    async close() {
      await Promise.all([ingest.close(), send.close()]);
    },
  };
}
