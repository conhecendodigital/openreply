/**
 * Resposta automática por palavra (pedido do Matheus, 20/10/2026).
 *
 * A página "Aula workshop" manda a pessoa pro WhatsApp com "Quero a aula do
 * workshop" já escrito e promete a resposta com o link. O número não tinha
 * agente ligado e ninguém respondia. Aqui o dono cadastra, por número, frases
 * e o texto fixo que sai quando uma delas chega:
 * - funciona mesmo com os agentes desligados (é texto fixo, sem IA, custo zero);
 * - sai uma vez por pessoa (se o texto já foi mandado na conversa, não repete);
 * - respeita "Assumir" e a conversa desligada.
 */
import { z } from "zod";
import type { WaMessageLite } from "./types";

export interface RespostaPalavra {
  id: string;
  /** Frases que disparam (basta uma aparecer na mensagem, sem diferenciar maiúscula nem acento). */
  palavras: string[];
  /** Texto que sai, igualzinho. Linha em branco separa mensagens (até 3), ex.: a aula e depois a chamada pro produto. */
  texto: string;
  ativo: boolean;
}

export const MAX_RESPOSTAS = 20;
export const MAX_TEXTO = 2000;
export const MAX_BOLHAS = 3;

const Item = z.object({
  id: z.string().trim().min(1).max(40).catch(""),
  palavras: z.array(z.string()).catch([]),
  texto: z.string().catch(""),
  ativo: z.boolean().catch(true),
});

function idNovo(): string {
  return `r${Math.random().toString(36).slice(2, 10)}`;
}

/** Lê o JSON salvo (ou o que veio da tela): limpa, corta e descarta o vazio. */
export function lerRespostasPalavra(v: unknown): RespostaPalavra[] {
  if (!Array.isArray(v)) return [];
  const out: RespostaPalavra[] = [];
  for (const bruto of v.slice(0, MAX_RESPOSTAS)) {
    const r = Item.safeParse(bruto);
    if (!r.success) continue;
    const palavras = [...new Set(r.data.palavras.map((p) => p.replace(/\s+/g, " ").trim().slice(0, 120)).filter((p) => normalizar(p).length >= 2))].slice(0, 10);
    const texto = r.data.texto.trim().slice(0, MAX_TEXTO);
    if (!palavras.length || !texto) continue;
    out.push({ id: r.data.id || idNovo(), palavras, texto, ativo: r.data.ativo });
  }
  return out;
}

export function normalizar(t: string): string {
  return t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** A primeira resposta ligada cuja frase aparece inteira na mensagem (palavra por palavra). */
export function acharRespostaPalavra(lista: RespostaPalavra[] | null | undefined, mensagem: string): RespostaPalavra | null {
  const m = ` ${normalizar(mensagem)} `;
  if (m.trim().length < 2) return null;
  for (const r of lista ?? []) {
    if (!r.ativo) continue;
    if (r.palavras.some((p) => m.includes(` ${normalizar(p)} `))) return r;
  }
  return null;
}

/** O texto dessa resposta já foi mandado nessa conversa (uma vez por pessoa). */
export function jaRespondida(historico: WaMessageLite[], r: RespostaPalavra): boolean {
  const alvo = normalizar(bolhasDaResposta(r)[0] ?? r.texto);
  return historico.some((m) => m.fromMe && normalizar(m.body ?? "") === alvo);
}

/** As mensagens que saem: cada bloco separado por linha em branco vira uma (até 3; o resto junta na última). */
export function bolhasDaResposta(r: RespostaPalavra): string[] {
  const partes = r.texto.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (partes.length <= MAX_BOLHAS) return partes;
  return [...partes.slice(0, MAX_BOLHAS - 1), partes.slice(MAX_BOLHAS - 1).join("\n\n")];
}
