import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@/app/generated/prisma/client";
import { prisma as defaultPrisma } from "@/lib/db/client";
import { withSystemRole } from "@/lib/db/rls";
import { clearAccountCache } from "@/lib/contacts/record";
import { purgeInstagramAccountData } from "@/lib/channels/purge";
import { unsubscribeInstagramAccountFromWebhooks } from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";

/**
 * Callbacks da Meta pro Instagram Login (06/10/2026, revisão do app):
 *  - desautorização: a pessoa removeu o Lead Engine pelo Instagram. A conta
 *    fica DISCONNECTED e o token é apagado. Regra do dono: desconectar NUNCA
 *    apaga conversa, contato nem automação.
 *  - exclusão de dados: a Meta pede pra apagar os dados daquela conta. Apaga
 *    tudo (mesma transação do "Excluir de verdade") e grava o pedido com um
 *    código de confirmação pra página pública de status.
 *
 * Qual id chega: o user_id do signed_request é o id do app (Instagram-scoped
 * user id, o `id` do /me), guardado em InstagramAccount.appScopedId. Por
 * garantia também procuramos pelo instagramId (id da conta profissional).
 * Só age quando exatamente UMA conta bate. Nenhuma ou mais de uma: registra e
 * não mexe em nada.
 */

export type MatchResult =
  | { kind: "one"; account: MatchedAccount }
  | { kind: "none" }
  | { kind: "ambiguous"; count: number };

export type MatchedAccount = {
  id: string;
  workspaceId: string;
  instagramId: string;
  appScopedId: string | null;
  accessToken: string;
  status: string;
};

export async function findAccountByMetaUserId(
  metaUserId: string,
  client: PrismaClient = defaultPrisma
): Promise<MatchResult> {
  if (!metaUserId) return { kind: "none" };
  const rows = await client.instagramAccount.findMany({
    where: { OR: [{ appScopedId: metaUserId }, { instagramId: metaUserId }] },
    select: {
      id: true,
      workspaceId: true,
      instagramId: true,
      appScopedId: true,
      accessToken: true,
      status: true,
    },
    take: 3,
  });
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return { kind: "none" };
  if (list.length > 1) return { kind: "ambiguous", count: list.length };
  return { kind: "one", account: list[0] as MatchedAccount };
}

/** Código alfanumérico que a Meta mostra pra pessoa. 20 caracteres, maiúsculos. */
export function newConfirmationCode(): string {
  return randomBytes(10).toString("hex").toUpperCase();
}

export const CONFIRMATION_CODE = /^[A-F0-9]{20}$/;

async function logEvent(
  client: PrismaClient,
  data: { workspaceId?: string | null; level: "INFO" | "WARNING" | "ERROR"; message: string; payload: Record<string, unknown> }
) {
  await client.operationalEvent
    .create({
      data: {
        workspaceId: data.workspaceId ?? null,
        source: "SYSTEM",
        level: data.level,
        message: data.message,
        payload: data.payload as never,
      },
    })
    .catch(() => undefined);
}

/** Desautorização: desliga a conta e apaga o token. Não apaga mais nada. */
export async function handleDeauthorize(
  metaUserId: string,
  client: PrismaClient = defaultPrisma
): Promise<{ result: "disconnected" | "not_found" | "ambiguous"; instagramAccountId?: string }> {
  const match = await findAccountByMetaUserId(metaUserId, client);
  if (match.kind !== "one") {
    await logEvent(client, {
      level: "WARNING",
      message:
        match.kind === "none"
          ? "Meta deauthorize callback: no account matches this user id (nothing changed)"
          : "Meta deauthorize callback: more than one account matches (nothing changed)",
      payload: { metaUserId, match: match.kind },
    });
    return { result: match.kind === "none" ? "not_found" : "ambiguous" };
  }

  const account = match.account;
  const now = new Date();
  // Só a própria conta muda. O token já não vale (a pessoa removeu o app),
  // então nem tentamos falar com a Meta.
  await client.instagramAccount.update({
    where: { id: account.id },
    data: {
      status: "DISCONNECTED",
      disconnectedAt: now,
      disconnectedBy: null,
      accessToken: "",
      webhookSubscribed: false,
      lastError: "Removed from Instagram by the account owner (Meta deauthorize callback)",
      lastErrorAt: now,
    },
  });
  clearAccountCache();

  await logEvent(client, {
    workspaceId: account.workspaceId,
    level: "WARNING",
    message: "Instagram account removed the app on Instagram: disconnected (nothing deleted)",
    payload: { instagramAccountId: account.id, previousStatus: account.status, via: "meta_deauthorize" },
  });
  return { result: "disconnected", instagramAccountId: account.id };
}

