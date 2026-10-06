/**
 * Tipos próprios do motor de agentes do WhatsApp.
 *
 * O motor não fala com o Prisma direto: tudo passa pela interface AgentStore.
 * Assim ele não depende da Fase 0 (multiusuário + schema "whatsapp"), que está
 * sendo feita em outro branch. Os nomes de campo seguem as tabelas do plano
 * (whatsapp.WaSession, WaConversation, WaMessage, WaAgentProfile, WaAgentRun,
 * AiCredential). Ver docs/whatsapp-agentes.md, seção "Integração com a Fase 0".
 *
 * Arquivo separado de lib/whatsapp/types.ts de propósito: os agentes do
 * conector e do cérebro também mexem em lib/whatsapp/, e assim ninguém briga
 * pelo mesmo arquivo no merge.
 */

/** Igual ao enum AgentMode do plano. */
export type AgentMode = "INHERIT" | "OFF" | "DRAFT" | "AUTO";
/** Igual ao enum SentBy do plano. */
export type SentBy = "CONTACT" | "USER_APP" | "USER_PHONE" | "AGENT";
export type WaProvider = "OPENWA" | "CLOUD_API";

export const AGENTES = ["qualificacao", "atendimento", "suporte"] as const;
export type AgenteTipo = (typeof AGENTES)[number];

export type IaProvider = "anthropic" | "openai";

export interface WaMessageLite {
  id: string;
  fromMe: boolean;
  sentBy: SentBy;
  type: string;
  body: string | null;
  sentAt: Date;
}

export interface ConversaContexto {
  ownerUserId: string;
  workspaceId: string;
  session: {
    id: string;
    provider: WaProvider;
    /** Padrão do número. */
    agentMode: AgentMode;
  };
  conversation: {
    id: string;
    agentMode: AgentMode;
    humanTakeoverUntil: Date | null;
    /** Modo de cada etiqueta aplicada na conversa. */
    labelModes: AgentMode[];
  };
  contact: {
    id: string;
    isGroup: boolean;
    /** Nome salvo e pushName, usados só pra tirar o nome da pessoa dos exemplos de tom. */
    name: string | null;
    pushName: string | null;
  };
  /** WaAgentProfile do número. */
  profile: AgentProfile | null;
  /** Últimas mensagens, da mais antiga pra mais nova. */
  historico: WaMessageLite[];
}

export interface AgentProfile {
  /** Comando base escrito pelo usuário: o que o negócio faz e o que pode prometer. */
  baseCommand: string;
  styleSummary: string | null;
  styleExamples: ExemploTom[] | null;
  quietHours: { start: string; end: string } | null;
  maxAutoPerDay: number;
  /**
   * Preços, prazos e links que o usuário cadastrou nas configurações. Junto com
   * os trechos do cérebro, é a única fonte que o agente pode citar.
   */
  fatosPermitidos?: string[];
  /** Fuso do número, pro horário de silêncio. Padrão America/Sao_Paulo. */
  timeZone?: string;
  /** Atraso humano antes da 1ª bolha no envio automático, em ms (padrão 20 a 90 s). */
  atrasoInicialMs?: { min: number; max: number } | null;
}

export interface ExemploTom {
  pergunta: string;
  resposta: string;
}

/** Configuração de um dos 3 agentes num número. */
export interface AgenteConfig {
  agente: AgenteTipo;
  ativo: boolean;
  provider: IaProvider;
  /** Se vazio, usa o padrão do provedor (Haiku 4.5 ou gpt-5-mini). */
  modelo?: string | null;
  /** Modelo pra caso difícil. Se vazio, Sonnet 5 na Anthropic e o mesmo mini na OpenAI. */
  modeloDificil?: string | null;
  /** Instrução extra do usuário pra esse agente. */
  instrucoes?: string | null;
}

/** Linha de whatsapp.AiCredential. keyEnc nunca sai do servidor. */
export interface AiCredentialRecord {
  id: string;
  ownerUserId: string;
  provider: IaProvider;
  keyEnc: string;
  keyLast4: string;
  dailyCap: number;
  createdAt: Date;
  revokedAt: Date | null;
}

/** O que pode ir pra tela ou pra API. */
export type AiCredentialPublica = Omit<AiCredentialRecord, "keyEnc">;

/** Trecho do cérebro (PDFs do usuário). Vem de outro módulo, por interface. */
export interface TrechoCerebro {
  texto: string;
  fonte: string;
  pagina?: number | null;
}

