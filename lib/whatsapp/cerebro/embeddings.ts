/**
 * Embeddings do cérebro.
 *
 * Padrão: OpenAI `text-embedding-3-small` (1536 dimensões) com a chave de API
 * do dono do workspace. Chamada por `fetch` direto (sem SDK novo) e sempre em
 * https://api.openai.com: a variável OPENAI_BASE_URL do ambiente é ignorada de
 * propósito (numa máquina com Ollama ela aponta pro modelo local).
 *
 * Trocar por modelo local depois: implemente `EmbeddingProvider` (por exemplo,
 * Ollama em /v1/embeddings, que fala o mesmo formato, passando `baseUrl`) com
 * as mesmas `EMBEDDING_DIMENSIONS`, ou crie uma coluna nova na migração. Cada
 * pedaço guarda o nome do modelo, e a busca só compara vetores do mesmo modelo.
 */

/** Dimensões da coluna `embedding` em whatsapp."WaKnowledgeChunk". */
export const EMBEDDING_DIMENSIONS = 1536;
export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
const OPENAI_BASE_URL = "https://api.openai.com/v1";

/** Preço por 1 milhão de tokens, em micro dólares (US$ 0,02 = 20.000). */
const PRICE_MICRO_USD_PER_MTOKENS: Record<string, number> = {
  "text-embedding-3-small": 20_000,
  "text-embedding-3-large": 130_000,
};

export interface EmbeddingResult {
  vectors: number[][];
  /** Tokens cobrados (o que o provedor informou). */
  tokens: number;
}

export interface EmbeddingProvider {
  /** openai | local | ... */
  readonly provider: string;
  readonly model: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<EmbeddingResult>;
  /** Custo estimado em micro dólares pra `tokens` tokens. */
  costMicroUsd(tokens: number): number;
}

export class EmbeddingError extends Error {
  constructor(
    public readonly code: "no_key" | "auth" | "rate_limited" | "bad_response" | "provider_error" | "dimensions",
    message?: string
  ) {
    super(message ?? code);
    this.name = "EmbeddingError";
  }
}

export interface OpenAIEmbeddingOptions {
  apiKey: string;
  model?: string;
  dimensions?: number;
  /** Só pra um servidor compatível (ex.: Ollama local). Padrão: api.openai.com. */
  baseUrl?: string;
  /** Textos por chamada. */
  batchSize?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createOpenAIEmbeddingProvider(options: OpenAIEmbeddingOptions): EmbeddingProvider {
  if (!options.apiKey) throw new EmbeddingError("no_key");
  const model = options.model ?? DEFAULT_EMBEDDING_MODEL;
  const dimensions = options.dimensions ?? EMBEDDING_DIMENSIONS;
  const baseUrl = (options.baseUrl ?? OPENAI_BASE_URL).replace(/\/+$/, "");
  const batchSize = Math.min(Math.max(1, options.batchSize ?? 64), 256);
  const doFetch = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const maxRetries = options.maxRetries ?? 2;
  const price = PRICE_MICRO_USD_PER_MTOKENS[model] ?? 0;

  async function callOnce(input: string[]): Promise<EmbeddingResult> {
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await doFetch(`${baseUrl}/embeddings`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${options.apiKey}`,
          },
          body: JSON.stringify({
            model,
            input,
            encoding_format: "float",
            // Só os modelos -3 aceitam reduzir dimensões.
            ...(model.startsWith("text-embedding-3") ? { dimensions } : {}),
          }),
          signal: AbortSignal.timeout(60_000),
        });
      } catch {
        if (attempt < maxRetries) {
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        throw new EmbeddingError("provider_error", "Falha de rede ao gerar embeddings");
      }

      if (response.status === 401 || response.status === 403) {
        throw new EmbeddingError("auth", "A chave de API foi recusada pelo provedor");
      }
      if (response.status === 429 || response.status >= 500) {
        if (attempt < maxRetries) {
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        throw new EmbeddingError(response.status === 429 ? "rate_limited" : "provider_error", `Provedor respondeu ${response.status}`);
      }
      if (!response.ok) {
        // Nunca repassa o corpo: pode ecoar parte do pedido.
        throw new EmbeddingError("provider_error", `Provedor respondeu ${response.status}`);
      }

      const json = (await response.json().catch(() => null)) as {
        data?: { index?: number; embedding?: unknown }[];
        usage?: { prompt_tokens?: number; total_tokens?: number };
      } | null;
      const data = json?.data;
      if (!Array.isArray(data) || data.length !== input.length) throw new EmbeddingError("bad_response");
      const vectors: number[][] = new Array(input.length);
      for (const item of data) {
        const index = item.index;
        const embedding = item.embedding;
        if (typeof index !== "number" || index < 0 || index >= input.length || !Array.isArray(embedding)) {
          throw new EmbeddingError("bad_response");
        }
        if (embedding.length !== dimensions || !embedding.every((v) => typeof v === "number" && Number.isFinite(v))) {
          throw new EmbeddingError("dimensions");
        }
        vectors[index] = embedding as number[];
      }
      if (vectors.some((v) => !v)) throw new EmbeddingError("bad_response");
      const tokens = json?.usage?.prompt_tokens ?? json?.usage?.total_tokens ?? 0;
      return { vectors, tokens };
    }
  }

  return {
    provider: options.baseUrl ? "openai_compatible" : "openai",
    model,
    dimensions,
    costMicroUsd: (tokens) => Math.ceil((tokens * price) / 1_000_000),
    async embed(texts) {
      const vectors: number[][] = [];
      let tokens = 0;
      for (let i = 0; i < texts.length; i += batchSize) {
        const part = await callOnce(texts.slice(i, i + batchSize));
        vectors.push(...part.vectors);
        tokens += part.tokens;
      }
      return { vectors, tokens };
    },
  };
}

/**
 * De onde vem a chave do dono. Na Fase 0/1 isso lê whatsapp."AiCredential"
 * (provider = 'openai', revokedAt null) e decifra `keyEnc`. Aqui fica só o
 * contrato, pra o cérebro não depender do código de credenciais.
 */
export interface EmbeddingProviderResolver {
  forOwner(ownerUserId: string): Promise<EmbeddingProvider | null>;
}

/** Converte um vetor pro formato literal do pgvector: '[0.1,0.2,...]'. */
export function toVectorLiteral(vector: number[]): string {
  if (!vector.every((v) => typeof v === "number" && Number.isFinite(v))) {
    throw new EmbeddingError("bad_response");
  }
  return `[${vector.join(",")}]`;
}
