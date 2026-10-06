/**
 * Conexões > "Excluir número" (pedido do dono, 06/10/2026: "ter a opção de
 * excluir o número nas conexões"). Ação separada do Desconectar, que continua
 * sem apagar nada.
 *
 * Duas opções, sempre com confirmação na tela:
 * - "number_only" (Excluir só o número): tira o número do provedor (OpenWA:
 *   logout e apagar a sessão no gateway; uazapi: desconectar e DELETE
 *   /instance, que libera o dispositivo do plano) e marca deletedAt. O número
 *   some de Conexões e Agentes; conversas, contatos e mensagens ficam
 *   guardados, só pra leitura em Conversas. O webhook e os envios passam a
 *   ignorar o número (lib/whatsapp/prisma-repository.ts).
 * - "number_and_conversations" (Excluir número e conversas): o mesmo e apaga
 *   o que é daquele número: contatos, conversas, mensagens (com os dados das
 *   mídias), rascunhos e memória do agente, perfil e agentes do número,
 *   envios barrados, PDFs ligados ao número e eventos crus do webhook. Nada de
 *   outro número nem do Instagram. Exige digitar o nome do número.
 *   Também serve depois, pra apagar as conversas guardadas de um número que
 *   já foi excluído só o número ("conversations_after" na auditoria).
 *
 * Se o provedor não responder, a exclusão no Lead Engine continua e a resposta
 * diz providerOk=false com o id da instância, pra conferir no painel dele.
 * Cada exclusão grava um registro em WaNumberDeletion (quem, quando, qual
 * opção; sem conteúdo de mensagem). Tudo com RLS (withRls), igual ao painel.
 */
import { getPrisma } from "@/lib/db/client";
import { withSystemRole, type RlsContext } from "@/lib/db/rls";
import { connectorFor, PainelError, rls, type PainelDeps } from "@/lib/whatsapp/painel";
import { uazapiConnectorFor } from "@/lib/whatsapp/painel-uazapi";
import type { WaProvider } from "@/lib/whatsapp/types";

export type DeleteMode = "number_only" | "number_and_conversations";

export type DeleteResult = {
  deleted: true;
  mode: DeleteMode;
  /** false = o provedor não respondeu: conferir no painel dele. */
  providerOk: boolean;
  provider: WaProvider;
  /** Id da sessão no OpenWA ou da instância na uazapi. */
  providerRef: string;
  label: string;
  conversationsDeleted: number;
  messagesDeleted: number;
};

export type RemovedNumber = {
  id: string;
  provider: WaProvider;
  label: string;
  phoneE164: string | null;
  displayName: string | null;
  deletedAt: string;
  conversationCount: number;
  messageCount: number;
};

type Row = {
  id: string;
  provider: WaProvider;
  providerSessionId: string;
  displayName: string | null;
  phoneE164: string | null;
  riskAcceptedAt: Date | null;
  deletedAt: Date | null;
};

/** O que a pessoa tem que digitar pra apagar as conversas: o nome, ou o número se não tiver nome. */
export function deleteConfirmLabel(row: { displayName: string | null; phoneE164: string | null }): string {
  return row.displayName?.trim() || row.phoneE164 || "WhatsApp";
}

