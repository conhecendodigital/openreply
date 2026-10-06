/**
 * Acesso ao banco do cérebro (tabelas da migração 20261015130000_wa_cerebro).
 * Toda consulta filtra por workspaceId no código, e a RLS confere de novo.
 */
import { randomUUID } from "node:crypto";
import { toVectorLiteral } from "@/lib/whatsapp/cerebro/embeddings";
import type { SqlExecutor } from "@/lib/whatsapp/cerebro/sql";
import type {
  AgentKind,
  AiUsageEntry,
  CerebroScope,
  ContactMemory,
  ContactStage,
  KnowledgeDoc,
  KnowledgeHit,
  NewKnowledgeChunk,
  StoredContactMemory,
  UsageRecorder,
} from "@/lib/whatsapp/cerebro/types";

const T_DOC = `whatsapp."WaKnowledgeDocument"`;
const T_CHUNK = `whatsapp."WaKnowledgeChunk"`;
const T_MEMORY = `whatsapp."WaContactMemory"`;
const T_USAGE = `whatsapp."WaAiUsage"`;

const DOC_COLUMNS = `"id", "ownerUserId", "workspaceId", "agentKind", "sessionId", "fileName",
  "sizeBytes", "pageCount", "status", "errorCode", "chunkCount", "embeddingModel",
  "embeddingTokens", "createdAt", "processedAt"`;

/** Linhas por INSERT de pedaços (11 parâmetros cada, bem longe do limite de 65535). */
const CHUNK_INSERT_BATCH = 100;

type DocRow = Omit<KnowledgeDoc, "createdAt" | "processedAt"> & {
  createdAt: Date | string;
  processedAt: Date | string | null;
};

function toDoc(row: DocRow): KnowledgeDoc {
  return {
    ...row,
    sizeBytes: Number(row.sizeBytes),
    pageCount: row.pageCount === null ? null : Number(row.pageCount),
    chunkCount: Number(row.chunkCount),
    embeddingTokens: Number(row.embeddingTokens),
    createdAt: new Date(row.createdAt),
    processedAt: row.processedAt ? new Date(row.processedAt) : null,
  };
}

export interface NewKnowledgeDoc {
  agentKind: AgentKind;
  sessionId: string | null;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  data: Uint8Array;
  pageCount: number | null;
}

export interface ChunkSearch {
  workspaceId: string;
  agentKind: AgentKind;
  /** Número da conversa: pega os PDFs dele e os de "todos os números". */
  sessionId?: string | null;
  embeddingModel: string;
  vector: number[];
  limit: number;
}

/**
 * Como a coluna "embedding" foi criada (migração 20261015130000_wa_cerebro):
 * vector(1536) com pgvector, ou real[] quando o Postgres não tem a extensão.
 */
export type VectorMode = "pgvector" | "array";

/** Olha o tipo da coluna no banco. Na dúvida, pgvector (o padrão do plano). */
export async function detectVectorMode(db: SqlExecutor): Promise<VectorMode> {
  const rows = await db.query<{ t: string | null }>(
    `SELECT format_type(atttypid, atttypmod) AS t FROM pg_attribute
     WHERE attrelid = to_regclass('whatsapp."WaKnowledgeChunk"') AND attname = 'embedding'`
  );
  const t = rows[0]?.t ?? "";
  return t === "real[]" ? "array" : "pgvector";
}

/** '{0.1,0.2}' pra coluna real[] (mesma checagem do literal do pgvector). */
function toArrayLiteral(vector: number[]): string {
  return `{${toVectorLiteral(vector).slice(1, -1)}}`;
}

export class CerebroStore {
  constructor(
    private readonly db: SqlExecutor,
    private readonly vectorMode: VectorMode = "pgvector"
  ) {}

  private get vecCast(): string {
    return this.vectorMode === "array" ? "real[]" : "vector";
  }

  private vecLiteral(vector: number[]): string {
    return this.vectorMode === "array" ? toArrayLiteral(vector) : toVectorLiteral(vector);
  }

