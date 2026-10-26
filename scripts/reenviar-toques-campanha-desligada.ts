/**
 * Toques em "Quero o Comando" (reveal:<campanha>) que chegaram DEPOIS da
 * campanha ser desligada e trocada por um fluxo, antes do conserto do
 * processPostback: ninguém respondeu. Este script começa o fluxo copiado da
 * campanha pra cada pessoa, do mesmo jeito do conserto (campaign-handoff):
 * A/B do fluxo, pulando a abertura que a pessoa já tocou.
 *
 * Só toques das últimas 23 h (janela de 24 h do Instagram ainda aberta) e só
 * quem ainda não tem run nesse fluxo depois do toque. Sem --enviar só lista.
 *
 *   npx tsx scripts/reenviar-toques-campanha-desligada.ts            # só mostra
 *   npx tsx scripts/reenviar-toques-campanha-desligada.ts --enviar   # envia
 *   ... --incluir-antes   # também quem tocou ANTES de desligar (recebeu a
 *                         # mensagem antiga da campanha) e ainda não está no fluxo
 */
import { prisma } from "@/lib/db/client";
import { findHandoffFlow } from "@/lib/flows/campaign-handoff";
import { startFlowRun } from "@/lib/flows/engine";

const ENVIAR = process.argv.includes("--enviar");
const INCLUIR_ANTES = process.argv.includes("--incluir-antes");
const JANELA_MS = 23 * 60 * 60 * 1000;

async function main() {
  const desde = new Date(Date.now() - JANELA_MS);
  const toques = await prisma.contactEvent.findMany({
    where: { type: "POSTBACK_IN", text: { startsWith: "reveal:" }, occurredAt: { gte: desde } },
    orderBy: { occurredAt: "asc" },
    select: { contactId: true, text: true, occurredAt: true },
  });
  const feitos = new Set<string>();
  let enviados = 0;
  for (const t of toques) {
    const automationId = (t.text ?? "").slice("reveal:".length);
    const chave = `${t.contactId}:${automationId}`;
    if (!automationId || feitos.has(chave)) continue;
    const automation = await prisma.automation.findUnique({
      where: { id: automationId },
      select: { isActive: true, updatedAt: true, name: true, instagramAccount: { select: { instagramId: true } } },
    });
    // Campanha ligada respondeu normal; toque de antes de desligar também.
    if (!automation || automation.isActive) continue;
    if (!INCLUIR_ANTES && t.occurredAt <= automation.updatedAt) continue;
    const contact = await prisma.contact.findUnique({ where: { id: t.contactId }, select: { igUserId: true, username: true } });
    if (!contact?.igUserId) continue;
    const alvo = await findHandoffFlow({ automationId, instagramId: automation.instagramAccount.instagramId, igUserId: contact.igUserId });
    if (!alvo) continue;
    const jaTem = await prisma.flowRun.findFirst({
      where: { flowId: alvo.flowId, contactId: t.contactId },
      select: { id: true },
    });
    feitos.add(chave);
    if (jaTem) continue;
    console.log(`${ENVIAR ? "enviando" : "enviaria"}: @${contact.username ?? contact.igUserId} · ${automation.name} · começa em ${alvo.startNodeId}`);
    if (!ENVIAR) continue;
    const r = await startFlowRun({
      instagramAccountId: automation.instagramAccount.instagramId,
      flowId: alvo.flowId,
      kind: "BROADCAST",
      triggerKey: `reveal:${automationId}:${contact.igUserId}:${t.occurredAt.getTime()}`,
      triggerRef: contact.igUserId,
      igUserId: contact.igUserId,
      username: contact.username,
      inboundAt: t.occurredAt.getTime(),
      startNodeId: alvo.startNodeId,
    });
    console.log(`  → ${r}`);
    enviados += 1;
  }
  console.log(ENVIAR ? `Pronto: ${enviados} pessoas.` : "Nada enviado (rode com --enviar).");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
