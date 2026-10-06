/**
 * Exemplos aprendidos com a equipe (06/10/2026, pedido do dono: "a IA tem que
 * se auto treinar").
 *
 * Quando o dono EDITA um rascunho antes de enviar, ou responde no lugar do
 * agente (pelo inbox ou pelo celular, o que pausa o agente), o par
 * "mensagem do cliente -> resposta da equipe" vira exemplo do negócio. Sem
 * pedir permissão (é só exemplo), mas:
 *  - texto sem telefone, e-mail, CPF/CNPJ, CEP, link e nome do contato;
 *  - no máximo MAX_EXEMPLOS por número (os mais antigos saem);
 *  - o dono vê e remove em "O que o agente aprendeu";
 *  - exemplo NUNCA muda regra dura: só entra no Comando como referência.
 *
 * Os mais parecidos com a conversa atual (palavras em comum, sem IA nem
 * embedding pago) entram no Comando, na parte que muda a cada mensagem.
 */
import { textoPlano } from "@/lib/whatsapp/agentes/comando";
import { limparDadosPessoais } from "@/lib/whatsapp/agentes/tom";
import type { AgenteTipo, WaMessageLite } from "@/lib/whatsapp/agentes/types";
import { normalizarTexto } from "./texto";

export const MAX_EXEMPLOS = 100;
export const EXEMPLOS_NO_COMANDO = 4;
export const MAX_PERGUNTA = 600;
export const MAX_RESPOSTA = 1200;

export interface ExemploAprendido {
  id?: string;
  sessionId: string;
  agente: AgenteTipo | null;
  origem: "edicao" | "assumir";
  /** id do run (edição) ou da mensagem humana (assumir): não guarda duas vezes. */
  origemId: string;
  pergunta: string;
  resposta: string;
  rascunho?: string | null;
  createdAt?: Date;
}

/** Tira dado pessoal e corta. Marcadores como [telefone] ficam no lugar. */
export function limparExemplo(texto: string, nomes: string[], max: number): string {
  return limparDadosPessoais(texto.replace(/\s+/g, " ").trim(), nomes).slice(0, max).trim();
}

/** As mensagens do cliente logo antes da posição (as seguidas, até 3), sem a mídia crua. */
export function perguntaAntes(historico: WaMessageLite[], ate: number): string {
  const out: string[] = [];
  for (let i = ate - 1; i >= 0; i--) {
    const m = historico[i];
    if (m.fromMe) {
      if (out.length) break;
      continue;
    }
    const t = textoPlano(m).trim();
    if (t) out.unshift(t);
    if (out.length >= 3) break;
  }
  return out.join("\n");
}

function iguais(a: string[], b: string[]): boolean {
  const n = (l: string[]) => normalizarTexto(l.join(" "));
  return n(a) === n(b);
}

/** Exemplo de um rascunho editado. null se não mudou nada ou se faltou a pergunta. */
export function exemploDaEdicao(input: {
  sessionId: string;
  agente: AgenteTipo | null;
  runId: string;
  historico: WaMessageLite[];
  original: string[];
  enviado: string[];
  nomesDoContato: string[];
}): ExemploAprendido | null {
  if (!input.enviado.length || iguais(input.original, input.enviado)) return null;
  const pergunta = limparExemplo(perguntaAntes(input.historico, input.historico.length), input.nomesDoContato, MAX_PERGUNTA);
  const resposta = limparExemplo(input.enviado.join("\n"), input.nomesDoContato, MAX_RESPOSTA);
  if (pergunta.length < 3 || resposta.length < 2) return null;
  return {
    sessionId: input.sessionId,
    agente: input.agente,
    origem: "edicao",
    origemId: `run:${input.runId}`,
    pergunta,
    resposta,
    rascunho: limparExemplo(input.original.join("\n"), input.nomesDoContato, MAX_RESPOSTA) || null,
  };
}

/**
 * Exemplo de uma resposta humana. A resposta tem que vir logo depois de uma
 * mensagem do cliente (é a equipe respondendo no lugar do agente).
 * `mensagemId` = a mensagem humana já gravada (celular); sem ela, `texto` é o
 * que acabou de sair pelo inbox e ainda não está no histórico.
 */
export function exemploDaRespostaHumana(input: {
  sessionId: string;
  historico: WaMessageLite[];
  mensagemId?: string;
  texto?: string;
  nomesDoContato: string[];
  agente?: AgenteTipo | null;
}): ExemploAprendido | null {
  let ate = input.historico.length;
  let resposta = input.texto ?? "";
  let origemId = "";
  if (input.mensagemId) {
    const i = input.historico.findIndex((m) => m.id === input.mensagemId);
    const m = input.historico[i];
    if (i < 0 || !m.fromMe || m.type !== "text") return null;
    ate = i;
    resposta = m.body ?? "";
    origemId = `msg:${m.id}`;
  }
  const anterior = input.historico[ate - 1];
  if (!anterior || anterior.fromMe) return null;
  if (!origemId) origemId = `inbox:${anterior.id}:${normalizarTexto(resposta).slice(0, 40)}`;
  const pergunta = limparExemplo(perguntaAntes(input.historico, ate), input.nomesDoContato, MAX_PERGUNTA);
  const limpa = limparExemplo(resposta, input.nomesDoContato, MAX_RESPOSTA);
  if (pergunta.length < 3 || limpa.length < 4) return null;
  return { sessionId: input.sessionId, agente: input.agente ?? null, origem: "assumir", origemId, pergunta, resposta: limpa };
}

/* ------------------------------- parecidos com a conversa ------------------------------- */

const PARADAS = new Set(
  "a o e de da do das dos em no na nos nas um uma uns umas pra para por com sem que se eu voce voces ele ela isso esse essa este esta meu minha seu sua ta tá ok oi ola bom dia boa tarde noite sim nao ja mais muito tem ter quero queria gostaria saber como quando onde qual quais".split(
    " "
  )
);

function palavras(s: string): Set<string> {
  return new Set(
    normalizarTexto(s)
      .split(" ")
      .filter((p) => p.length >= 3 && !PARADAS.has(p))
      .map((p) => p.slice(0, 6))
  );
}

/** Nota de 0 a 1 (Jaccard das palavras, com radical curto). */
export function parecido(a: string, b: string): number {
  const x = palavras(a);
  const y = palavras(b);
  if (!x.size || !y.size) return 0;
  let comum = 0;
  for (const p of x) if (y.has(p)) comum++;
  return comum / (x.size + y.size - comum);
}

export function exemplosParecidos(todos: ExemploAprendido[], consulta: string, agente: AgenteTipo, n = EXEMPLOS_NO_COMANDO): ExemploAprendido[] {
  return todos
    .map((e) => ({ e, nota: parecido(e.pergunta, consulta) + (e.agente === agente ? 0.05 : 0) }))
    .filter((x) => x.nota >= 0.12)
    .sort((a, b) => b.nota - a.nota || (b.e.createdAt?.getTime() ?? 0) - (a.e.createdAt?.getTime() ?? 0))
    .slice(0, n)
    .map((x) => x.e);
}

export function textoExemplos(lista: ExemploAprendido[]): string {
  return lista.map((e) => `Cliente: ${e.pergunta}\nEmpresa: ${e.resposta}`).join("\n\n");
}
