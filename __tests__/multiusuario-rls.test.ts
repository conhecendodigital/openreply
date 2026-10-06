/**
 * Fase 0 (06/10/2026): RLS nas tabelas novas do schema whatsapp, num Postgres
 * de verdade (PGlite) com todas as migrações aplicadas.
 * - usuário A não lê nada do B (nem forçando o workspace do outro);
 * - membro do workspace (Kayanne) vê e grava no inbox do workspace do dono;
 * - admin vê status e números de todos, mas só abre conteúdo com auditoria;
 * - log de auditoria só cresce (ninguém edita nem apaga);
 * - sem contexto marcado, o papel da aplicação não vê nada.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { PrismaClient } from "../app/generated/prisma/client";
import { migratedDb, startPrisma } from "./helpers/pglite-db";
import { forUser, withRls, withSystemRole } from "../lib/db/rls";
import { listSessionsAsAdmin, openConversationAsAdmin } from "../lib/whatsapp/admin-access";

let db: PGlite;
let prisma: PrismaClient;
let stop: () => Promise<void>;

const now = "now()";

beforeAll(async () => {
  db = await migratedDb();
  await db.exec(`
    INSERT INTO "User"(id, email, "updatedAt", role) VALUES
      ('u_matheus', 'matheus@ex.com', ${now}, 'ADMIN'),
      ('u_kayanne', 'kayanne@ex.com', ${now}, 'USER'),
      ('u_bia', 'bia@ex.com', ${now}, 'USER');
    INSERT INTO "Workspace"(id, name, "ownerId", "updatedAt") VALUES
      ('ws_m', 'Matheus', 'u_matheus', ${now}),
      ('ws_b', 'Bia', 'u_bia', ${now});
    INSERT INTO "WorkspaceMember"(id, "workspaceId", "userId", role) VALUES
      ('wm1', 'ws_m', 'u_matheus', 'OWNER'),
      ('wm2', 'ws_m', 'u_kayanne', 'MEMBER'),
      ('wm3', 'ws_b', 'u_bia', 'OWNER');
    INSERT INTO whatsapp."WaSession"(id, "workspaceId", "ownerUserId", provider, "providerSessionId", status, "conversationCount", "messageCount", "updatedAt") VALUES
      ('s_m', 'ws_m', 'u_matheus', 'CLOUD_API', 'pn_m', 'CONNECTED', 1, 1, ${now}),
      ('s_b', 'ws_b', 'u_bia', 'CLOUD_API', 'pn_b', 'CONNECTED', 1, 1, ${now});
    INSERT INTO whatsapp."WaContact"(id, "workspaceId", "sessionId", jid, name, "updatedAt") VALUES
      ('c_m', 'ws_m', 's_m', '5511@c.us', 'Cliente do Matheus', ${now}),
      ('c_b', 'ws_b', 's_b', '5521@c.us', 'Cliente da Bia', ${now});
    INSERT INTO whatsapp."WaConversation"(id, "workspaceId", "sessionId", "contactId", "updatedAt") VALUES
      ('cv_m', 'ws_m', 's_m', 'c_m', ${now}),
      ('cv_b', 'ws_b', 's_b', 'c_b', ${now});
    INSERT INTO whatsapp."WaMessage"(id, "workspaceId", "sessionId", "conversationId", "providerMessageId", "fromMe", "sentBy", type, body, "sentAt") VALUES
      ('m_m', 'ws_m', 's_m', 'cv_m', 'wamid.1', false, 'CONTACT', 'text', 'oi Matheus', ${now}),
      ('m_b', 'ws_b', 's_b', 'cv_b', 'wamid.2', false, 'CONTACT', 'text', 'segredo da Bia', ${now});
    INSERT INTO whatsapp."WaLabel"(id, "workspaceId", name, color, "updatedAt") VALUES
      ('l_b', 'ws_b', 'VIP', '#ff0000', ${now});
  `);
  ({ prisma, stop } = await startPrisma(db));
}, 60_000);

afterAll(async () => {
  await stop?.();
  await db?.close();
});

const bia = { userId: "u_bia", workspaceId: "ws_b" };
const kayanne = { userId: "u_kayanne", workspaceId: "ws_m" };

describe("RLS do WhatsApp: cada um no seu workspace", () => {
  it("Bia só vê as conversas e mensagens do workspace dela", async () => {
    const rows = await withRls(bia, (tx) => tx.waMessage.findMany({ select: { body: true } }), prisma);
    expect(rows.map((r) => r.body)).toEqual(["segredo da Bia"]);
    const convs = await withRls(bia, (tx) => tx.waConversation.findMany(), prisma);
    expect(convs.map((c) => c.id)).toEqual(["cv_b"]);
  });

  it("forçar o workspace de outra pessoa não adianta (não é membro)", async () => {
    const rows = await withRls({ userId: "u_bia", workspaceId: "ws_m" }, (tx) => tx.waMessage.findMany(), prisma);
    expect(rows).toEqual([]);
    const byId = await withRls(bia, (tx) => tx.waMessage.findUnique({ where: { id: "m_m" } }), prisma);
    expect(byId).toBeNull();
  });

  it("Bia não grava no workspace do Matheus", async () => {
    await expect(
      withRls(
        { userId: "u_bia", workspaceId: "ws_m" },
        (tx) => tx.waLabel.create({ data: { workspaceId: "ws_m", name: "invasão", color: "#000000" } }),
        prisma
      )
    ).rejects.toThrow();
    await expect(
      withRls(bia, (tx) => tx.waLabel.create({ data: { workspaceId: "ws_m", name: "invasão", color: "#000000" } }), prisma)
    ).rejects.toThrow();
    const updated = await withRls(bia, (tx) => tx.waMessage.updateMany({ where: { id: "m_m" }, data: { body: "x" } }), prisma);
    expect(updated.count).toBe(0);
  });

  it("Kayanne (membro do workspace do Matheus) vê e responde o inbox dele", async () => {
    const rows = await withRls(kayanne, (tx) => tx.waMessage.findMany({ select: { body: true } }), prisma);
    expect(rows.map((r) => r.body)).toEqual(["oi Matheus"]);
    const sent = await withRls(
      kayanne,
      (tx) =>
        tx.waMessage.create({
          data: {
            workspaceId: "ws_m",
            sessionId: "s_m",
            conversationId: "cv_m",
            providerMessageId: "wamid.k1",
            fromMe: true,
            sentBy: "USER_APP",
            type: "text",
            body: "Oi! Aqui é a Kayanne.",
            sentAt: new Date(),
          },
        }),
      prisma
    );
    expect(sent.id).toBeTruthy();
    // Mas não vê nada da Bia.
    const label = await withRls(kayanne, (tx) => tx.waLabel.findMany(), prisma);
    expect(label).toEqual([]);
  });

  it("a extensão do Prisma (forUser) marca o contexto em cada consulta", async () => {
    const db2 = forUser(bia, prisma);
    expect((await db2.waConversation.findMany()).map((c) => c.id)).toEqual(["cv_b"]);
    expect(await db2.waContact.count()).toBe(1);
  });

  it("sem contexto, o papel da aplicação não vê nada (nem o próprio dono)", async () => {
    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('role', 'le_app', true)`;
      return tx.waMessage.findMany();
    });
    expect(rows).toEqual([]);
  });

  it("le_system (webhook, cron) vê tudo, porque tem BYPASSRLS", async () => {
    const rows = await withSystemRole((tx) => tx.waMessage.count(), prisma);
    expect(rows).toBeGreaterThanOrEqual(2);
  });
});

describe("admin: status de todos, conteúdo só com auditoria", () => {
  it("vê números e status de todos os números conectados", async () => {
    const sessions = await listSessionsAsAdmin("u_matheus", prisma);
    expect(sessions.map((s) => s.id).sort()).toEqual(["s_b", "s_m"]);
    expect(sessions.find((s) => s.id === "s_b")?.messageCount).toBe(1);
  });

  it("sem registro de auditoria, não lê a conversa de outro workspace", async () => {
    const rows = await withRls({ userId: "u_matheus", workspaceId: null }, (tx) => tx.waMessage.findMany({ where: { workspaceId: "ws_b" } }), prisma);
    expect(rows).toEqual([]);
  });

  it("com registro de auditoria, lê e o registro fica gravado", async () => {
    const out = await openConversationAsAdmin(
      { adminUserId: "u_matheus", targetWorkspaceId: "ws_b", conversationId: "cv_b", reason: "suporte pedido pela Bia" },
      prisma
    );
    expect(out.conversation?.messages.map((m) => m.body)).toEqual(["segredo da Bia"]);
    const logs = await withSystemRole((tx) => tx.adminAccessLog.findMany({ where: { id: out.accessLogId } }), prisma);
    expect(logs[0]).toMatchObject({ adminUserId: "u_matheus", targetWorkspaceId: "ws_b", resourceId: "cv_b" });
  });

  it("o registro de auditoria só libera o workspace dele, e vence em 15 minutos", async () => {
    const out = await openConversationAsAdmin(
      { adminUserId: "u_matheus", targetWorkspaceId: "ws_b", conversationId: "cv_b", reason: "suporte pedido pela Bia" },
      prisma
    );
    const outro = await withRls(
      { userId: "u_matheus", workspaceId: null, adminAccessId: out.accessLogId },
      (tx) => tx.waMessage.findMany({ where: { workspaceId: "ws_m" } }),
      prisma
    );
    expect(outro).toEqual([]);
    await db.query(`UPDATE "AdminAccessLog" SET "createdAt" = now() - interval '16 minutes' WHERE id = $1`, [out.accessLogId]);
    const vencido = await withRls(
      { userId: "u_matheus", workspaceId: null, adminAccessId: out.accessLogId },
      (tx) => tx.waMessage.findMany({ where: { workspaceId: "ws_b" } }),
      prisma
    );
    expect(vencido).toEqual([]);
  });

  it("quem não é admin não consegue nem gravar o registro (e não lê nada)", async () => {
    await expect(
      openConversationAsAdmin(
        { adminUserId: "u_bia", targetWorkspaceId: "ws_m", conversationId: "cv_m", reason: "quero ver" },
        prisma
      )
    ).rejects.toThrow();
    // Usar o registro de outra pessoa também não serve.
    const [log] = await withSystemRole((tx) => tx.adminAccessLog.findMany({ take: 1 }), prisma);
    const rows = await withRls(
      { userId: "u_bia", workspaceId: null, adminAccessId: log.id },
      (tx) => tx.waMessage.findMany(),
      prisma
    );
    expect(rows).toEqual([]);
  });

  it("o log de auditoria não pode ser editado nem apagado pelo papel da aplicação", async () => {
    const [log] = await withSystemRole((tx) => tx.adminAccessLog.findMany({ take: 1 }), prisma);
    await expect(
      withRls({ userId: "u_matheus", workspaceId: null }, (tx) => tx.adminAccessLog.update({ where: { id: log.id }, data: { reason: "apagando rastro" } }), prisma)
    ).rejects.toThrow();
    await expect(
      withRls({ userId: "u_matheus", workspaceId: null }, (tx) => tx.adminAccessLog.delete({ where: { id: log.id } }), prisma)
    ).rejects.toThrow();
    // Pessoa comum nem lê o log.
    const lidos = await withRls(bia, (tx) => tx.adminAccessLog.findMany(), prisma);
    expect(lidos).toEqual([]);
  });
});
