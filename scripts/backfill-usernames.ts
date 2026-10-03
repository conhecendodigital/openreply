/**
 * Preenche @, nome e foto dos contatos que estão como "Usuário desconhecido"
 * (entraram por DM, link ig.me ou botão: o webhook só traz o IGSID).
 * Primeiro o que já temos (histórico de campanhas, moderação), depois a API
 * de perfil da Meta. Só contas ACTIVE, só contatos sem @. Pode rodar de novo
 * sem estragar nada. Lotes de 10, pausa de 1,5 s entre chamadas, dentro do
 * mesmo limite por hora do worker (120/h por conta).
 *
 *   npx tsx scripts/backfill-usernames.ts --dry-run          # só mostra (não chama a Meta)
 *   npx tsx scripts/backfill-usernames.ts                    # grava
 *   npx tsx scripts/backfill-usernames.ts --limit=50         # no máximo 50 contatos
 *   npx tsx scripts/backfill-usernames.ts --workspace=<id>   # um workspace só
 *   npx tsx scripts/backfill-usernames.ts --retry-denied     # tenta de novo quem a Meta negou
 */
import { prisma } from "@/lib/db/client";
import { backfillUsernames } from "@/lib/contacts/profile-backfill";

async function main() {
  const args = process.argv.slice(2);
  const value = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  const dryRun = args.includes("--dry-run");
  const retryDenied = args.includes("--retry-denied");
  const limit = Number.parseInt(value("limit") ?? "", 10);

  const stats = await backfillUsernames({
    dryRun,
    retryDenied,
    workspaceId: value("workspace"),
    limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
    batchSize: 10,
    pauseMs: 1_500,
    log: (line) => console.log(line),
  });

  console.log(
    `[usernames] ${dryRun ? "SIMULAÇÃO (nada gravado, Meta não chamada)" : "pronto"}: ` +
      `${stats.accounts} conta(s), ${stats.looked} contato(s) olhados, ` +
      `${stats.local ?? 0} achados no histórico, ` +
      (dryRun
        ? `${stats.needs_api ?? 0} iriam pra API da Meta`
        : `${stats.ok ?? 0} pela API, ${stats.denied ?? 0} negados, ${stats.error ?? 0} com erro, ${stats.apiCalls} chamada(s)`)
  );
  if (stats.stoppedEarly) console.log(`[usernames] parou antes: ${stats.stoppedEarly}`);
  await prisma.$disconnect();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
