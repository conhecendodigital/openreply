/**
 * Quebra a resposta em bolhas curtas e sorteia o ritmo humano.
 *
 * - 1 a 3 bolhas, cada uma com até ~220 caracteres (quebra por frase, nunca
 *   no meio de uma frase nem num número como "R$ 1.500" ou num link).
 * - A pergunta vai sempre na última bolha (quem lê responde a última coisa).
 * - Tira marcas de texto de robô: travessão, negrito em markdown, marcador de lista,
 *   frase pronta de chatbot ("Ótima pergunta!", "Espero ter ajudado") e emoji além
 *   do primeiro. Só tira, nunca acrescenta palavra (regra de não inventar).
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

/**
 * Frase inteira que é só enchimento de chatbot (Ghost Mode). Comparada sem
 * acento e sem pontuação; frase com conteúdo junto ("Claro, custa R$ 80") fica.
 */
const FRASES_DE_CHATBOT = [
  /^(otima|excelente|boa|que otima) pergunta$/,
  /^com certeza$/,
  /^(fico|ficamos) (muito )?(feliz|felizes|contente|contentes) em (te |lhe )?ajudar$/,
  /^espero ter (te |lhe )?ajudado$/,
  /^(estou|estamos|fico|ficamos|sigo|seguimos) (a )?(sua |a sua |inteira )?disposicao( pra| para)?( qualquer duvida| o que precisar)?$/,
  /^qualquer (outra )?duvida(,)? (estou|estamos|fico|ficamos) (a )?(sua )?disposicao$/,
  /^nao hesite em (nos )?(chamar|perguntar|entrar em contato)$/,
  /^(agradeco|agradecemos) (o|pelo|seu|pelo seu) contato$/,
  /^entendo (perfeitamente )?(a |sua |a sua )?preocupacao$/,
  /^sinceramente$/,
];

function normal(f: string): string {
  return f
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, "")
    .replace(/[!?.,;:…"'()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function ehFraseDeChatbot(frase: string): boolean {
  const n = normal(frase);
  return n.length > 0 && FRASES_DE_CHATBOT.some((re) => re.test(n));
}

const RE_EMOJI = /\p{Extended_Pictographic}\uFE0F?(?:\u200D\p{Extended_Pictographic}\uFE0F?)*/gu;

/** Tira frase de chatbot de cada bolha e deixa só o primeiro emoji da resposta. */
export function semCaraDeIa(bolhas: string[]): string[] {
  let emojis = 0;
  return bolhas
    .map((b) => {
      const fs = frases(b);
      const ficam = fs.filter((f) => !ehFraseDeChatbot(f));
      const texto = ficam.length === fs.length ? b : ficam.join(" ");
      return texto
        .replace(RE_EMOJI, (e) => (emojis++ === 0 ? e : ""))
        .replace(/[ \t]+/g, " ")
        .replace(/\s+([,.!?])/g, "$1")
        .trim();
    })
    .filter(Boolean);
}

/** Frases: fim em . ! ? ou … seguido de espaço (não quebra "R$ 1.500", "www.site.com.br" nem "3.5"). */
export function frases(texto: string): string[] {
  const out: string[] = [];
  let ini = 0;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (c === "\n") {
      if (texto.slice(ini, i).trim()) out.push(texto.slice(ini, i));
      ini = i + 1;
      continue;
    }
    if (".!?…".includes(c)) {
      let j = i;
      while (j + 1 < texto.length && ".!?…".includes(texto[j + 1])) j++;
      const prox = texto[j + 1];
      if (prox === undefined || /\s/.test(prox)) {
        out.push(texto.slice(ini, j + 1));
        ini = j + 1;
        i = j;
      }
    }
  }
  if (texto.slice(ini).trim()) out.push(texto.slice(ini));
  return out.map((f) => f.trim()).filter(Boolean);
}

function quebrarLonga(texto: string): string[] {
  if (texto.length <= MAX_CARACTERES_BOLHA) return [texto];
  const lista = frases(texto).map((f) => `${f} `);
  const partes: string[] = [];
  let atual = "";
  for (const f of lista) {
    if (atual && (atual + f).length > MAX_CARACTERES_BOLHA) {
      partes.push(atual.trim());
      atual = "";
    }
    atual += f;
  }
  if (atual.trim()) partes.push(atual.trim());
  return partes;
}

const tem_pergunta = (b: string) => b.includes("?");

/** A pergunta vai pro fim: bolhas sem pergunta primeiro, na ordem; as com pergunta depois. */
export function perguntaNoFim(bolhas: string[]): string[] {
  if (bolhas.length < 2 || !bolhas.slice(0, -1).some(tem_pergunta)) return bolhas;
  const semPergunta = bolhas.filter((b) => !tem_pergunta(b));
  const comPergunta = bolhas.filter(tem_pergunta);
  return [...semPergunta, ...comPergunta];
}

export function quebrarEmBolhas(entrada: string | string[]): string[] {
  const brutas = (Array.isArray(entrada) ? entrada : [entrada]).flatMap((b) => String(b ?? "").split(/\n{2,}/));
  const limpas = perguntaNoFim(semCaraDeIa(brutas.map(limparBolha).filter(Boolean)).flatMap(quebrarLonga));
  if (limpas.length <= MAX_BOLHAS) return limpas;
  // Junta o excedente na última bolha em vez de mandar 5 mensagens seguidas
  // (a pergunta, que já está no fim, continua na última).
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
    // Entre bolhas: pausa curta de quem acabou de mandar a anterior, maior se ela era longa.
    const anterior = i > 0 ? bolhas[i - 1].length : 0;
    const esperaMs = i === 0 ? entre(rng, iniMin, iniMax) : Math.min(6_000, entre(rng, 1_000, 3_000) + Math.round(anterior * 8));
    return { texto, esperaMs, digitandoMs };
  });
}

export function duracaoTotalMs(envios: EnvioPlanejado[]): number {
  return envios.reduce((s, e) => s + e.esperaMs + e.digitandoMs, 0);
}
