/**
 * Montagem padrão do cérebro com o Prisma do Lead Engine.
 *
 * - Cliente do papel da aplicação (getAppPrisma da Fase 0): o executor marca
 *   app.user_id, app.workspace_id e troca pro papel le_app em toda transação.
 * - Chave do embedding: a chave OpenAI cadastrada no /admin
 *   (PlatformAiCredential, lib/ai/credentials.ts), a mesma de todos os
 *   usuários do beta. Sem chave OpenAI no /admin, o PDF termina com erro
 *   no_embedding_key (a tela avisa). A Anthropic não vende embedding.
 * - pgvector ou não: o tipo da coluna é lido uma vez por processo.
 */
import { getAiCredential } from "@/lib/ai/credentials";
import { getAppPrisma } from "@/lib/db/rls";
import {
  createOpenAIEmbeddingProvider,
  type EmbeddingProvider,
  type EmbeddingProviderResolver,
} from "@/lib/whatsapp/cerebro/embeddings";
import type { IngestDeps } from "@/lib/whatsapp/cerebro/ingest";
import { createPrismaSqlExecutor, type PrismaRawLike, type SqlExecutor } from "@/lib/whatsapp/cerebro/sql";
import { CerebroStore, detectVectorMode, SqlUsageRecorder, type VectorMode } from "@/lib/whatsapp/cerebro/store";

/** Devolve a chave OpenAI (já decifrada) ou null. Nunca logar o valor. */
export type OwnerOpenAIKeyLookup = (ownerUserId: string) => Promise<string | null>;

let ownerKeyLookup: OwnerOpenAIKeyLookup = async () => (await getAiCredential("openai"))?.apiKey ?? null;

/** Troca de onde vem a chave (testes, ou chave por dono no futuro). */
export function setOwnerOpenAIKeyLookup(lookup: OwnerOpenAIKeyLookup) {
  ownerKeyLookup = lookup;
}

export const defaultEmbeddingResolver: EmbeddingProviderResolver = {
  async forOwner(ownerUserId: string): Promise<EmbeddingProvider | null> {
    const apiKey = await ownerKeyLookup(ownerUserId);
    return apiKey ? createOpenAIEmbeddingProvider({ apiKey }) : null;
  },
};

/**
 * Executor com a RLS do usuário e do workspace ativo (`app.user_id`,
 * `app.workspace_id`) e o papel le_app, igual ao withRls() da Fase 0.
 */
export function sqlForUser(userId: string, workspaceId: string, settings?: Record<string, string>): SqlExecutor {
  return createPrismaSqlExecutor(getAppPrisma() as unknown as PrismaRawLike, { userId, workspaceId, settings });
}

let vectorMode: Promise<VectorMode> | null = null;

/** Tipo da coluna "embedding" (pgvector ou real[]), lido uma vez. */
export function cerebroVectorMode(db: SqlExecutor): Promise<VectorMode> {
  if (!vectorMode) {
    vectorMode = detectVectorMode(db).catch((error) => {
      vectorMode = null;
      throw error;
    });
  }
  return vectorMode;
}

export async function cerebroForUser(userId: string, workspaceId: string) {
  const db = sqlForUser(userId, workspaceId, { "hnsw.ef_search": "100" });
  const plain = sqlForUser(userId, workspaceId);
  const mode = await cerebroVectorMode(plain);
  // hnsw.ef_search só existe com pgvector; sem ele, set_config de nome desconhecido também funciona,
  // mas fica de fora pra não poluir a sessão.
  return { store: new CerebroStore(mode === "pgvector" ? db : plain, mode), usage: new SqlUsageRecorder(plain), mode };
}

/** Dependências de um job da fila wa-cerebro (RLS do dono e do workspace do job). */
export async function ingestDepsFor(ownerUserId: string, workspaceId: string): Promise<IngestDeps> {
  const { store, usage } = await cerebroForUser(ownerUserId, workspaceId);
  return { store, usage, embedders: defaultEmbeddingResolver };
}
