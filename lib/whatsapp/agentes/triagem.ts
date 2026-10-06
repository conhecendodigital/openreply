/**
 * Triagem antes do modelo caro.
 *
 * 1. Regras locais (custo zero): mensagem vazia, só emoji, "ok", "obrigado",
 *    palavras de reclamação ou reembolso.
 * 2. Jev: decide se responde, qual agente, se é caso de humano, se é spam e se
 *    a conversa é difícil.
 * 3. Sem Jev (sem chave, fora do ar): segue com regras simples e marca
 *    "incerto", o que manda pro modelo de caso difícil e nunca pro envio
 *    automático sem revisão.
 */
import { PERGUNTAS_TRIAGEM, perguntarJev, type JevOpcoes, type JevResultado } from "./jev";
import type { AgenteConfig, AgenteTipo, WaMessageLite } from "./types";

export type AcaoTriagem = "responder" | "nao_precisa" | "humano" | "spam";

export interface DecisaoTriagem {
  acao: AcaoTriagem;
  agente: AgenteTipo;
  dificil: boolean;
  incerto: boolean;
  fonte: "regra" | "jev" | "fallback";
  motivo: string;
  jevTokens: number;
}

const SO_CONFIRMACAO =
  /^(ok+|okay|blz|beleza|show|top|massa|valeu|vlw|obg|obrigad[oa]s?|muito obrigad[oa]|brigad[oa]|grat[oa]|tmj|certo|entendi|perfeito|combinado|fechado|t[aá] bom|t[aá]|sim|ss|kk+|haha+|rs+|amém|amem|deus aben[cç]oe|👍|🙏|❤️|😊)[\s!.,]*$/i;

const PEDE_PESSOA =
  /\b(falar|conversar|fala|quero|chama|chamar|passa|passar)\b.{0,20}\b(com )?(um |uma |o |a )?(humano|pessoa|atendente|gerente|dono|respons[aá]vel|algu[eé]m de verdade)\b/i;

/** Kept for reference and tests; no longer transfers by itself (2026-10-06). */
export const SENSIVEL =
  /\b(reembolso|estorno|devolu[cç][aã]o|cancelar|cancelamento|procon|advogad[oa]|processo|reclame ?aqui|golpe|fraude|denunciar|denúncia|chargeback|absurdo|palha[cç]ada|falar com (um|uma)? ?(humano|pessoa|atendente|gerente|dono))\b/i;

// Pares substitutos (emoji) e símbolos comuns, sem flag "u" (alvo ES2017).
const SO_EMOJI = /^(?:[\uD800-\uDBFF][\uDC00-\uDFFF]|[☀-➿️‍\s])+$/;

export function ultimaDoContato(historico: WaMessageLite[]): WaMessageLite | null {
  for (let i = historico.length - 1; i >= 0; i--) {
    if (!historico[i].fromMe) return historico[i];
  }
  return null;
}

/** Regras que decidem sozinhas, sem gastar nada. null = precisa do Jev. */
export function triagemLocal(texto: string): Pick<DecisaoTriagem, "acao" | "motivo"> | null {
  const t = texto.trim();
  if (!t) return { acao: "nao_precisa", motivo: "mensagem sem texto" };
  if (SO_EMOJI.test(t)) return { acao: "nao_precisa", motivo: "só emoji" };
  if (t.length <= 40 && SO_CONFIRMACAO.test(t)) return { acao: "nao_precisa", motivo: "só confirmação ou agradecimento" };
  // 2026-10-06 (Matheus: "só transferir quando qualificar"): só o pedido explícito
  // de falar com uma pessoa transfere. Reclamação e reembolso o agente responde com cuidado.
  if (PEDE_PESSOA.test(t)) return { acao: "humano", motivo: "pediu pra falar com uma pessoa" };
  return null;
}

function agentePadrao(agentes: AgenteConfig[]): AgenteTipo {
  const ativos = agentes.filter((a) => a.ativo).map((a) => a.agente);
  for (const preferido of ["atendimento", "qualificacao", "suporte"] as AgenteTipo[]) {
    if (ativos.includes(preferido)) return preferido;
  }
  return "atendimento";
}

function contextoCurto(historico: WaMessageLite[]): string {
  return historico
    .slice(-6)
    .map((m) => `${m.fromMe ? "negócio" : "cliente"}: ${(m.body ?? `[${m.type}]`).slice(0, 300)}`)
    .join("\n");
}

export async function triar(
  historico: WaMessageLite[],
  agentes: AgenteConfig[],
  jev: JevOpcoes = {}
): Promise<DecisaoTriagem> {
  const ultima = ultimaDoContato(historico);
  const texto = ultima?.body ?? "";
  const padrao = agentePadrao(agentes);
  const ativos = new Set(agentes.filter((a) => a.ativo).map((a) => a.agente));

  const local = ultima && ultima.type === "text" ? triagemLocal(texto) : null;
  if (local) {
    return { ...local, agente: padrao, dificil: false, incerto: false, fonte: "regra", jevTokens: 0 };
  }
  if (!texto.trim()) {
    // 2026-10-06: áudio, foto e documento o agente responde (sem transferir);
    // figurinha e reação não pedem resposta.
    const semResposta = !ultima || ultima.type === "sticker" || ultima.type === "reaction";
    return {
      acao: semResposta ? "nao_precisa" : "responder",
      motivo: ultima ? `mensagem do tipo ${ultima.type} sem texto` : "sem mensagem do contato",
      agente: padrao,
      dificil: false,
      incerto: false,
      fonte: "regra",
      jevTokens: 0,
    };
  }

  const r: JevResultado = await perguntarJev(
    { mensagem: texto.slice(0, 1500), contexto: contextoCurto(historico) },
    PERGUNTAS_TRIAGEM,
    jev
  );

  if (!r.ok) {
    // Jev desligado de propósito (sem chave, LGPD) não é dúvida: o agente responde
    // e o envio automático segue, com as travas de conteúdo valendo.
    const desligado = r.erro === "sem_chave";
    return {
      acao: "responder",
      agente: padrao,
      dificil: true,
      incerto: !desligado,
      fonte: "fallback",
      motivo: `Jev indisponível (${r.erro})`,
      jevTokens: 0,
    };
  }

  const acaoR = r.respostas.acao;
  const agenteR = r.respostas.agente;
  const dificilR = r.respostas.dificil;
  const acao = (acaoR?.tipo === "choice" ? acaoR.escolha : "responder") as AcaoTriagem;
  let agente = (agenteR?.tipo === "choice" ? agenteR.escolha : padrao) as AgenteTipo;
  if (!ativos.has(agente)) agente = padrao;
  const dificil = dificilR?.tipo === "noul" ? dificilR.sim >= 0.5 : false;

  // Incerto na hora de NÃO responder: melhor um rascunho a mais do que um cliente sem resposta.
  if (r.incerto && (acao === "nao_precisa" || acao === "spam")) {
    return { acao: "responder", agente, dificil: true, incerto: true, fonte: "jev", motivo: `Jev incerto (${acao})`, jevTokens: r.tokens };
  }
  return {
    acao: ["responder", "nao_precisa", "humano", "spam"].includes(acao) ? acao : "responder",
    agente,
    dificil,
    incerto: r.incerto,
    fonte: "jev",
    motivo: `Jev: ${acao}`,
    jevTokens: r.tokens,
  };
}
