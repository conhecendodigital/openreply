/**
 * Quebra a resposta em bolhas curtas e sorteia o ritmo humano.
 *
 * - 1 a 3 bolhas, cada uma com até ~220 caracteres (quebra por frase).
 * - Tira marcas de texto de robô: travessão, negrito em markdown, marcador de lista.
 * - Atraso inicial de 20 a 90 s, "digitando..." de 4 a 7 caracteres por
 *   segundo, pausa de 1 a 4 s entre bolhas.
 */
import type { EnvioPlanejado } from "./types";

export const MAX_BOLHAS = 3;
export const MAX_CARACTERES_BOLHA = 220;

export function limparBolha(texto: string): string {
  return texto
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/^#+\s*/gm, "")
    .replace(/,\s*,/g, ",")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+([,.!?])/g, "$1")
    .trim();
}

function quebrarLonga(texto: string): string[] {
  if (texto.length <= MAX_CARACTERES_BOLHA) return [texto];
  const frases = texto.match(/[^.!?\n]+[.!?]*\s*/g) ?? [texto];
  const partes: string[] = [];
  let atual = "";
  for (const f of frases) {
    if (atual && (atual + f).length > MAX_CARACTERES_BOLHA) {
      partes.push(atual.trim());
      atual = "";
    }
    atual += f;
  }
  if (atual.trim()) partes.push(atual.trim());
  return partes;
}

export function quebrarEmBolhas(entrada: string | string[]): string[] {
  const brutas = (Array.isArray(entrada) ? entrada : [entrada]).flatMap((b) => String(b ?? "").split(/\n{2,}/));
  const limpas = brutas.map(limparBolha).filter(Boolean).flatMap(quebrarLonga);
  if (limpas.length <= MAX_BOLHAS) return limpas;
  // Junta o excedente na última bolha em vez de mandar 5 mensagens seguidas.
  return [...limpas.slice(0, MAX_BOLHAS - 1), limpas.slice(MAX_BOLHAS - 1).join(" ")];
}

export type Sorteio = () => number;

function entre(rng: Sorteio, min: number, max: number): number {
  return Math.round(min + (max - min) * rng());
}

export interface OpcoesRitmo {
  esperaInicialMinMs?: number;
  esperaInicialMaxMs?: number;
}

export function planejarRitmo(bolhas: string[], rng: Sorteio = Math.random, opcoes: OpcoesRitmo = {}): EnvioPlanejado[] {
  const iniMin = opcoes.esperaInicialMinMs ?? 20_000;
  const iniMax = opcoes.esperaInicialMaxMs ?? 90_000;
  return bolhas.map((texto, i) => {
    const cps = 4 + 3 * rng();
    const digitandoMs = Math.min(25_000, Math.max(1_500, Math.round((texto.length / cps) * 1000)));
    const esperaMs = i === 0 ? entre(rng, iniMin, iniMax) : entre(rng, 1_000, 4_000);
    return { texto, esperaMs, digitandoMs };
  });
}

export function duracaoTotalMs(envios: EnvioPlanejado[]): number {
  return envios.reduce((s, e) => s + e.esperaMs + e.digitandoMs, 0);
}
