/**
 * Cérebro com pgvector de verdade (PGlite + extensão vector): com a extensão,
 * a migração 20261015130000_wa_cerebro cria a coluna vector(1536) com HNSW e a
 * busca usa o operador <=>. Sem ela, real[] (ver wa-integrado.test.ts).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import type { PrismaClient } from "../app/generated/prisma/client";
import { migrationNames, startPrisma } from "./helpers/pglite-db";
import { CerebroStore, detectVectorMode } from "../lib/whatsapp/cerebro/store";
import { createPrismaSqlExecutor, type PrismaRawLike } from "../lib/whatsapp/cerebro/sql";

let db: PGlite;
let prisma: PrismaClient;
let stop: () => Promise<void>;

beforeAll(async () => {
  db = new PGlite({ extensions: { vector } });
  for (const name of migrationNames()) {
    await db.exec(readFileSync(join(__dirname, "..", "prisma", "migrations", name, "migration.sql"), "utf8"));
  }
  await db.exec(`
    INSERT INTO "User"(id, email, "updatedAt") VALUES ('u1', 'a@ex.com', now());
    INSERT INTO "Workspace"(id, name, "ownerId", "updatedAt") VALUES ('w1', 'A', 'u1', now());
    INSERT INTO "WorkspaceMember"(id, "workspaceId", "userId", role) VALUES ('m1', 'w1', 'u1', 'OWNER');
  `);
  ({ prisma, stop } = await startPrisma(db));
}, 60_000);

afterAll(async () => {
  await stop?.();
  await db?.close();
});

describe("cérebro com pgvector", () => {
  it("a coluna é vector(1536) com índice HNSW", async () => {
    const col = await db.query<{ t: string }>(
      `SELECT format_type(atttypid, atttypmod) AS t FROM pg_attribute
       WHERE attrelid = 'whatsapp."WaKnowledgeChunk"'::regclass AND attname = 'embedding'`
    );
    expect(col.rows[0].t).toBe("vector(1536)");
    const idx = await db.query(`SELECT 1 FROM pg_indexes WHERE indexname = 'WaKnowledgeChunk_embedding_hnsw'`);
    expect(idx.rows).toHaveLength(1);
  });

  it("grava e busca por cosseno com <=>, na RLS do workspace", async () => {
    const exec = createPrismaSqlExecutor(prisma as unknown as PrismaRawLike, { userId: "u1", workspaceId: "w1" });
    expect(await detectVectorMode(exec)).toBe("pgvector");
    const store = new CerebroStore(exec, "pgvector");
    const { document } = await store.createDocument(
      { ownerUserId: "u1", workspaceId: "w1" },
      { agentKind: "atendimento", sessionId: null, fileName: "precos.pdf", sizeBytes: 5, sha256: "h", data: new Uint8Array([1]), pageCount: 1 }
    );
    const v = (i: number) => Array.from({ length: 1536 }, (_, j) => (j === i ? 1 : j === i + 1 ? 0.2 : 0));
    await store.saveChunks(document, [
      { position: 0, page: 1, content: "Horário de atendimento", tokenEstimate: 3, embedding: v(5) },
      { position: 1, page: 1, content: "Formas de pagamento", tokenEstimate: 3, embedding: v(9) },
    ], { embeddingModel: "m", embeddingTokens: 6, pageCount: 1 });
    const hits = await store.nearestChunks({ workspaceId: "w1", agentKind: "atendimento", embeddingModel: "m", vector: v(9), limit: 1 });
    expect(hits.map((h) => h.content)).toEqual(["Formas de pagamento"]);
    expect(hits[0].score).toBeCloseTo(1);
  });
});
