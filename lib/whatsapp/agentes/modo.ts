/**
 * Liga e desliga em camadas, "Assumir" e janela de 24h.
 *
 * Ordem: conversa > etiqueta > número. "Desligado" em qualquer camada ganha.
 * O padrão é RASCUNHO: o agente só envia sozinho (AUTO) quando o usuário liga
 * isso de propósito numa conversa ou numa etiqueta. AUTO no número inteiro
 * vale como rascunho.
 *
 * "Assumir" (botão, ou o usuário responder pelo celular ou pelo inbox) pausa o
 * agente na conversa, cancela os envios já agendados e descarta os rascunhos
 * pendentes.
 */
import type { AgentMode, AgentStore, ConversaContexto, SentBy } from "./types";

export const JANELA_MS = 24 * 60 * 60 * 1000;
export const TAKEOVER_HORAS_PADRAO = 24;
export const TAKEOVER_HORAS_MAX = 24 * 7;

export type ModoEfetivo = "OFF" | "DRAFT" | "AUTO";

export interface ResultadoModo {
  modo: ModoEfetivo;
  motivo: string;
}

export function takeoverAtivo(ate: Date | null, now: Date): boolean {
  return Boolean(ate && ate.getTime() > now.getTime());
}

export function resolverModo(ctx: Pick<ConversaContexto, "session" | "conversation">, now: Date): ResultadoModo {
  if (takeoverAtivo(ctx.conversation.humanTakeoverUntil, now)) {
    return { modo: "OFF", motivo: "você assumiu essa conversa" };
  }
  const conversa = ctx.conversation.agentMode;
  const etiquetas = ctx.conversation.labelModes.filter((m) => m !== "INHERIT");
  const numero = ctx.session.agentMode;

  if (conversa === "OFF") return { modo: "OFF", motivo: "agente desligado nessa conversa" };
  if (etiquetas.includes("OFF")) return { modo: "OFF", motivo: "uma etiqueta da conversa desliga o agente" };
  if (numero === "OFF" || numero === "INHERIT") return { modo: "OFF", motivo: "agente desligado no número" };

  if (conversa === "AUTO") return { modo: "AUTO", motivo: "envio automático ligado na conversa" };
  if (conversa === "DRAFT") return { modo: "DRAFT", motivo: "rascunho na conversa" };
  if (etiquetas.includes("DRAFT")) return { modo: "DRAFT", motivo: "rascunho pela etiqueta" };
  if (etiquetas.includes("AUTO")) return { modo: "AUTO", motivo: "envio automático pela etiqueta" };
  return { modo: "DRAFT", motivo: "rascunho (padrão do número)" };
}

/** A última mensagem do contato ainda abre a janela de 24h até o fim do envio planejado? */
export function janelaAberta(ultimaDoContato: Date | null, now: Date, duracaoMs = 0): boolean {
  if (!ultimaDoContato) return false;
  return now.getTime() + duracaoMs < ultimaDoContato.getTime() + JANELA_MS;
}

function clampHoras(h: number | undefined): number {
  const n = Number(h ?? TAKEOVER_HORAS_PADRAO);
  if (!Number.isFinite(n) || n <= 0) return TAKEOVER_HORAS_PADRAO;
  return Math.min(TAKEOVER_HORAS_MAX, Math.max(1, Math.round(n)));
}

/** Pausa o agente na conversa e para tudo que estava na fila. */
export async function assumirConversa(
  store: AgentStore,
  conversationId: string,
  opcoes: { now?: Date; horas?: number; motivo?: string } = {}
): Promise<{ ate: Date; enviosCancelados: number; rascunhosDescartados: number }> {
  const now = opcoes.now ?? new Date();
  const ate = new Date(now.getTime() + clampHoras(opcoes.horas) * 60 * 60 * 1000);
  // Primeiro a trava, depois a fila: um envio que acorde no meio já vê o takeover.
  await store.definirTakeover(conversationId, ate);
  const enviosCancelados = await store.cancelarEnvios(conversationId);
  let rascunhosDescartados = 0;
  for (const run of await store.runsPendentes(conversationId)) {
    if (!run.id) continue;
    await store.atualizarRun(run.id, { status: "rejected", blockedReason: opcoes.motivo ?? "você assumiu a conversa" });
    rascunhosDescartados++;
  }
  return { ate, enviosCancelados, rascunhosDescartados };
}

export async function devolverAoAgente(store: AgentStore, conversationId: string): Promise<void> {
  await store.definirTakeover(conversationId, null);
}

/** Chamar quando chega uma mensagem do próprio usuário (celular ou inbox). */
export async function aoMensagemDoUsuario(
  store: AgentStore,
  conversationId: string,
  sentBy: SentBy,
  opcoes: { now?: Date; horas?: number } = {}
): Promise<boolean> {
  if (sentBy !== "USER_PHONE" && sentBy !== "USER_APP") return false;
  await assumirConversa(store, conversationId, { ...opcoes, motivo: "você respondeu pelo celular ou pelo inbox" });
  return true;
}

/**
 * Chamar quando o contato manda outra mensagem: cancela o que estava esperando
 * pra sair e descarta o rascunho antigo. Depois disso o worker roda o motor de
 * novo com a mensagem nova.
 */
export async function aoMensagemDoContato(store: AgentStore, conversationId: string): Promise<number> {
  const cancelados = await store.cancelarEnvios(conversationId);
  for (const run of await store.runsPendentes(conversationId)) {
    if (run.id) await store.atualizarRun(run.id, { status: "rejected", blockedReason: "o contato mandou mensagem nova" });
  }
  return cancelados;
}

export function modoValido(m: unknown): m is AgentMode {
  return m === "INHERIT" || m === "OFF" || m === "DRAFT" || m === "AUTO";
}
