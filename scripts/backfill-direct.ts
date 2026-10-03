/**
 * Fill DirectMessage/DirectMedia from the webhook history (WebhookEvent), so the
 * inbox shows past conversations too. Safe to re-run: messages upsert by mid.
 * Old media links are tried once; Meta usually expires them, then they are
 * marked "expired".
 *
 *   npx tsx scripts/backfill-direct.ts
 */
import { prisma } from "@/lib/db/client";
import { storeDirectMessages } from "@/lib/messages/store";
import { getDMQueue, SAVE_MEDIA_JOB_NAME } from "@/lib/queue/client";

async function main() {
  let cursor: string | undefined;
  let eventos = 0;
  let midias = 0;
  const queue = getDMQueue();

  for (;;) {
    const batch = await prisma.webhookEvent.findMany({
      where: { object: "instagram" },
      orderBy: { id: "asc" },
      take: 200,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: { id: true, payload: true },
    });
    if (batch.length === 0) break;
    for (const ev of batch) {
      const ids = await storeDirectMessages(ev.payload, { crm: true });
      eventos += 1;
      for (const id of ids) {
        await queue.add(SAVE_MEDIA_JOB_NAME, { instagramAccountId: "", mediaId: id }, { jobId: `media_${id}` });
        midias += 1;
      }
    }
    cursor = batch[batch.length - 1].id;
  }

  const total = await prisma.directMessage.count();
  console.log(`[backfill] ${eventos} webhooks lidos · ${total} mensagens no histórico · ${midias} mídias na fila pra baixar`);
  await queue.close();
  await prisma.$disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("[backfill] erro:", err);
  process.exit(1);
});
