/**
 * Processa um PDF da fila: texto -> pedaços -> embeddings -> banco.
 * Roda no worker (nunca na requisição de envio).
 */
import { chunkPages } from "@/lib/whatsapp/cerebro/chunk";
import {
  EMBEDDING_DIMENSIONS,
  EmbeddingError,
  type EmbeddingProviderResolver,
} from "@/lib/whatsapp/cerebro/embeddings";
import { MAX_PDF_PAGES } from "@/lib/whatsapp/cerebro/limits";
import { extractPdfText, PdfError, type PdfText } from "@/lib/whatsapp/cerebro/pdf";
import type { CerebroStore } from "@/lib/whatsapp/cerebro/store";
import type { CerebroIngestJob, NewKnowledgeChunk, UsageRecorder } from "@/lib/whatsapp/cerebro/types";

/** Erro passageiro (rede, limite do provedor): a fila tenta de novo. */
export class RetryableIngestError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "RetryableIngestError";
  }
}

export interface IngestDeps {
  store: Pick<CerebroStore, "claimForProcessing" | "markError" | "saveChunks">;
  embedders: EmbeddingProviderResolver;
  usage?: UsageRecorder;
  /** Troca nos testes. */
  extract?: (bytes: Uint8Array, options: { maxPages: number }) => Promise<PdfText>;
}

export type IngestResult =
  | { status: "ready"; chunks: number; tokens: number; pageCount: number }
  | { status: "error"; errorCode: string }
  | { status: "skipped" };

export async function processKnowledgeDocument(job: CerebroIngestJob, deps: IngestDeps): Promise<IngestResult> {
  const doc = await deps.store.claimForProcessing(job.documentId, job.workspaceId);
  if (!doc) return { status: "skipped" };
  if (doc.ownerUserId !== job.ownerUserId) {
    // Job adulterado ou trocado: não processa com a chave de outra pessoa.
    await deps.store.markError(doc.id, doc.workspaceId, "owner_mismatch");
    return { status: "error", errorCode: "owner_mismatch" };
  }

  const fail = async (errorCode: string): Promise<IngestResult> => {
    await deps.store.markError(doc.id, doc.workspaceId, errorCode);
    return { status: "error", errorCode };
  };

  let text: PdfText;
  try {
    text = await (deps.extract ?? extractPdfText)(doc.data, { maxPages: MAX_PDF_PAGES });
  } catch (error) {
    return fail(error instanceof PdfError ? error.code : "pdf_invalid");
  }

  const pieces = chunkPages(text.pages);
  if (pieces.length === 0) return fail("pdf_no_text");

  const embedder = await deps.embedders.forOwner(doc.ownerUserId);
  if (!embedder) return fail("no_embedding_key");
  if (embedder.dimensions !== EMBEDDING_DIMENSIONS) return fail("embedding_dimensions");

  let vectors: number[][];
  let tokens: number;
  try {
    ({ vectors, tokens } = await embedder.embed(pieces.map((p) => p.content)));
  } catch (error) {
    if (error instanceof EmbeddingError) {
      if (error.code === "rate_limited" || error.code === "provider_error") {
        throw new RetryableIngestError(`embedding_${error.code}`);
      }
      return fail(`embedding_${error.code}`);
    }
    throw new RetryableIngestError("embedding_unknown");
  }
  if (vectors.length !== pieces.length) return fail("embedding_bad_response");

  if (deps.usage) {
    await deps.usage.record({
      ownerUserId: doc.ownerUserId,
      workspaceId: doc.workspaceId,
      kind: "embedding",
      provider: embedder.provider,
      model: embedder.model,
      tokensIn: tokens,
      tokensOut: 0,
      costMicroUsd: embedder.costMicroUsd(tokens),
      refId: doc.id,
    });
  }

  const chunks: NewKnowledgeChunk[] = pieces.map((piece, i) => ({ ...piece, embedding: vectors[i] }));
  await deps.store.saveChunks(doc, chunks, {
    embeddingModel: embedder.model,
    embeddingTokens: tokens,
    pageCount: text.pageCount,
  });
  return { status: "ready", chunks: chunks.length, tokens, pageCount: text.pageCount };
}
