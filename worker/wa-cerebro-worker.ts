/**
 * Worker da fila wa-cerebro (PDFs da base de conhecimento dos agentes).
 * Rodar com: npm run worker:cerebro
 */
import { createCerebroWorker } from "@/lib/whatsapp/cerebro/queue";
import { ingestDepsFor } from "@/lib/whatsapp/cerebro/service";

const worker = createCerebroWorker((job) => ingestDepsFor(job.ownerUserId, job.workspaceId));
console.log("[wa-cerebro] Worker iniciado");

async function shutdown() {
  await worker.close();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
