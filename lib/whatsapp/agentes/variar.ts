/**
 * 2026-10-14 (Matheus): "quero um agente que responda como um humano atendendo,
 * não uma IA robótica que sempre responde a mesma coisa". Em produção o agente
 * mandou a mesma frase pra mesma pessoa ("Que bom ter você por aqui...",
 * "Em qual cidade será a obra?" duas vezes).
 *
 * Duas peças, sem chamada a mais de API:
 * - frasesJaMandadas: as últimas frases do agente na conversa, pro Comando
 *   pedir pra não repetir.
 * - tirarRepetidas: depois da resposta, tira a bolha que é cópia de algo que o
 *   agente já mandou. Nunca tira a última bolha (é onde fica a pergunta), nunca
 *   tira o fecho de recusa da primeira vez e nunca deixa a resposta vazia.
 */
import { parecido } from "@/lib/whatsapp/regras/exemplos";
import { temFechoRecusa } from "@/lib/whatsapp/regras/fecho";
import { normalizarTexto } from "@/lib/whatsapp/regras/texto";
import type { WaMessageLite } from "./types";

/** A partir daqui (0 a 1, palavras em comum) a bolha conta como repetida. */
export const LIMITE_REPETIDA = 0.9;
export const FRASES_MAX = 6;
export const FRASES_MAX_CARACTERES = 600;

function linhasDoAgente(historico: WaMessageLite[]): string[] {
  const out: string[] = [];
  for (const m of historico) {
    if (!m.fromMe || !m.body?.trim()) continue;
    for (const l of m.body.split("\n")) if (l.trim()) out.push(l.trim());
  }
  return out;
}

/** Últimas frases que o agente (ou a equipe) já mandou nessa conversa, sem repetir. */
export function frasesJaMandadas(historico: WaMessageLite[], max = FRASES_MAX, limite = FRASES_MAX_CARACTERES): string[] {
  const out: string[] = [];
  let total = 0;
  const linhas = linhasDoAgente(historico);
  for (let i = linhas.length - 1; i >= 0 && out.length < max; i--) {
    const l = linhas[i];
    if (out.includes(l)) continue;
    if (total + l.length > limite && out.length) break;
    total += l.length;
    out.unshift(l);
  }
  return out;
}

export function tirarRepetidas(bolhas: string[], historico: WaMessageLite[]): string[] {
  if (bolhas.length < 2) return bolhas;
  const antigas = linhasDoAgente(historico);
  if (!antigas.length) return bolhas;
  const ultima = bolhas.length - 1;
  // 19/10 (Robério): o fecho de recusa também sai se já foi mandado (antes ele ia em toda resposta).
  const fechoJaMandado = antigas.some((a) => temFechoRecusa(normalizarTexto(a)));
  const ficam = bolhas.filter((b, i) => {
    const fecho = temFechoRecusa(normalizarTexto(b));
    if (fecho) return !fechoJaMandado;
    if (i === ultima) return true;
    return !antigas.some((a) => a === b || parecido(a, b) >= LIMITE_REPETIDA);
  });
  return ficam.length ? ficam : bolhas;
}
