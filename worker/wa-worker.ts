/**
 * Worker do WhatsApp. Processo separado do site, igual ao dm-worker:
 *   npm run worker:wa   (tsx worker/wa-worker.ts)
 *
 * Roda num processo só:
 *   wa-ingest  grava contato, conversa e mensagem que o webhook recebeu;
 *   wa-send    envia com a regra das 24h e o ritmo humano;
 *   wa-agent   os 3 agentes (só fazem algo se alguém ligou um agente E o
 *              modo do número; nascem desligados);
 *   wa-cerebro PDFs do cérebro (texto -> pedaços -> embeddings);
 *   retenção   apaga o evento cru do webhook com mais de 30 dias.
 *
 * Só sobe com WHATSAPP_ENABLED=1. Sem isso, avisa e sai sem erro.
 */
import { Worker } from "bullmq";
import { getRedisConnection } from "@/lib/queue/client";
import { agentIngestHooks, agentSendHooks, processAgentJob } from "@/lib/whatsapp/agentes/worker";
import { createCerebroWorker } from "@/lib/whatsapp/cerebro/queue";
import { ingestDepsFor } from "@/lib/whatsapp/cerebro/service";
import { WA_AGENT_QUEUE, type WaAgentJob } from "@/lib/whatsapp/queue";
import { purgeOldWebhookEvents, RETENTION_INTERVAL_MS } from "@/lib/whatsapp/retencao";
import { ensureWhatsAppRuntime, getWaRepository } from "@/lib/whatsapp/setup";
import { createWaWorkers } from "@/lib/whatsapp/worker";

const runtime = ensureWhatsAppRuntime();
if (!runtime) {
  console.log("[WA Worker] WhatsApp desligado (WHATSAPP_ENABLED). Saindo.");
  process.exit(0);
}

const repo = getWaRepository();
const deps = { repo, queue: runtime.queue };

const workers = createWaWorkers({
  runtime,
  hooks: agentIngestHooks(repo),
  sendHooks: agentSendHooks(deps),
});

// Um de cada vez: o teto de gasto confere e reserva sem corrida (ver motor.ts).
const agent = new Worker<WaAgentJob>(
  WA_AGENT_QUEUE,
  async (job) => {
    const result = await processAgentJob(job.data, deps);
    // The reason is a fixed system phrase (never message text), so it is safe to log.
    const motivo = "motivo" in result && typeof result.motivo === "string" ? ` (${result.motivo.slice(0, 120)})` : "";
    console.log(`[WA Agent] ${job.data.kind} ${job.data.conversationId} ${result.acao}${motivo}`);
    return { acao: result.acao };
  },
  { connection: getRedisConnection(), concurrency: 1, lockDuration: 120_000 }
);
agent.on("failed", (job, error) => {
  console.error(`[WA Agent] falhou ${job?.data.conversationId ?? "?"}: ${(error?.message ?? "").slice(0, 160)}`);
});

const cerebro = createCerebroWorker((job) => ingestDepsFor(job.ownerUserId, job.workspaceId));

const retention = setInterval(() => void purgeOldWebhookEvents(repo).catch(() => {}), RETENTION_INTERVAL_MS);
void purgeOldWebhookEvents(repo).catch(() => {});

console.log("[WA Worker] Started (ingest, send, agent, cerebro)");

async function shutdown(signal: string) {
  console.log(`[WA Worker] ${signal} received, closing`);
  clearInterval(retention);
  await Promise.all([workers.close(), agent.close(), cerebro.close()]);
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
