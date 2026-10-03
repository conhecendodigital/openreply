/**
 * Preenche os Contatos (CRM) a partir do histórico: comentários dos webhooks,
 * DmLog (comentários de campanha e campanhas enviadas), DirectMessage e cliques
 * com pessoa conhecida. Pode rodar de novo sem duplicar nada.
 *
 *   npx tsx scripts/backfill-contatos.ts --dry-run          # só conta
 *   npx tsx scripts/backfill-contatos.ts                    # grava
 *   npx tsx scripts/backfill-contatos.ts --workspace=<id>   # um workspace só
 */
import { backfillContacts } from "@/lib/contacts/backfill";

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const workspaceId = args.find((a) => a.startsWith("--workspace="))?.split("=")[1];

  const stats = await backfillContacts({
    dryRun,
    workspaceId,
    batchSize: 500,
    log: (line) => console.log(line),
  });

  console.log(
    `[backfill] ${dryRun ? "SIMULAÇÃO (nada gravado)" : "pronto"}: ` +
      `${stats.webhookComments} comentários de webhook, ` +
      `${stats.dmLogComments} comentários de campanha, ` +
      `${stats.campaignsSent} campanhas enviadas, ` +
      `${stats.directMessages} DMs, ` +
      `${stats.clicks} cliques com pessoa` +
      (dryRun ? "" : ` · ${stats.newEvents} eventos novos na linha do tempo`)
  );
  if (stats.clicksWithoutPerson > 0) {
    console.log(
      `[backfill] ${stats.clicksWithoutPerson} cliques antigos não têm pessoa (só contam no total da campanha).`
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