function normalize(text: string): string {
  return text.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

/** Aceita o nome (sem diferença de maiúscula e espaço) ou o número com ou sem +, espaço e traço. */
export function confirmNameMatches(typed: unknown, row: { displayName: string | null; phoneE164: string | null }): boolean {
  if (typeof typed !== "string") return false;
  const t = normalize(typed.slice(0, 120));
  if (!t) return false;
  if (normalize(deleteConfirmLabel(row)) === t) return true;
  if (row.displayName && normalize(row.displayName) === t) return true;
  const digits = t.replace(/\D/g, "");
  return Boolean(row.phoneE164 && digits.length >= 8 && digits === row.phoneE164.replace(/\D/g, ""));
}

/** Números excluídos "só o número" que ainda têm conversas guardadas (pra apagar depois, se quiser). */
export async function listRemovedSessions(ctx: RlsContext, deps: PainelDeps): Promise<RemovedNumber[]> {
  const rows = await rls(ctx, deps, (tx) =>
    tx.waSession.findMany({
      where: { workspaceId: ctx.workspaceId ?? "", deletedAt: { not: null } },
      select: { id: true, provider: true, displayName: true, phoneE164: true, deletedAt: true, conversationCount: true, messageCount: true },
      orderBy: { deletedAt: "desc" },
      take: 50,
    })
  );
  return rows.map((r) => ({
    id: r.id,
    provider: r.provider,
    label: deleteConfirmLabel(r),
    phoneE164: r.phoneE164,
    displayName: r.displayName,
    deletedAt: (r.deletedAt as Date).toISOString(),
    conversationCount: r.conversationCount,
    messageCount: r.messageCount,
  }));
}

/** Tira o número do provedor. Nunca joga erro: devolve se deu certo. */
async function removeFromProvider(ctx: RlsContext, deps: PainelDeps, row: Row): Promise<boolean> {
  if (row.provider === "OPENWA") {
    try {
      const client = connectorFor(deps, row.providerSessionId, row.riskAcceptedAt);
      try {
        await client.disconnect();
      } catch {
        // Já desconectado ou o logout falhou: apagar a sessão resolve do mesmo jeito.
      }
      if (!client.deleteSession) return false;
      await client.deleteSession();
      return true;
    } catch {
      return false;
    }
  }
  if (row.provider === "UAZAPI") {
    try {
      const client = await uazapiConnectorFor(ctx, deps, row.id);
      try {
        await client.disconnect();
      } catch {
        // Igual ao OpenWA: o DELETE /instance é o que libera a vaga.
      }
      await client.deleteInstance();
      return true;
    } catch {
      return false;
    }
  }
  // Cloud API: nada a apagar no provedor por aqui.
  return true;
}

export async function deleteSession(
  ctx: RlsContext & { workspaceId: string },
  sessionId: string,
  input: { mode?: unknown; confirmName?: unknown },
  deps: PainelDeps
): Promise<DeleteResult> {
  const mode = input.mode;
  if (mode !== "number_only" && mode !== "number_and_conversations") {
    throw new PainelError("invalid_mode", "Choose what to delete.", 400);
  }
  const row: Row | null = await rls(ctx, deps, (tx) =>
    tx.waSession.findFirst({
      where: { id: sessionId, workspaceId: ctx.workspaceId },
      select: { id: true, provider: true, providerSessionId: true, displayName: true, phoneE164: true, riskAcceptedAt: true, deletedAt: true },
    })
  );
  if (!row) throw new PainelError("not_found", "Number not found.", 404);
  if (row.deletedAt && mode === "number_only") throw new PainelError("already_deleted", "This number was already deleted.", 409);
  if (mode === "number_and_conversations" && !confirmNameMatches(input.confirmName, row)) {
    throw new PainelError("confirm_name", "Type the name of the number exactly as it shows to confirm.", 400);
  }

  const label = deleteConfirmLabel(row);
  const alreadyRemoved = Boolean(row.deletedAt);
  // Provedor primeiro (precisa do token, que sai do banco logo depois). Se ele
  // não responder, segue: a tela avisa pra conferir no painel do provedor.
  const providerOk = alreadyRemoved ? true : await removeFromProvider(ctx, deps, row);
  const now = new Date();

  if (mode === "number_only") {
    await rls(ctx, deps, async (tx) => {
      await tx.waSession.update({
        where: { id: row.id },
        data: {
          deletedAt: now,
          deletedById: ctx.userId,
          status: "DISCONNECTED",
          agentMode: "OFF",
          lastEventAt: now,
          // Sem segredo nem token: um webhook atrasado ou um envio na fila não passam mais.
          webhookSecretEnc: null,
          instanceTokenEnc: null,
          accessTokenEnc: null,
        },
      });
      await tx.waNumberDeletion.create({
        data: {
          workspaceId: ctx.workspaceId,
          sessionId: row.id,
          deletedById: ctx.userId,
          mode: "number_only",
          provider: row.provider,
          providerSessionId: row.providerSessionId,
          label,
          providerOk,
        },
      });
    });
    return { deleted: true, mode, providerOk, provider: row.provider, providerRef: row.providerSessionId, label, conversationsDeleted: 0, messagesDeleted: 0 };
  }

  // Número e conversas. Eventos crus do webhook só o papel de sistema apaga
  // (le_app não tem acesso à tabela); vão primeiro, filtrados por este número.
  // A sessão já foi conferida com a RLS acima (é deste workspace).
  await withSystemRole((tx) => tx.waWebhookEvent.deleteMany({ where: { sessionId: row.id } }), deps.system ?? getPrisma());

  const counts = await rls(ctx, deps, async (tx) => {
    const ws = ctx.workspaceId;
    const [conversations, messages] = await Promise.all([
      tx.waConversation.count({ where: { sessionId: row.id, workspaceId: ws } }),
      tx.waMessage.count({ where: { sessionId: row.id, workspaceId: ws } }),
    ]);
    await tx.waSendBlock.deleteMany({ where: { sessionId: row.id, workspaceId: ws } });
    // PDFs ligados só a este número (os do workspace inteiro, sem número, ficam).
    await tx.waKnowledgeChunk.deleteMany({ where: { sessionId: row.id, workspaceId: ws } });
    await tx.waKnowledgeDocument.deleteMany({ where: { sessionId: row.id, workspaceId: ws } });
    // Apagar o número leva junto (cascata): contatos, memória do contato,
    // conversas, etiquetas da conversa, mensagens, rascunhos/runs do agente,
    // perfil e agentes do número.
    await tx.waSession.delete({ where: { id: row.id } });
    await tx.waNumberDeletion.create({
      data: {
        workspaceId: ws,
        sessionId: row.id,
        deletedById: ctx.userId,
        mode: alreadyRemoved ? "conversations_after" : "number_and_conversations",
        provider: row.provider,
        providerSessionId: row.providerSessionId,
        label,
        providerOk,
        conversationsDeleted: conversations,
        messagesDeleted: messages,
      },
    });
    return { conversations, messages };
  });
  return {
    deleted: true,
    mode,
    providerOk,
    provider: row.provider,
    providerRef: row.providerSessionId,
    label,
    conversationsDeleted: counts.conversations,
    messagesDeleted: counts.messages,
  };
}
