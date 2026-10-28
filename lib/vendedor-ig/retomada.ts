/**
 * Retomada (29/10/2026): o fluxo (automação) mandou a oferta e a pessoa não respondeu. Depois de ~3 horas o
 * vendedor puxa UMA conversa natural, só com a janela de 24 h da Meta aberta. Uma retomada por pessoa, nunca
 * com quem comprou, assumiu, pediu pra parar ou é resposta automática de loja. Aqui só regras puras e a busca
 * de candidatos; o texto e o envio passam pelo mesmo motor (travas, rascunho, limites).
 */
import { isTakeoverActive } from "@/lib/messaging/takeover";
import { isWindowOpen } from "@/lib/messaging/window";
import { emSilencio } from "@/lib/whatsapp/agentes/teto";
import type { VendedorConfig } from "./config";
import { pedidoDeParar, type Contagens, type Decisao, type EstadoContato } from "./regras";

export const PREFIXO_RETOMADA = "retomada:";
/** Devagar: no máximo uma retomada por rodada (a rodada é de 1 minuto). */
export const MAX_RETOMADAS_POR_RODADA = 1;
export const MAX_CANDIDATOS_RETOMADA = 100;
const HORA_MS = 3_600_000;
const DIA_MS = 24 * HORA_MS;

function semAcentos(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Pedaços (sem acento, minúsculos) típicos de resposta automática de loja. */
const MARCAS_AUTORRESPOSTA = [
  "agradecemos",
  "agradeco seu contato",
  "obrigad[oa] (pelo|pela) (contato|visita|mensagem)",
  "esta e uma confirmacao",
  "confirmacao de que recebemos",
  "mensagem automatica",
  "resposta automatica",
  "atendimento automatico",
  "seja bem[- ]?vind",
  "bem[- ]?vind[oa]s? (a|ao|as|aos) ",
  "atendimento",
  "atendente",
  "horario de funcionamento",
  "horario de atendimento",
  "wa\\.me",
  "link do whatsapp",
  "chama(r)? (a gente |a gnt )?no (whats|zap)",
  "nos chama no (whats|zap)",
  "fale conosco",
  "faremos o possivel",
  "responderemos",
  "retornaremos",
  "em breve",
  "logo (retornaremos|responderemos|te respondemos)",
  "recebemos (a sua|sua|a) mensagem",
];
const RE_AUTORRESPOSTA = new RegExp(MARCAS_AUTORRESPOSTA.join("|"));

/** A última mensagem da pessoa parece resposta automática de loja? (conservador: na dúvida, é autorresposta) */
export function ehAutoResposta(texto: string | null | undefined): boolean {
  const t = semAcentos(texto ?? "").replace(/\s+/g, " ");
  return Boolean(t) && RE_AUTORRESPOSTA.test(t);
}

export type EntradaRetomada = {
  now: Date;
  config: VendedorConfig;
  contato: EstadoContato;
  /** Nossa última mensagem na conversa (a que veio por último). null = a última é da pessoa ou não há conversa. */
  ultimaNossa: { speaker: string; sentAt: Date } | null;
  /** Texto da última mensagem escrita pela pessoa (pode ser antiga ou nenhuma). */
  ultimaDaPessoaTexto: string | null;
  temRascunhoPendente: boolean;
  paradoAntes: boolean;
  /** O vendedor já mandou (ou deixou rascunho) pra essa pessoa alguma vez. */
  jaTeveVendedor: boolean;
  temTagCompra: boolean;
  contagens: Contagens;
  /** Retomadas enviadas na última hora na conta. */
  retomadasNaHora: number;
};

export function decidirRetomada(i: EntradaRetomada): Decisao {
  const { now, config, contato } = i;
  if (!i.ultimaNossa) return { acao: "esperar", motivo: "a última mensagem não é nossa" };
  if (i.ultimaNossa.speaker !== "flow") return { acao: "pular", motivo: "retomada: a nossa última mensagem não foi do fluxo" };

  // Travas duras (a conversa não é do vendedor, ou a pessoa não quer).
  if (isTakeoverActive(contato, now)) return { acao: "pular", motivo: "retomada: conversa assumida por você (takeover)" };
  if (!isWindowOpen({ lastInboundAt: contato.lastInboundAt }, now)) return { acao: "pular", motivo: "retomada: janela de 24 h fechada" };
  if (i.paradoAntes || contato.broadcastOptOutAt) return { acao: "pular", motivo: "retomada: a pessoa já pediu pra parar" };
  if (pedidoDeParar(i.ultimaDaPessoaTexto)) return { acao: "pular", motivo: "retomada: a pessoa pediu pra parar" };
  if (i.jaTeveVendedor) return { acao: "pular", motivo: "retomada: o vendedor já falou com essa pessoa (uma retomada por pessoa)" };
  if (i.temTagCompra) return { acao: "pular", motivo: "retomada: a pessoa já comprou" };
  if (ehAutoResposta(i.ultimaDaPessoaTexto)) return { acao: "pular", motivo: "retomada: a última mensagem dela parece resposta automática de loja" };
  if (i.temRascunhoPendente) return { acao: "pular", motivo: "retomada: já existe um rascunho esperando você" };

  // Devagar: só depois de retomadaHoras desde a mensagem do fluxo.
  if (now.getTime() - i.ultimaNossa.sentAt.getTime() < config.retomadaHoras * HORA_MS) return { acao: "esperar", motivo: `retomada: ainda não passaram ${config.retomadaHoras} h` };

  // Limites e ritmo (os mesmos da resposta, mais o da retomada): passou, espera.
  if (config.quietStart && config.quietEnd && emSilencio(now, { start: config.quietStart, end: config.quietEnd })) return { acao: "esperar", motivo: "horário de silêncio" };
  if (i.contagens.pessoaDia >= config.maxPerPersonDay) return { acao: "esperar", motivo: `limite de ${config.maxPerPersonDay} por pessoa por dia` };
  if (i.contagens.dia >= config.maxPerDay) return { acao: "esperar", motivo: `limite de ${config.maxPerDay} por dia` };
  if (i.contagens.hora >= config.maxPerHour) return { acao: "esperar", motivo: `limite de ${config.maxPerHour} por hora` };
  if (i.retomadasNaHora >= config.retomadaMaxPorHora) return { acao: "esperar", motivo: `limite de ${config.retomadaMaxPorHora} retomadas por hora` };
  const gap = config.minGapSeconds * 1000;
  if (i.contagens.ultimoEnvioEm && now.getTime() - i.contagens.ultimoEnvioEm.getTime() < gap) return { acao: "esperar", motivo: "fila: outra conversa acabou de ser atendida" };
  return { acao: "responder" };
}

export type ContatoRetomada = { id: string; workspaceId: string; igUserId: string; username: string | null; name: string | null; notes: string | null; lastInboundAt: Date | null; lastOutboundAt: Date | null };

/** Subconjunto do prisma que a busca usa (facilita o teste). */
export interface BancoRetomada {
  contact: { findMany(args: unknown): Promise<ContatoRetomada[]> };
  vendedorIgLog: { findMany(args: unknown): Promise<{ contactId: string }[]> };
  contactTag: { findMany(args: unknown): Promise<{ contactId: string }[]> };
}

/**
 * Candidatos: janela aberta, nossa última mensagem é posterior à da pessoa, passaram as horas, sem registro do
 * vendedor, sem tag de compra. A mensagem ser do fluxo e não ser autorresposta é conferido depois (precisa da conversa).
 */
export async function buscarCandidatosRetomada(db: BancoRetomada, contaId: string, config: Pick<VendedorConfig, "retomadaHoras">, now: Date): Promise<ContatoRetomada[]> {
  const rows = await db.contact.findMany({
    where: {
      instagramAccountId: contaId,
      broadcastOptOutAt: null,
      lastInboundAt: { gte: new Date(now.getTime() - DIA_MS) },
      lastOutboundAt: { lte: new Date(now.getTime() - config.retomadaHoras * HORA_MS) },
    },
    orderBy: { lastInboundAt: "asc" },
    take: MAX_CANDIDATOS_RETOMADA,
    select: { id: true, workspaceId: true, igUserId: true, username: true, name: true, notes: true, lastInboundAt: true, lastOutboundAt: true },
  });
  const certos = rows.filter((c) => c.lastInboundAt && c.lastOutboundAt && c.lastOutboundAt >= c.lastInboundAt);
  if (certos.length === 0) return [];
  const ids = certos.map((c) => c.id);
  const [logs, compras] = await Promise.all([
    db.vendedorIgLog.findMany({ where: { contactId: { in: ids }, outcome: { in: ["sent", "sending", "draft"] } }, select: { contactId: true } }),
    db.contactTag.findMany({ where: { contactId: { in: ids }, name: { startsWith: "comprou:" } }, select: { contactId: true } }),
  ]);
  const fora = new Set([...logs.map((l) => l.contactId), ...compras.map((t) => t.contactId)]);
  return certos.filter((c) => !fora.has(c.id));
}
