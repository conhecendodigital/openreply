/**
 * Regras do modo automático (puras, sem banco): decide se o vendedor responde, espera, pula ou para.
 * Tudo que NÃO é "responder" deixa a conversa pro dono ou pro rascunho; nada sai sem passar aqui.
 */
import { needsReply } from "@/lib/inbox/needs-reply";
import { isTakeoverActive } from "@/lib/messaging/takeover";
import { isWindowOpen } from "@/lib/messaging/window";
import { emSilencio } from "@/lib/whatsapp/agentes/teto";
import { pediuPraParar } from "@/lib/whatsapp/agentes/triagem";
import type { VendedorConfig } from "./config";

export type MsgLite = { mid: string; fromMe: boolean; text: string | null; storyReply: boolean; sentAt: Date };

export type EstadoContato = {
  lastInboundAt: Date | null;
  humanTakeover: boolean;
  humanTakeoverUntil: Date | null;
  broadcastOptOutAt: Date | null;
};

export type Contagens = {
  /** Envios do vendedor na última hora / hoje / hoje para essa pessoa. */
  hora: number;
  dia: number;
  pessoaDia: number;
  /** Último envio do vendedor em qualquer conversa (fila global). */
  ultimoEnvioEm: Date | null;
};

export type Decisao =
  | { acao: "responder" }
  | { acao: "esperar"; motivo: string }
  | { acao: "pular"; motivo: string }
  | { acao: "parar"; motivo: string };

const PARAR_EXTRA = /^(cancelar|cancela|cancele|stop|parar|pare|sair|chega)[\s!.]*$/i;

/** A pessoa pediu pra parar: parar, sair, cancelar (palavra sozinha) ou frase tipo "não quero mais receber". */
export function pedidoDeParar(texto: string | null | undefined): boolean {
  const t = (texto ?? "").trim();
  return Boolean(t) && (PARAR_EXTRA.test(t) || pediuPraParar(t));
}

/** Espera sorteada de forma estável por DM (mesma DM = mesma espera em toda rodada). */
export function esperaDaDm(mid: string, minSec: number, maxSec: number): number {
  let h = 0;
  for (let i = 0; i < mid.length; i++) h = (h * 31 + mid.charCodeAt(i)) >>> 0;
  const span = Math.max(0, maxSec - minSec);
  return (minSec + (span === 0 ? 0 : h % (span + 1))) * 1000;
}

export function decidir(input: {
  now: Date;
  config: VendedorConfig;
  contato: EstadoContato;
  /** Da mais antiga pra mais nova. */
  mensagens: MsgLite[];
  temRascunhoPendente: boolean;
  paradoAntes: boolean;
  contagens: Contagens;
}): Decisao {
  const { now, config, contato, mensagens } = input;
  const ultima = mensagens[mensagens.length - 1];
  if (!ultima || ultima.fromMe) return { acao: "esperar", motivo: "a última mensagem é nossa" };

  // 1. Travas duras (a conversa não é do vendedor).
  if (isTakeoverActive(contato, now)) return { acao: "pular", motivo: "conversa assumida por você (takeover)" };
  if (!isWindowOpen({ lastInboundAt: contato.lastInboundAt }, now)) return { acao: "pular", motivo: "janela de 24 h fechada" };
  if (input.paradoAntes || contato.broadcastOptOutAt) return { acao: "pular", motivo: "a pessoa já pediu pra parar" };
  if (pedidoDeParar(ultima.text)) return { acao: "parar", motivo: "a pessoa pediu pra parar (parar, sair ou cancelar)" };
  if (!needsReply(mensagens)) return { acao: "pular", motivo: "só agradeceu ou mandou emoji: não precisa de resposta" };
  if (input.temRascunhoPendente) return { acao: "pular", motivo: "já existe um rascunho esperando você" };

  // 2. Limites por pessoa e por dia: passou, não responde sozinho.
  if (input.contagens.pessoaDia >= config.maxPerPersonDay) return { acao: "pular", motivo: `limite de ${config.maxPerPersonDay} respostas por pessoa por dia` };
  if (input.contagens.dia >= config.maxPerDay) return { acao: "pular", motivo: `limite de ${config.maxPerDay} respostas por dia` };

  // 3. Ritmo: pode esperar e tentar de novo na próxima rodada.
  if (config.quietStart && config.quietEnd && emSilencio(now, { start: config.quietStart, end: config.quietEnd })) {
    return { acao: "esperar", motivo: "horário de silêncio" };
  }
  if (input.contagens.hora >= config.maxPerHour) return { acao: "esperar", motivo: `limite de ${config.maxPerHour} por hora` };
  const espera = esperaDaDm(ultima.mid, config.replyDelayMinSec, config.replyDelayMaxSec);
  if (now.getTime() - ultima.sentAt.getTime() < espera) return { acao: "esperar", motivo: "ainda lendo (espera humana)" };
  const gap = config.minGapSeconds * 1000;
  if (input.contagens.ultimoEnvioEm && now.getTime() - input.contagens.ultimoEnvioEm.getTime() < gap) {
    return { acao: "esperar", motivo: "fila: outra conversa acabou de ser atendida" };
  }
  return { acao: "responder" };
}

function semAcentos(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

// Em texto sem acento, \b funciona. "você é um robô?", "isso é IA?", "tem alguém de verdade aí?", "quero falar com o Matheus".
const PERGUNTA_ROBO = [
  /\b(voce|vc|tu|isso|isto|esse|essa|ai|ta)\b.{0,25}\b(robo|bot|ia|inteligencia artificial|chatgpt|automatic[oa]|maquina)\b.{0,12}\?/,
  /\b(e|eh|sera que e|voce e|vc e)\b.{0,8}\b(robo|bot|ia)\b/,
  /\bpessoa de verdade\b|\balguem de verdade\b|\bpessoa real\b|\bhumano\b/,
  /\b(tem|tem mesmo|existe)\b.{0,15}\b(alguem|pessoa|gente)\b.{0,15}\b(ai|real|de verdade|do outro lado)\b/,
  /\bquero falar com (o )?(matheus|uma pessoa|um humano|alguem)\b/,
];

/** A pessoa quer saber se fala com robô ou pessoa. A resposta é fixa e honesta (nunca o modelo). */
export function perguntouSeERobo(texto: string | null | undefined): boolean {
  const t = semAcentos(texto ?? "");
  return PERGUNTA_ROBO.some((re) => re.test(t));
}

export const RESPOSTA_SOU_IA =
  "Sou o Gil, assistente da equipe do Matheus, e uso inteligência artificial pra te responder.\n\nMas pode falar comigo à vontade. O que você quer saber sobre o treinamento?";

const SENSIVEL =
  /\b(cpf|cart[aã]o|senha|c[oó]digo de seguran[cç]a|cvv|rg\b|endere[cç]o completo|diagn[oó]stico|depress[aã]o|suic[ií]d|rem[eé]dio|doen[cç]a|c[aâ]ncer|processo|advogad|procon|reembolso|estorno|golpe|fraude|den[uú]ncia|chargeback|gr[aá]vida|aborto)\b/i;

/** Assunto sensível ou que exige o dono (dinheiro de volta, jurídico, saúde, dado pessoal): o vendedor não responde sozinho. */
export function assuntoSensivel(texto: string | null | undefined): boolean {
  return SENSIVEL.test(texto ?? "");
}
