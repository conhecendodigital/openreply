/**
 * Aprendizado com o dono (29/10/2026): quando ele EDITA um rascunho do vendedor, o par
 * (rascunho original, versão do dono) vira exemplo anonimizado, só referência no Comando.
 * Melhor esforço: qualquer falha aqui é engolida e nunca atrapalha a edição. Nada vai para log.
 */
import { prisma } from "@/lib/db/client";
import { lastMessages } from "@/lib/inbox/context";
import { montarExemplo } from "./conversa";

export const MAX_EXEMPLOS_VENDEDOR = 100;

export async function registrarExemploDeEdicao(input: { draftId: string; workspaceId: string; textoOriginal: string; textoNovo: string }): Promise<boolean> {
  try {
    const draft = await prisma.draftReply.findFirst({
      where: { id: input.draftId, workspaceId: input.workspaceId, origin: "vendedor" },
      select: { instagramAccountId: true, contact: { select: { igUserId: true, name: true, username: true, instagramAccount: { select: { instagramId: true } } } } },
    });
    if (!draft) return false;
    const msgs = await lastMessages(draft.contact.instagramAccount.instagramId, draft.contact.igUserId);
    const dela: string[] = [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].fromMe) {
        if (dela.length) break;
        continue;
      }
      if (msgs[i].text) dela.unshift(msgs[i].text as string);
      if (dela.length >= 3) break;
    }
    const nomes = [draft.contact.name, draft.contact.username].filter((n): n is string => Boolean(n));
    const ex = montarExemplo({ pergunta: dela.join("\n"), rascunho: input.textoOriginal, resposta: input.textoNovo, nomes });
    if (!ex) return false;
    const origemId = `draft:${input.draftId}`;
    await prisma.vendedorIgExemplo.upsert({
      where: { instagramAccountId_origemId: { instagramAccountId: draft.instagramAccountId, origemId } },
      create: { workspaceId: input.workspaceId, instagramAccountId: draft.instagramAccountId, origem: "edicao", origemId, pergunta: ex.pergunta, rascunho: ex.rascunho, resposta: ex.resposta },
      update: { resposta: ex.resposta },
    });
    const total = await prisma.vendedorIgExemplo.count({ where: { instagramAccountId: draft.instagramAccountId } });
    if (total > MAX_EXEMPLOS_VENDEDOR) {
      const velhos = await prisma.vendedorIgExemplo.findMany({ where: { instagramAccountId: draft.instagramAccountId }, orderBy: { createdAt: "asc" }, take: total - MAX_EXEMPLOS_VENDEDOR, select: { id: true } });
      await prisma.vendedorIgExemplo.deleteMany({ where: { id: { in: velhos.map((v) => v.id) } } });
    }
    return true;
  } catch {
    return false;
  }
}