export type DeletionOutcome = {
  confirmationCode: string;
  status: "COMPLETED" | "NOT_FOUND" | "AMBIGUOUS" | "FAILED";
};

/**
 * Exclusão de dados: grava o pedido, acha a conta, apaga tudo dela e marca o
 * pedido como concluído. Sempre devolve um código (a Meta precisa dele mesmo
 * quando não há nada pra apagar).
 */
export async function handleDataDeletion(
  metaUserId: string,
  client: PrismaClient = defaultPrisma
): Promise<DeletionOutcome> {
  const confirmationCode = newConfirmationCode();
  const request = await withSystemRole(
    (tx) =>
      tx.dataDeletionRequest.create({
        data: { confirmationCode, metaUserId, status: "RECEIVED" },
        select: { id: true },
      }),
    client
  );

  const finish = (data: {
    status: DeletionOutcome["status"];
    instagramAccountId?: string | null;
    workspaceId?: string | null;
    deleted?: Record<string, unknown> | null;
    error?: string | null;
  }) =>
    withSystemRole(
      (tx) =>
        tx.dataDeletionRequest.update({
          where: { id: request.id },
          data: {
            status: data.status,
            instagramAccountId: data.instagramAccountId ?? null,
            workspaceId: data.workspaceId ?? null,
            deleted: (data.deleted ?? undefined) as never,
            error: data.error ?? null,
            completedAt: data.status === "COMPLETED" || data.status === "NOT_FOUND" ? new Date() : null,
          },
        }),
      client
    );

  const match = await findAccountByMetaUserId(metaUserId, client);
  if (match.kind !== "one") {
    const status = match.kind === "none" ? "NOT_FOUND" : "AMBIGUOUS";
    await finish({ status });
    await logEvent(client, {
      level: "WARNING",
      message:
        status === "NOT_FOUND"
          ? "Meta data deletion request: no account matches this user id (nothing deleted, check by hand)"
          : "Meta data deletion request: more than one account matches (nothing deleted, check by hand)",
      payload: { metaUserId, dataDeletionRequestId: request.id, match: match.kind },
    });
    return { confirmationCode, status };
  }

  const account = match.account;
  // Para os webhooks da Meta antes, se ainda houver token (quase sempre não há:
  // a pessoa removeu o app). Falha aqui nunca impede a exclusão.
  if (account.accessToken) {
    try {
      await unsubscribeInstagramAccountFromWebhooks(account.instagramId, decryptToken(account.accessToken));
    } catch {
      // best effort
    }
  }

  try {
    const deleted = await purgeInstagramAccountData(account, client);
    clearAccountCache();
    await finish({ status: "COMPLETED", instagramAccountId: account.id, workspaceId: account.workspaceId, deleted });
    await logEvent(client, {
      workspaceId: account.workspaceId,
      level: "WARNING",
      message: "Instagram account data deleted at Meta's request (data deletion callback)",
      payload: { dataDeletionRequestId: request.id, deleted },
    });
    return { confirmationCode, status: "COMPLETED" };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : "Unknown error";
    await finish({ status: "FAILED", instagramAccountId: account.id, workspaceId: account.workspaceId, error: message }).catch(
      () => undefined
    );
    await logEvent(client, {
      workspaceId: account.workspaceId,
      level: "ERROR",
      message: "Meta data deletion request failed (nothing deleted, the transaction was rolled back)",
      payload: { dataDeletionRequestId: request.id, reason: message },
    });
    return { confirmationCode, status: "FAILED" };
  }
}

export type PublicDeletionStatus = {
  status: string;
  createdAt: Date;
  completedAt: Date | null;
};

/** Só o status de um código, pra página pública. Nada de dado pessoal. */
export async function getDeletionStatus(
  code: string,
  client: PrismaClient = defaultPrisma
): Promise<PublicDeletionStatus | null> {
  const normalized = code.trim().toUpperCase();
  if (!CONFIRMATION_CODE.test(normalized)) return null;
  return withSystemRole(
    (tx) =>
      tx.dataDeletionRequest.findUnique({
        where: { confirmationCode: normalized },
        select: { status: true, createdAt: true, completedAt: true },
      }),
    client
  );
}
