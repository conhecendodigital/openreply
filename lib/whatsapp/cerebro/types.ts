/**
 * Cérebro dos agentes de WhatsApp: base de conhecimento (PDFs -> pedaços com
 * embedding em pgvector) e memória curta por contato.
 *
 * Tipos próprios do cérebro, escritos contra as tabelas SQL de
 * prisma/migrations-wa/cerebro/ (schema "whatsapp"). Nada aqui depende do
 * cliente Prisma gerado, pra não brigar com a Fase 0 (multiusuário). Ver
 * lib/whatsapp/cerebro/README.md, seção "Quando juntar com a Fase 0".
 */

/** Os 3 agentes do plano. Cada um tem a sua base de conhecimento. */
export const AGENT_KINDS = ["qualificacao", "atendimento", "suporte"] as const;
export type AgentKind = (typeof AGENT_KINDS)[number];

export function isAgentKind(value: unknown): value is AgentKind {
  return typeof value === "string" && (AGENT_KINDS as readonly string[]).includes(value);
}

/** Quem é dono do dado. Toda linha do cérebro carrega os dois. */
export interface CerebroScope {
  ownerUserId: string;
  workspaceId: string;
}

export type KnowledgeDocStatus = "queued" | "processing" | "ready" | "error";

export interface KnowledgeDoc {
  id: string;
  ownerUserId: string;
  workspaceId: string;
  agentKind: AgentKind;
  /** Número específico (WaSession.id) ou null = vale pra todos os números do workspace. */
  sessionId: string | null;
  fileName: string;
  sizeBytes: number;
  pageCount: number | null;
  status: KnowledgeDocStatus;
  /** Código curto do erro (pdf_encrypted, pdf_no_text, too_many_pages, embedding_failed...). */
  errorCode: string | null;
  chunkCount: number;
  embeddingModel: string | null;
  embeddingTokens: number;
  createdAt: Date;
  processedAt: Date | null;
}

export interface NewKnowledgeChunk {
  position: number;
  /** Página onde o pedaço começa (1 = primeira). */
  page: number;
  content: string;
  tokenEstimate: number;
  embedding: number[];
}

export interface KnowledgeHit {
  chunkId: string;
  documentId: string;
  fileName: string;
  page: number;
  content: string;
  /** Similaridade de cosseno, 0 a 1 (1 = idêntico). */
  score: number;
}

/** Etapas do contato no funil. Curtas de propósito. */
export const CONTACT_STAGES = [
  "novo",
  "qualificando",
  "interessado",
  "negociando",
  "cliente",
  "suporte",
  "perdido",
] as const;
export type ContactStage = (typeof CONTACT_STAGES)[number];

/** Resumo curto do contato que o agente lê antes de responder. */
export interface ContactMemory {
  nome: string | null;
  interesse: string | null;
  objecao: string | null;
  etapa: ContactStage;
  /** Um fato útil a mais (ex.: "prefere áudio", "volta dia 10"). */
  observacao: string | null;
}

export interface StoredContactMemory extends ContactMemory {
  contactId: string;
  ownerUserId: string;
  workspaceId: string;
  version: number;
  updatedAt: Date;
}

/** Linha do registro de gasto de IA (tokens e custo estimado). */
export interface AiUsageEntry extends CerebroScope {
  /** embedding | memory | ... */
  kind: string;
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  /** Custo estimado em micro dólares (1 = US$ 0,000001). */
  costMicroUsd: number;
  /** Ex.: id do documento ou do contato. */
  refId?: string | null;
}

export interface UsageRecorder {
  record(entry: AiUsageEntry): Promise<void>;
}

/** Job da fila wa-cerebro: processar um PDF já salvo. */
export interface CerebroIngestJob {
  documentId: string;
  ownerUserId: string;
  workspaceId: string;
}
