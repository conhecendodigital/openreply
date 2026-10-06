/**
 * Teto diário de gasto (por usuário e por workspace), teto de respostas da
 * chave (AiCredential.dailyCap) e teto de envios automáticos do número
 * (WaAgentProfile.maxAutoPerDay). O dia vira à meia-noite no fuso do número.
 *
 * Antes de chamar o modelo, confere com o pior caso (sem cache, saída cheia).
 * Assim a última chamada do dia nunca passa do teto.
 */
import type { AgentStore, Limites } from "./types";

export const TETO_USUARIO_PADRAO_USD = 1;
export const TETO_WORKSPACE_PADRAO_USD = 3;
export const FUSO_PADRAO = "America/Sao_Paulo";

function numeroEnv(nome: string, padrao: number): number {
  const v = Number.parseFloat(process.env[nome] ?? "");
  return Number.isFinite(v) && v >= 0 ? v : padrao;
}

export function limitesDoAmbiente(): Limites {
  return {
    tetoUsuarioUsd: numeroEnv("WA_TETO_DIARIO_USUARIO_USD", TETO_USUARIO_PADRAO_USD),
    tetoWorkspaceUsd: numeroEnv("WA_TETO_DIARIO_WORKSPACE_USD", TETO_WORKSPACE_PADRAO_USD),
  };
}

/** Meia-noite de hoje no fuso, como Date em UTC. */
export function inicioDoDia(now: Date, timeZone = FUSO_PADRAO): Date {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const p = (t: string) => Number(partes.find((x) => x.type === t)?.value ?? 0);
  const localComoUtc = Date.UTC(p("year"), p("month") - 1, p("day"), p("hour"), p("minute"), p("second"));
  const offset = localComoUtc - Math.floor(now.getTime() / 1000) * 1000;
  return new Date(Date.UTC(p("year"), p("month") - 1, p("day")) - offset);
}

/** Hora local "HH:MM" dentro do intervalo de silêncio (aceita virar a noite, ex.: 21:00 a 08:00). */
export function emSilencio(now: Date, quiet: { start: string; end: string } | null | undefined, timeZone = FUSO_PADRAO): boolean {
  if (!quiet?.start || !quiet?.end) return false;
  const hm = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
  const min = (s: string) => {
    const [h, m] = s.split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const agora = min(hm);
  const ini = min(quiet.start);
  const fim = min(quiet.end);
  if (ini === fim) return false;
  return ini < fim ? agora >= ini && agora < fim : agora >= ini || agora < fim;
}

export type MotivoTeto = "teto_usuario" | "teto_workspace" | "limite_respostas";

export function mensagemTeto(m: MotivoTeto | "limite_auto"): string {
  switch (m) {
    case "teto_usuario":
      return "O teto diário de gasto com IA desse usuário foi atingido. O agente volta amanhã.";
    case "teto_workspace":
      return "O teto diário de gasto com IA do workspace foi atingido. O agente volta amanhã.";
    case "limite_respostas":
      return "A chave de IA chegou no limite de respostas do dia.";
    default:
      return "O número chegou no limite de envios automáticos do dia. As próximas respostas ficam como rascunho.";
  }
}

export async function conferirTeto(
  store: AgentStore,
  input: { ownerUserId: string; workspaceId: string; dailyCap: number; custoPrevistoUsdMicro: number; now: Date; timeZone?: string },
  limites: Limites
): Promise<{ ok: true } | { ok: false; motivo: MotivoTeto }> {
  const desde = inicioDoDia(input.now, input.timeZone);
  const usuario = await store.gastoDoDia({ ownerUserId: input.ownerUserId }, desde);
  if (usuario.respostas >= input.dailyCap) return { ok: false, motivo: "limite_respostas" };
  if (usuario.custoUsdMicro + input.custoPrevistoUsdMicro > limites.tetoUsuarioUsd * 1_000_000) {
    return { ok: false, motivo: "teto_usuario" };
  }
  const ws = await store.gastoDoDia({ workspaceId: input.workspaceId }, desde);
  if (ws.custoUsdMicro + input.custoPrevistoUsdMicro > limites.tetoWorkspaceUsd * 1_000_000) {
    return { ok: false, motivo: "teto_workspace" };
  }
  return { ok: true };
}

export async function autoEnviosHoje(store: AgentStore, sessionId: string, now: Date, timeZone?: string): Promise<number> {
  return (await store.gastoDoDia({ sessionId }, inicioDoDia(now, timeZone))).autoEnvios;
}
