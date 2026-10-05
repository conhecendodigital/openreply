/**
 * Etapa 6: where the visitor goes next. Pure and browser-safe: the public
 * player, the editor preview and the tests share it.
 *
 * - A destination (goto) that does not exist falls back to "next" (safe,
 *   like Inlead): a broken link never strands the visitor.
 * - Last screen + "next" = null (the end; checkout opens elsewhere).
 * - loading.routes: the first range with min <= score <= max decides
 *   (a missing side is open). None = next screen.
 */
import type { ButtonAction, FunnelBlock, FunnelOption, LoadingBlock } from "@/lib/funnels/types";

/** options.name -> option ids picked. */
export type Answers = Record<string, string[]>;

type NavDef = { steps: readonly { id: string; blocks: readonly FunnelBlock[] }[] };

export function stepIndex(def: { steps: readonly { id: string }[] }, stepId: string): number {
  return def.steps.findIndex((s) => s.id === stepId);
}

function following(def: NavDef, currentStepId: string): string | null {
  const i = stepIndex(def, currentStepId);
  if (i < 0) return def.steps[0]?.id ?? null;
  return def.steps[i + 1]?.id ?? null;
}

function target(def: NavDef, currentStepId: string, stepId: string | null | undefined): string | null {
  if (stepId && stepIndex(def, stepId) >= 0) return stepId;
  return following(def, currentStepId);
}

export function totalScore(def: NavDef, answers: Answers): number {
  let sum = 0;
  for (const step of def.steps) {
    for (const block of step.blocks) {
      if (block.type !== "options") continue;
      const picked = new Set(answers[block.name] ?? []);
      for (const o of block.options) if (picked.has(o.id)) sum += o.score ?? 0;
    }
  }
  return sum;
}

export function routeFor(block: Pick<LoadingBlock, "routes">, score: number): string | null {
  for (const r of block.routes ?? []) {
    if ((r.min === undefined || score >= r.min) && (r.max === undefined || score <= r.max)) return r.stepId;
  }
  return null;
}

export function nextStepId(
  def: NavDef,
  currentStepId: string,
  via:
    | { kind: "button"; action: ButtonAction }
    | { kind: "option"; option: FunnelOption }
    | { kind: "continue" }
    | { kind: "loading"; block: LoadingBlock; answers: Answers }
): string | null {
  switch (via.kind) {
    case "button":
      if (via.action.kind === "checkout") return null;
      if (via.action.kind === "goto") return target(def, currentStepId, via.action.stepId);
      return following(def, currentStepId);
    case "option":
      return target(def, currentStepId, via.option.goto);
    case "continue":
      return following(def, currentStepId);
    case "loading":
      return target(def, currentStepId, routeFor(via.block, totalScore(def, via.answers)));
  }
}

/** (index + 1) / total * 100, rounded. Unknown screen = 0. */
export function progressPct(def: { steps: readonly { id: string }[] }, stepId: string): number {
  const i = stepIndex(def, stepId);
  if (i < 0 || def.steps.length === 0) return 0;
  return Math.round(((i + 1) / def.steps.length) * 100);
}

/** options.name -> "label 1, label 2" (only answered questions). */
export function answerLabels(def: NavDef, answers: Answers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const step of def.steps) {
    for (const block of step.blocks) {
      if (block.type !== "options") continue;
      const picked = new Set(answers[block.name] ?? []);
      const labels = block.options.filter((o) => picked.has(o.id)).map((o) => o.label);
      if (labels.length > 0) out[block.name] = labels.join(", ");
    }
  }
  return out;
}

/** Options block of a screen (at most one per screen). */
export function optionsBlockOf(step: { blocks: readonly FunnelBlock[] } | undefined) {
  return step?.blocks.find((b): b is Extract<FunnelBlock, { type: "options" }> => b.type === "options") ?? null;
}
