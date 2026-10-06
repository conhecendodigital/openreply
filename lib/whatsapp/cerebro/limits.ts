/** Limites do cérebro num lugar só (rota, fila e testes usam os mesmos). */

/**
 * Tamanho máximo de um PDF enviado. Fica abaixo dos 10 MB que o proxy.ts do
 * Next guarda do corpo (proxyClientMaxBodySize): acima disso o corpo chegaria
 * cortado na rota.
 */
export const MAX_PDF_BYTES = 8 * 1024 * 1024;
/** Corpo máximo da requisição de envio (PDF + campos do formulário). */
export const MAX_UPLOAD_BODY_BYTES = MAX_PDF_BYTES + 256 * 1024;
/** Páginas máximas de um PDF. */
export const MAX_PDF_PAGES = 200;
/** Texto máximo aproveitado de um PDF (o resto é ignorado). ~ 250 mil tokens. */
export const MAX_PDF_TEXT_CHARS = 1_000_000;
/** PDFs por agente (por workspace). */
export const MAX_DOCS_PER_AGENT = 30;
/** Envios por pessoa por hora. */
export const UPLOAD_RATE_LIMIT = { limit: 30, windowSeconds: 60 * 60 };

/** Pedaços: tamanho alvo e sobreposição, em caracteres. */
export const CHUNK_SIZE_CHARS = 1200;
export const CHUNK_OVERLAP_CHARS = 200;
/** Pedaços máximos por documento (protege o gasto de embedding). */
export const MAX_CHUNKS_PER_DOC = 1500;

/** Busca: de 3 a 5 trechos, só acima do limiar de similaridade. */
export const SEARCH_MIN_K = 3;
export const SEARCH_MAX_K = 5;
export const SEARCH_DEFAULT_K = 4;
export const SEARCH_DEFAULT_MIN_SCORE = 0.3;
/** Texto máximo dos trechos que entra no Comando do agente. */
export const SEARCH_CONTEXT_MAX_CHARS = 4000;

/** Memória do contato. */
export const MEMORY_FIELD_MAX = {
  nome: 60,
  interesse: 200,
  objecao: 200,
  observacao: 240,
} as const;
/** Tamanho máximo da memória já escrita pro Comando. */
export const MEMORY_RENDER_MAX_CHARS = 800;
/** Mensagens recentes que entram no Comando que atualiza a memória. */
export const MEMORY_MAX_MESSAGES = 20;
export const MEMORY_MAX_MESSAGE_CHARS = 500;