  // ─── Documentos ────────────────────────────────────────────────────────────

  /** Grava o PDF na fila. Mesmo PDF no mesmo agente devolve o que já existe. */
  async createDocument(scope: CerebroScope, doc: NewKnowledgeDoc): Promise<{ document: KnowledgeDoc; duplicate: boolean }> {
    const id = randomUUID();
    const inserted = await this.db.query<DocRow>(
      `INSERT INTO ${T_DOC} ("id", "ownerUserId", "workspaceId", "agentKind", "sessionId", "fileName",
         "sizeBytes", "sha256", "data", "pageCount", "status")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'queued')
       ON CONFLICT ("workspaceId", "agentKind", "sha256") DO NOTHING
       RETURNING ${DOC_COLUMNS}`,
      [id, scope.ownerUserId, scope.workspaceId, doc.agentKind, doc.sessionId, doc.fileName,
        doc.sizeBytes, doc.sha256, Buffer.from(doc.data), doc.pageCount]
    );
    if (inserted[0]) return { document: toDoc(inserted[0]), duplicate: false };
    const existing = await this.db.query<DocRow>(
      `SELECT ${DOC_COLUMNS} FROM ${T_DOC}
       WHERE "workspaceId" = $1 AND "agentKind" = $2 AND "sha256" = $3`,
      [scope.workspaceId, doc.agentKind, doc.sha256]
    );
    if (!existing[0]) throw new Error("Documento sumiu entre o INSERT e o SELECT");
    return { document: toDoc(existing[0]), duplicate: true };
  }

