/**
 * Teste A/B do quiz (11/10/2026). Puro e seguro no navegador: o player, o
 * servidor (que grava a versão na visita) e os testes usam o mesmo cálculo.
 *
 * Como funciona:
 * - A versão B é uma tela comum do rascunho com `abOf: "<id da tela A>"`.
 *   No editor ela aparece como "Versão B" logo abaixo da A e se edita igual.
 * - Cada visitante cai sempre na mesma versão: o sorteio sai do visitorId,
 *   então recarregar a página não troca a versão.
 * - Pra quem cai na B, a tela B entra no lugar da A COM O ID DA A. Botões,
 *   destinos, barra de progresso e o funil por tela continuam iguais; a
 *   versão de cada visita fica em FunnelVisit.abVariant pros resultados.
 * - Sem nenhuma tela B, nada muda (todo mundo é "sem teste").
 */

export type AbVariant = "A" | "B";

export const AB_DEFAULT_PERCENT_B = 50;
export const AB_MIN_PERCENT_B = 10;
export const AB_MAX_PERCENT_B = 90;

type AbStep = { id: string; abOf?: string; title: string };

export function hasAbTest(steps: readonly { abOf?: string }[]): boolean {
  return steps.some((s) => Boolean(s.abOf));
}

export function percentB(value: number | undefined | null): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return AB_DEFAULT_PERCENT_B;
  return Math.min(AB_MAX_PERCENT_B, Math.max(AB_MIN_PERCENT_B, Math.round(value)));
}

/** Versão do visitante: os 8 últimos hex do visitorId (aleatório) viram 0..99. */
export function abVariantFor(visitorId: string, pctB?: number | null): AbVariant {
  const tail = visitorId.slice(-8);
  const n = /^[0-9a-f]{8}$/i.test(tail) ? parseInt(tail, 16) : 0;
  return n % 100 < percentB(pctB) ? "B" : "A";
}

/**
 * As telas que o visitante vê. A (ou sem versão): sem as telas B. B: cada tela
 * A que tem versão B mostra o conteúdo da B, mantendo o id da A.
 */
export function applyAbVariant<T extends AbStep>(steps: readonly T[], variant: AbVariant | null): T[] {
  const plain = steps.filter((s) => !s.abOf);
  if (variant !== "B") return plain;
  const byA = new Map<string, T>();
  for (const s of steps) if (s.abOf && !byA.has(s.abOf)) byA.set(s.abOf, s);
  return plain.map((a) => {
    const b = byA.get(a.id);
    if (!b) return a;
    const { abOf: _abOf, ...rest } = b;
    void _abOf;
    return { ...rest, id: a.id, title: a.title } as T;
  });
}
