/**
 * Montagem padrão do cérebro com o Prisma do Lead Engine.
 *
 * Quando juntar com a Fase 0:
 * - troque `prisma` por `prismaApp` (papel le_app, sem BYPASSRLS);
 * - registre a leitura da chave OpenAI do dono com `setOwnerOpenAIKeyLookup`
 *   (whatsapp."AiCredential", provider 'openai', decifrando `keyEnc`).
 */
import { prisma } from "@/lib/db/client";
import {
  createOpenAIEmbeddingProvider,
  type EmbeddingProvider,
  type EmbeddingProviderResolver,
} from "@/lib/whatsapp/cerebro/embeddings";
import type { IngestDeps } from "@/lib/whatsapp/cerebro/ingest";
import { createPrismaSqlExecutor, type PrismaRawLike, type SqlExecutor } from "@/lib/whatsapp/cerebro/sql";
import { CerebroStore, SqlUsageRecorder } from "@/lib/whatsapp/cerebro/store";

/** Devolve a chave OpenAI do dono (já decifrada) ou null. Nunca logar o valor. */
export type OwnerOpenAIKeyLookup = (ownerUserId: string) => Promise<string | null>;

let ownerKeyLookup: OwnerOpenAIKeyLookup = async () => null;

/** Liga o cérebro ao código de credenciais (Fase 1). Sem isso, PDF fica com erro no_embedding_key. */
export function setOwnerOpenAIKeyLookup(lookup: OwnerOpenAIKeyLookup) {
  ownerKeyLookup = lookup;
}

export const defaultEmbeddingResolver: EmbeddingProviderResolver = {
  async forOwner(ownerUserId: string): Promise<EmbeddingProvider | null> {
    const apiKey = await ownerKeyLookup(ownerUserId);
    return apiKey ? createOpenAIEmbeddingProvider({ apiKey }) : null;
  },
};

/** Executor com a RLS do usuário (`app.user_id`). */
export function sqlForUser(userId: string, settings?: Record<string, string>): SqlExecutor {
  return createPrismaSqlExecutor(prisma as unknown as PrismaRawLike, { userId, settings });
}

export function cerebroForUser(userId: string) {
  const db = sqlForUser(userId, { "hnsw.ef_search": "100" });
  return { store: new CerebroStore(db), usage: new SqlUsageRecorder(db) };
}

/** Dependências de um job da fila wa-cerebro (RLS do dono do job). */
export function ingestDepsFor(ownerUserId: string): IngestDeps {
  const { store, usage } = cerebroForUser(ownerUserId);
  return { store, usage, embedders: defaultEmbeddingResolver };
}