  async countDocuments(workspaceId: string, agentKind: AgentKind): Promise<number> {
    const rows = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ${T_DOC} WHERE "workspaceId" = $1 AND "agentKind" = $2`,
      [workspaceId, agentKind]
    );
    return Number(rows[0]?.n ?? 0);
  }

  async listDocuments(workspaceId: string, agentKind: AgentKind): Promise<KnowledgeDoc[]> {
    const rows = await this.db.query<DocRow>(
      `SELECT ${DOC_COLUMNS} FROM ${T_DOC}
       WHERE "workspaceId" = $1 AND "agentKind" = $2
       ORDER BY "createdAt" DESC`,
      [workspaceId, agentKind]
    );
    return rows.map(toDoc);
  }

  async getDocument(id: string, workspaceId: string): Promise<KnowledgeDoc | null> {
    const rows = await this.db.query<DocRow>(
      `SELECT ${DOC_COLUMNS} FROM ${T_DOC} WHERE "id" = $1 AND "workspaceId" = $2`,
      [id, workspaceId]
    );
    return rows[0] ? toDoc(rows[0]) : null;
  }

  /** Pega o documento pra processar e marca "processing". null = não existe ou já está pronto. */
  async claimForProcessing(id: string, workspaceId: string): Promise<(KnowledgeDoc & { data: Uint8Array }) | null> {
    const rows = await this.db.query<DocRow & { data: Uint8Array | null }>(
      `UPDATE ${T_DOC} SET "status" = 'processing', "errorCode" = NULL
       WHERE "id" = $1 AND "workspaceId" = $2 AND "status" IN ('queued', 'processing', 'error')
       RETURNING ${DOC_COLUMNS}, "data"`,
      [id, workspaceId]
    );
    const row = rows[0];
    if (!row || !row.data) return null;
    const { data, ...rest } = row;
    return { ...toDoc(rest), data: new Uint8Array(data) };
  }

  async markError(id: string, workspaceId: string, errorCode: string): Promise<void> {
    await this.db.query(
      `UPDATE ${T_DOC} SET "status" = 'error', "errorCode" = $3, "processedAt" = now()
       WHERE "id" = $1 AND "workspaceId" = $2`,
      [id, workspaceId, errorCode.slice(0, 60)]
    );
  }

  /**
   * Troca os pedaços do documento e marca "ready", tudo numa transação: a
   * busca nunca vê metade de um PDF.
   */
  async saveChunks(
    doc: Pick<KnowledgeDoc, "id" | "ownerUserId" | "workspaceId" | "agentKind" | "sessionId">,
    chunks: NewKnowledgeChunk[],
    info: { embeddingModel: string; embeddingTokens: number; pageCount: number }
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.query(`DELETE FROM ${T_CHUNK} WHERE "documentId" = $1 AND "workspaceId" = $2`, [doc.id, doc.workspaceId]);
      for (let i = 0; i < chunks.length; i += CHUNK_INSERT_BATCH) {
        const part = chunks.slice(i, i + CHUNK_INSERT_BATCH);
        const params: unknown[] = [];
        const values = part.map((chunk) => {
          const base = params.length;
          params.push(
            doc.id, doc.ownerUserId, doc.workspaceId, doc.agentKind, doc.sessionId,
            chunk.position, chunk.page, chunk.content, chunk.tokenEstimate,
            info.embeddingModel, this.vecLiteral(chunk.embedding)
          );
          const p = (n: number) => `$${base + n}`;
          return `(${p(1)}, ${p(2)}, ${p(3)}, ${p(4)}, ${p(5)}, ${p(6)}, ${p(7)}, ${p(8)}, ${p(9)}, ${p(10)}, ${p(11)}::${this.vecCast})`;
        });
        await tx.query(
          `INSERT INTO ${T_CHUNK} ("documentId", "ownerUserId", "workspaceId", "agentKind", "sessionId",
             "position", "page", "content", "tokenEstimate", "embeddingModel", "embedding")
           VALUES ${values.join(", ")}`,
          params
        );
      }
      await tx.query(
        `UPDATE ${T_DOC} SET "status" = 'ready', "errorCode" = NULL, "chunkCount" = $3,
           "embeddingModel" = $4, "embeddingTokens" = $5, "pageCount" = $6, "processedAt" = now()
         WHERE "id" = $1 AND "workspaceId" = $2`,
        [doc.id, doc.workspaceId, chunks.length, info.embeddingModel, info.embeddingTokens, info.pageCount]
      );
    });
  }

  /** Apaga o PDF e os pedaços dele (ON DELETE CASCADE). */
  async deleteDocument(id: string, workspaceId: string): Promise<boolean> {
    const rows = await this.db.query<{ id: string }>(
      `DELETE FROM ${T_DOC} WHERE "id" = $1 AND "workspaceId" = $2 RETURNING "id"`,
      [id, workspaceId]
    );
    return rows.length > 0;
  }

  // ─── Busca ─────────────────────────────────────────────────────────────────

  /** Os `limit` pedaços mais próximos (cosseno), sem limiar; o limiar fica em search.ts. */
  async nearestChunks(search: ChunkSearch): Promise<KnowledgeHit[]> {
    // Sem pgvector: a mesma conta (distância de cosseno) numa função SQL, sem índice.
    const distance =
      this.vectorMode === "array" ? `whatsapp.wa_cosine_distance(c."embedding", $1::real[])` : `c."embedding" <=> $1::vector`;
    const rows = await this.db.query<{
      chunkId: string;
      documentId: string;
      fileName: string;
      page: number;
      content: string;
      distance: number | string;
    }>(
      `SELECT c."id" AS "chunkId", c."documentId", d."fileName", c."page", c."content",
              (${distance}) AS "distance"
       FROM ${T_CHUNK} c
       JOIN ${T_DOC} d ON d."id" = c."documentId"
       WHERE c."workspaceId" = $2 AND c."agentKind" = $3 AND c."embeddingModel" = $4
         AND d."status" = 'ready'
         AND (c."sessionId" IS NULL OR c."sessionId" = $5)
       ORDER BY ${distance}
       LIMIT $6`,
      [this.vecLiteral(search.vector), search.workspaceId, search.agentKind, search.embeddingModel,
        search.sessionId ?? null, search.limit]
    );
    return rows.map((row) => ({
      chunkId: row.chunkId,
      documentId: row.documentId,
      fileName: row.fileName,
      page: Number(row.page),
      content: row.content,
      // distância de cosseno vai de 0 a 2; similaridade = 1 - distância
      score: 1 - Number(row.distance),
    }));
  }

  // ─── Memória do contato ────────────────────────────────────────────────────

  async getMemory(workspaceId: string, contactId: string): Promise<StoredContactMemory | null> {
    const rows = await this.db.query<StoredContactMemory & { updatedAt: Date | string }>(
      `SELECT "contactId", "ownerUserId", "workspaceId", "nome", "interesse", "objecao", "etapa",
              "observacao", "version", "updatedAt"
       FROM ${T_MEMORY} WHERE "workspaceId" = $1 AND "contactId" = $2`,
      [workspaceId, contactId]
    );
    const row = rows[0];
    if (!row) return null;
    return { ...row, etapa: row.etapa as ContactStage, version: Number(row.version), updatedAt: new Date(row.updatedAt) };
  }

  /**
   * Grava a memória. Com `expectedVersion`, só grava se ninguém mexeu antes
   * (devolve false quando outra atualização chegou primeiro).
   */
  async saveMemory(
    scope: CerebroScope,
    contactId: string,
    memory: ContactMemory,
    expectedVersion: number | null
  ): Promise<boolean> {
    const values = [scope.workspaceId, contactId, scope.ownerUserId, memory.nome, memory.interesse,
      memory.objecao, memory.etapa, memory.observacao];
    if (expectedVersion === null) {
      const rows = await this.db.query<{ version: number }>(
        `INSERT INTO ${T_MEMORY} ("workspaceId", "contactId", "ownerUserId", "nome", "interesse", "objecao", "etapa", "observacao")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT ("workspaceId", "contactId") DO NOTHING
         RETURNING "version"`,
        values
      );
      return rows.length > 0;
    }
    const rows = await this.db.query<{ version: number }>(
      `UPDATE ${T_MEMORY} SET "nome" = $3, "interesse" = $4, "objecao" = $5, "etapa" = $6,
         "observacao" = $7, "version" = "version" + 1, "updatedAt" = now()
       WHERE "workspaceId" = $1 AND "contactId" = $2 AND "version" = $8
       RETURNING "version"`,
      [scope.workspaceId, contactId, memory.nome, memory.interesse, memory.objecao, memory.etapa,
        memory.observacao, expectedVersion]
    );
    return rows.length > 0;
  }
}

/** Registro de gasto na tabela whatsapp."WaAiUsage". */
export class SqlUsageRecorder implements UsageRecorder {
  constructor(private readonly db: SqlExecutor) {}

  async record(entry: AiUsageEntry): Promise<void> {
    await this.db.query(
      `INSERT INTO ${T_USAGE} ("ownerUserId", "workspaceId", "kind", "provider", "model",
         "tokensIn", "tokensOut", "costMicroUsd", "refId", "agent")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'cerebro')`,
      [entry.ownerUserId, entry.workspaceId, entry.kind, entry.provider, entry.model,
        Math.max(0, Math.round(entry.tokensIn)), Math.max(0, Math.round(entry.tokensOut)),
        Math.max(0, Math.round(entry.costMicroUsd)), entry.refId ?? null]
    );
  }

  /** Gasto de hoje do dono, em micro dólares (pro teto diário). Dia em horário de Brasília. */
  async spentTodayMicroUsd(ownerUserId: string): Promise<number> {
    const rows = await this.db.query<{ total: string | number | null }>(
      `SELECT COALESCE(sum("costMicroUsd"), 0)::bigint AS total FROM ${T_USAGE}
       WHERE "ownerUserId" = $1
         AND "createdAt" >= (date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo')`,
      [ownerUserId]
    );
    return Number(rows[0]?.total ?? 0);
  }
}

