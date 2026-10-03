/**
 * One-off (Etapa 2): subscribe every connected account again with the new
 * webhook fields (messaging_postbacks, messaging_referral, messaging_seen),
 * which ig.me links and Ice Breaker taps need. Then prints what Meta reports
 * via GET /<IG_ID>/subscribed_apps so it can be checked.
 *
 * Touches the real Meta accounts: run it only on purpose, by the owner.
 *
 *   npx tsx scripts/resubscribe-webhooks.ts            # dry run (lists accounts)
 *   npx tsx scripts/resubscribe-webhooks.ts --apply    # subscribes
 *
 * Also needed in the Meta app panel: Webhooks > Instagram > tick
 * messaging_referral and messaging_postbacks; and Ice Breakers set on the
 * account to receive the ref of a NEW conversation.
 */
import { prisma } from "@/lib/db/client";
import { getMetaGraphApiVersion } from "@/lib/env";
import { subscribeInstagramAccountToWebhooks, WEBHOOK_SUBSCRIBED_FIELDS } from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";

async function main() {
  const apply = process.argv.includes("--apply");
  const accounts = await prisma.instagramAccount.findMany({
    select: { id: true, username: true, instagramId: true, accessToken: true },
  });
  console.log(`[resubscribe] ${accounts.length} account(s); fields: ${WEBHOOK_SUBSCRIBED_FIELDS.join(", ")}`);

  for (const account of accounts) {
    if (!apply) {
      console.log(`  @${account.username} (${account.instagramId}) — dry run`);
      continue;
    }
    try {
      const token = decryptToken(account.accessToken);
      await subscribeInstagramAccountToWebhooks(account.instagramId, token);
      const res = await fetch(
        `https://graph.instagram.com/${getMetaGraphApiVersion()}/${account.instagramId}/subscribed_apps`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      console.log(`  @${account.username}: ok`, JSON.stringify(await res.json()));
      await prisma.instagramAccount.update({ where: { id: account.id }, data: { webhookSubscribed: true } });
    } catch (error) {
      console.error(`  @${account.username}: FAILED`, error instanceof Error ? error.message : error);
    }
  }
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[resubscribe] error:", err);
  process.exit(1);
});
