/**
 * Postgres em memória (PGlite) com TODAS as migrações do repositório aplicadas,
 * na ordem, igual ao `prisma migrate deploy`. Serve pra testar RLS, papéis e
 * scripts de migração de dados sem banco de verdade.
 *
 * `startPrisma()` sobe um socket Postgres em cima do PGlite e devolve um
 * PrismaClient de verdade (adapter-pg, 1 conexão: o PGlite é uma sessão só).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../app/generated/prisma/client";

const MIGRATIONS = join(__dirname, "..", "..", "prisma", "migrations");

export function migrationNames(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((n) => /^\d/.test(n))
    .sort();
}

export async function migratedDb(): Promise<PGlite> {
  const db = new PGlite();
  for (const name of migrationNames()) {
    await db.exec(readFileSync(join(MIGRATIONS, name, "migration.sql"), "utf8"));
  }
  return db;
}

let nextPort = 15432 + Math.floor(Math.random() * 2000);

export async function startPrisma(db: PGlite): Promise<{ prisma: PrismaClient; stop: () => Promise<void> }> {
  const port = nextPort++;
  const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1" });
  await server.start();
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: `postgresql://postgres@127.0.0.1:${port}/postgres`, max: 1 }),
  });
  return {
    prisma,
    stop: async () => {
      await prisma.$disconnect().catch(() => {});
      await server.stop().catch(() => {});
    },
  };
}
