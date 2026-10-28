/**
 * Um rascunho vira 1 a 3 DMs curtas, no estilo de quem escreve no zap
 * (28/10/2026). As partes ficam no próprio texto do rascunho, separadas por uma
 * linha em branco: quem aprova vê exatamente as partes que vão sair, e editar o
 * texto edita as partes. Sem coluna nova no banco.
 */
import { MAX_BOLHAS, MAX_CARACTERES_BOLHA, quebrarEmBolhas } from "@/lib/messaging/bolhas";

export const MAX_DRAFT_PARTS = MAX_BOLHAS;

/** Partes de um texto já salvo: separa por linha em branco, no máximo 3 (o resto cola na última). */
export function splitDraftParts(text: string): string[] {
  const parts = text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length <= MAX_DRAFT_PARTS) return parts;
  return [...parts.slice(0, MAX_DRAFT_PARTS - 1), parts.slice(MAX_DRAFT_PARTS - 1).join("\n")];
}

/**
 * Texto do vendedor (IA) na hora de criar o rascunho: limpa marcas de robô e
 * divide em até 3 partes (110 a 220 caracteres), pergunta na última. Se o
 * vendedor já mandou linhas em branco, elas são respeitadas como partes.
 */
export function shapeVendedorText(text: string): string {
  const bolhas = quebrarEmBolhas(text);
  return bolhas.length > 0 ? bolhas.join("\n\n") : text.trim();
}

/** Para o texto digitado à mão: só garante que não passe de 3 partes; não mexe nas palavras. */
export function shapeManualText(text: string): string {
  const parts = splitDraftParts(text);
  return parts.length > 0 ? parts.join("\n\n") : text.trim();
}

export { MAX_CARACTERES_BOLHA };