export interface BrainRetriever {
  buscar(input: {
    ownerUserId: string;
    sessionId: string;
    agente: AgenteTipo;
    consulta: string;
    limite: number;
  }): Promise<TrechoCerebro[]>;
}

/** Memória curta por contato, sem texto livre de terceiros além do necessário. */
export interface MemoriaContato {
  resumo: string | null;
  fatos: string[];
  ultimoAgente: AgenteTipo | null;
  atualizadoEm: Date | null;
}

export interface Uso {
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface GastoDia {
  custoUsdMicro: number;
  respostas: number;
  autoEnvios: number;
}

export type RunStatus = "pending" | "draft" | "approved" | "sent" | "rejected" | "blocked" | "error" | "skipped" | "handoff" | "scheduled";

/** whatsapp.WaAgentRun + colunas novas de prisma/migrations-wa/agentes. */
export interface AgentRunRecord {
  id?: string;
  ownerUserId: string;
  workspaceId: string;
  sessionId: string;
  conversationId: string;
  triggerMsgId: string;
  agente: AgenteTipo | null;
  mode: AgentMode;
  status: RunStatus;
  output: { bolhas: string[]; motivo?: string | null } | null;
  blockedReason: string | null;
  provider: IaProvider | null;
  model: string | null;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheWrite: number;
  custoUsdMicro: number;
  triagem: unknown;
  /** Quem aprovou o rascunho (id do usuário). null = o agente agendou sozinho. */
  approvedBy?: string | null;
  createdAt: Date;
}

/** Uma bolha com o atraso humano já sorteado. O conector faz o "digitando..." e envia. */
export interface EnvioPlanejado {
  texto: string;
  /** Espera antes de começar a digitar, contada do fim da bolha anterior. */
  esperaMs: number;
  /** Quanto tempo mostrar "digitando...". */
  digitandoMs: number;
}

export interface AgentStore {
  carregarContexto(conversationId: string): Promise<ConversaContexto | null>;
  configAgentes(ownerUserId: string, sessionId: string): Promise<AgenteConfig[]>;
  credencialAtiva(ownerUserId: string, provider: IaProvider): Promise<AiCredentialRecord | null>;
  salvarCredencial(rec: Omit<AiCredentialRecord, "id" | "createdAt" | "revokedAt">): Promise<AiCredentialRecord>;
  revogarCredencial(ownerUserId: string, id: string, now: Date): Promise<void>;
  listarCredenciais(ownerUserId: string): Promise<AiCredentialRecord[]>;
  /** Soma dos runs desde a meia-noite (no fuso do número) de um dono, de um workspace ou de um número. */
  gastoDoDia(escopo: { ownerUserId: string } | { workspaceId: string } | { sessionId: string }, desde: Date): Promise<GastoDia>;
  registrarRun(run: AgentRunRecord): Promise<string>;
  atualizarRun(id: string, patch: Partial<AgentRunRecord>): Promise<void>;
  buscarRun(id: string): Promise<AgentRunRecord | null>;
  /** Runs com status draft ou scheduled dessa conversa. */
  runsPendentes(conversationId: string): Promise<AgentRunRecord[]>;
  /** Entrega as bolhas pra fila do conector (wa-send). Devolve o id do job. */
  agendarEnvio(input: { runId: string; conversationId: string; sessionId: string; envios: EnvioPlanejado[] }): Promise<string>;
  /** Cancela jobs de envio ainda não enviados. Devolve quantos cancelou. */
  cancelarEnvios(conversationId: string): Promise<number>;
  definirTakeover(conversationId: string, ate: Date | null): Promise<void>;
  lerMemoria(contactId: string): Promise<MemoriaContato | null>;
  salvarMemoria(contactId: string, ownerUserId: string, memoria: MemoriaContato): Promise<void>;
  /**
   * Opcional: aprova o rascunho de forma atômica (só se ainda for "draft").
   * false = outra pessoa (ou outro clique) já tratou. Sem isso, dois cliques
   * ao mesmo tempo agendavam o envio duas vezes.
   */
  marcarAprovado?(runId: string, aprovadoPor: string, output: { bolhas: string[]; motivo?: string | null }): Promise<boolean>;
}

export interface Limites {
  /** Teto diário por usuário, em dólar. */
  tetoUsuarioUsd: number;
  /** Teto diário por workspace, em dólar. */
  tetoWorkspaceUsd: number;
}
