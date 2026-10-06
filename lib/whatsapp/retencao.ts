/**
 * Retenção do WhatsApp (revisão de 06/10, item 6): o evento cru do webhook
 * (whatsapp."WaWebhookEvent".payload) guarda o texto das mensagens de
 * terceiros. Depois de 30 dias ele não serve mais pra idempotência nem pra
 * reprocessar, então sai. Conversas, contatos e mensagens NÃO são apagados.
 */
export const WEBHOOK_EVENT_RETENTION_DAYS = 30;
export const RETENTION_INTERVAL_MS = 6 * 60 * 60 * 1000;

export async function purgeOldWebhookEvents(
  repo: { purgeWebhookEvents(olderThan: Date): Promise<number> },
  now: Date = new Date(),
  days = WEBHOOK_EVENT_RETENTION_DAYS
): Promise<number> {
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const removed = await repo.purgeWebhookEvents(cutoff);
  if (removed > 0) console.log(`[WA Worker] retenção: ${removed} eventos de webhook com mais de ${days} dias apagados`);
  return removed;
}
