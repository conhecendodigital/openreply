/**
 * Aba "Funis" do admin da plataforma (pedido do dono em 10/10/2026: "uma aba
 * só pra mim, que sou administrador, de funis, pra ajudar na venda dos meus
 * produtos"). Funções puras: montam as etapas do caminho comentário → venda a
 * partir dos números que o Lead Engine já tem (/api/reports e os resultados
 * de cada quiz) e apontam onde mais gente se perde.
 */

export type BoardStage = {
  key: "commented" | "received" | "clicked" | "quizVisits" | "offerViews" | "checkouts" | "purchases";
  count: number;
  /** % da etapa anterior que chegou nesta. null na primeira ou sem base. */
  rateFromPrev: number | null;
};

export type BoardInput = {
  commented: number;
  received: number;
  clicked: number;
  quizVisits: number;
  offerViews: number;
  checkouts: number;
  purchases: number;
};

export const pct = (a: number, b: number): number | null =>
  b > 0 ? Math.min(100, Math.max(0, Number(((a / b) * 100).toFixed(1)))) : null;

const ORDER: BoardStage["key"][] = ["commented", "received", "clicked", "quizVisits", "offerViews", "checkouts", "purchases"];

export function buildStages(input: BoardInput): BoardStage[] {
  return ORDER.map((key, i) => {
    const count = Math.max(0, Math.round(Number(input[key]) || 0));
    const prev = i === 0 ? 0 : Math.max(0, Math.round(Number(input[ORDER[i - 1]]) || 0));
    return { key, count, rateFromPrev: i === 0 ? null : pct(count, prev) };
  });
}

/**
 * Onde mais gente se perde: a etapa com a menor % vinda da anterior, olhando
 * só etapas cuja anterior teve gente. O clique do Instagram pro quiz não entra
 * (link de DM e visita do quiz são contados por sistemas diferentes).
 */
export function biggestLeak(stages: BoardStage[]): BoardStage | null {
  let worst: BoardStage | null = null;
  for (const s of stages) {
    if (s.key === "quizVisits" || s.rateFromPrev === null) continue;
    if (!worst || s.rateFromPrev < (worst.rateFromPrev ?? 101)) worst = s;
  }
  return worst;
}

/** Soma os totais dos quizzes no ar (o último passo de cada quiz é a oferta). */
export function sumQuizzes(results: { visits: number; completed: number; checkouts: number; purchases: number }[]) {
  return results.reduce(
    (acc, r) => ({
      quizVisits: acc.quizVisits + (r.visits || 0),
      offerViews: acc.offerViews + (r.completed || 0),
      checkouts: acc.checkouts + (r.checkouts || 0),
      purchases: acc.purchases + (r.purchases || 0),
    }),
    { quizVisits: 0, offerViews: 0, checkouts: 0, purchases: 0 }
  );
}
