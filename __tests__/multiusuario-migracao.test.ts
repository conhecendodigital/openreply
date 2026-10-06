/**
 * Fase 0 (06/10/2026): a virada do login não pode perder a conta do dono.
 * Banco de verdade (PGlite) com todas as migrações e dados no formato do
 * NextAuth:
 * - a migração de dados é idempotente e não apaga nada;
 * - depois dela, o dono entra pelo login novo e cai no MESMO usuário (mesmo
 *   id), com o workspace, a chave de API e os convites de antes;
 * - a migração do Prisma é só aditiva (nenhum DROP, nenhum DELETE).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { prismaAdapter } from "better-auth/adapters/prisma";
import type { PrismaClient } from "../app/generated/prisma/client";
import { migratedDb, startPrisma } from "./helpers/pglite-db";
import { countKeptTables, migrateLoginData, parseEmailList, type Query } from "../lib/auth-data-migration";
import { createAuth } from "../lib/auth-config";

let db: PGlite;
let prisma: PrismaClient;
let stop: () => Promise<void>;
let query: Query;

beforeAll(async () => {
  db = await migratedDb();
  query = async (sql, params) => ({ rows: (await db.query(sql, params as unknown[])).rows as Record<string, unknown>[] });
  // Como está hoje em produção: usuário do NextAuth com e-mail confirmado (data).
  await db.exec(`
    INSERT INTO "User"(id, email, "emailVerified", "updatedAt") VALUES
      ('u_dono', 'matheus@hotmail.com', now(), now()),
      ('u_kay', 'Kayanne@Ex.com', now(), now()),
      ('u_dup1', 'dup@ex.com', NULL, now()),
      ('u_dup2', 'DUP@ex.com', NULL, now());
    INSERT INTO "Account"(id, "userId", type, provider, "providerAccountId") VALUES ('acc1', 'u_dono', 'email', 'resend', 'matheus@hotmail.com');
    INSERT INTO "Session"(id, "sessionToken", "userId", expires) VALUES ('ses1', 'tok-antigo', 'u_dono', now() + interval '1 day');
    INSERT INTO "Workspace"(id, name, "ownerId", "updatedAt") VALUES ('ws_dono', 'matheus''s workspace', 'u_dono', now());
    INSERT INTO "WorkspaceMember"(id, "workspaceId", "userId", role) VALUES ('wm1', 'ws_dono', 'u_dono', 'OWNER'), ('wm2', 'ws_dono', 'u_kay', 'MEMBER');
    INSERT INTO "ApiToken"(id, "workspaceId", name, "tokenHash", prefix, "createdById") VALUES ('tok1', 'ws_dono', 'MCP', 'hash-da-chave', 'or_abc', 'u_dono');
    INSERT INTO "WorkspaceInvitation"(id, "workspaceId", email, token, "expiresAt", "updatedAt") VALUES ('inv1', 'ws_dono', 'nova@ex.com', 'convite-1', now() + interval '7 days', now());
  `);
  ({ prisma, stop } = await startPrisma(db));
}, 60_000);

afterAll(async () => {
  await stop?.();
  await db?.close();
});

const opts = (apply: boolean) => ({
  apply,
  adminEmails: parseEmailList("Matheus@Hotmail.com"),
  allowedEmails: parseEmailList("matheus@hotmail.com, kayanne@ex.com"),
});

describe("migração de dados do login", () => {
  it("simulação não grava nada", async () => {
    const before = await countKeptTables(query);
    const report = await migrateLoginData(query, opts(false));
    expect(report.adminsPromoted).toEqual(["matheus@hotmail.com"]);
    expect(report.emailsLowercased).toEqual(["Kayanne@Ex.com -> kayanne@ex.com"]);
    expect(report.emailConflicts).toEqual(["DUP@ex.com"]);
    const { rows } = await query(`SELECT role, "authEmailVerified" FROM "User" WHERE id = 'u_dono'`);
    expect(rows[0]).toEqual({ role: "USER", authEmailVerified: false });
    expect(await countKeptTables(query)).toEqual(before);
    expect((await query(`SELECT count(*)::int n FROM "BetaAllowlist"`)).rows[0].n).toBe(0);
  });

  it("aplica uma vez e, rodando de novo, não muda mais nada", async () => {
    const before = await countKeptTables(query);
    const first = await migrateLoginData(query, opts(true));
    expect(first.verifiedMarked).toBe(2);
    expect(first.allowlistAdded.sort()).toEqual(["kayanne@ex.com", "matheus@hotmail.com"]);

    const second = await migrateLoginData(query, opts(true));
    expect(second).toMatchObject({
      emailsLowercased: [],
      verifiedMarked: 0,
      adminsPromoted: [],
      allowlistAdded: [],
      emailConflicts: ["DUP@ex.com"],
    });
    expect(await countKeptTables(query)).toEqual(before);

    const dono = (await query(`SELECT id, email, role, "authEmailVerified" FROM "User" WHERE id = 'u_dono'`)).rows[0];
    expect(dono).toEqual({ id: "u_dono", email: "matheus@hotmail.com", role: "ADMIN", authEmailVerified: true });
    // Tabelas do NextAuth intactas (dá pra voltar atrás).
    expect((await query(`SELECT count(*)::int n FROM "Account"`)).rows[0].n).toBe(1);
    expect((await query(`SELECT count(*)::int n FROM "Session"`)).rows[0].n).toBe(1);
  });

  it("depois da migração, o dono entra pelo login novo no MESMO usuário, com tudo dele", async () => {
    const mails: string[] = [];
    const created: string[] = [];
    const allowed = new Set(["matheus@hotmail.com"]);
    const auth = createAuth({
      database: prismaAdapter(prisma, { provider: "postgresql" }),
      secret: "segredo-de-teste-com-mais-de-32-caracteres-123",
      baseURL: "http://localhost:3000",
      builtInRateLimit: false,
      sendMagicLink: async (_email, url) => {
        mails.push(url);
      },
      canSignIn: async (email) => allowed.has(email),
      canSendMagicLink: async () => true,
      canTryPassword: async () => true,
      emailTakenInsensitive: async (email) =>
        Boolean(await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } } })),
      onUserCreated: async (user) => {
        created.push(user.email);
      },
      emailOfUser: async (id) => (await prisma.user.findUnique({ where: { id } }))?.email ?? null,
    });
    const send = await auth.handler(
      new Request("http://localhost:3000/api/auth/sign-in/magic-link", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({ email: "Matheus@Hotmail.com", callbackURL: "/dashboard" }),
      })
    );
    expect(send.status).toBe(200);
    const verify = await auth.handler(new Request(mails[0], { headers: { origin: "http://localhost:3000" } }));
    expect(verify.status).toBe(302);
    const cookie = verify.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
    expect(session?.user.id).toBe("u_dono");
    expect((session?.user as { role?: string }).role).toBe("ADMIN");
    expect(created).toEqual([]);
    expect(await prisma.user.count()).toBe(4);
    const member = await prisma.workspaceMember.findFirst({ where: { userId: "u_dono" }, include: { workspace: true } });
    expect(member?.workspace.id).toBe("ws_dono");
    expect(await prisma.apiToken.findUnique({ where: { id: "tok1" } })).toMatchObject({ workspaceId: "ws_dono" });
    expect(await prisma.workspaceInvitation.count()).toBe(1);
  });

  it("a migração do Prisma é só aditiva", () => {
    const sql = readFileSync(
      join(__dirname, "..", "prisma", "migrations", "20261013120000_multiusuario_login_whatsapp", "migration.sql"),
      "utf8"
    ).replace(/--.*$/gm, "");
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|COLUMN|TYPE|SCHEMA|INDEX)\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/ALTER\s+TABLE\s+"(User|Account|Session|VerificationToken)"\s+(DROP|ALTER\s+COLUMN)/i);
  });
});
