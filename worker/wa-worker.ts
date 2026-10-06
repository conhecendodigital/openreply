/**
 * Worker do WhatsApp (wa-ingest + wa-send). Roda separado: tsx worker/wa-worker.ts
 *
 * Só sobe quando WHATSAPP_ENABLED=1 e a Fase 0 registrou o repositório
 * (registerWhatsAppRuntime). Até lá, avisa e sai sem erro.
 */
import { getWhatsAppRuntime } from "@/lib/whatsapp/runtime";
import { createWaWorkers } from "@/lib/whatsapp/worker";

const runtime = getWhatsAppRuntime();
if (!runtime) {
  console.log("[WA Worker] WhatsApp desligado (WHATSAPP_ENABLED ou repositório ausente). Saindo.");
  process.exit(0);
}

const workers = createWaWorkers({ runtime });
console.log("[WA Worker] Started");

async function shutdown(signal: string) {
  console.log(`[WA Worker] ${signal} received, closing`);
  await workers.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
