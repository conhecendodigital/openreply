/**
 * Etapa 6 (Quiz): pure operations of the editor. Every function takes a
 * definition and returns a new one (never mutates), so the editor can keep
 * undo-free simple state and the tests can check that the result still
 * passes the zod of lib/funnels/schema.ts.
 *
 * Default texts are funnel content (PT, with [brackets] where the owner has
 * to write): validateFunnel blocks publishing while a bracket is left.
 */

import { newId } from "@/lib/funnels/ids";
import { MAX_BLOCKS_PER_STEP, MAX_OPTIONS, MAX_STEPS } from "@/lib/funnels/schema";
import type {
  BlockType,
  FunnelBlock,
  FunnelDefinition,
  FunnelOption,
  FunnelSettings,
  FunnelStep,
} from "@/lib/funnels/types";

export const PLACEHOLDER_IMAGE = "https://troque.invalid/imagem.jpg";
export const PLACEHOLDER_VIDEO = "https://www.youtube.com/watch?v=XXXXXXXXXXX";

const clone = <T,>(v: T): T => (typeof structuredClone === "function" ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

function move<T>(list: T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return list;
  const out = list.slice();
  const [item] = out.splice(from, 1);
  out.splice(to, 0, item);
  return out;
}

/** Answer names already used in the funnel. */
function usedNames(def: FunnelDefinition): Set<string> {
  const names = new Set<string>();
  for (const s of def.steps) for (const b of s.blocks) if (b.type === "options") names.add(b.name);
  return names;
}

/** "pergunta_1", "pergunta_2"... first free one (or base_2, base_3 for a copy). */
export function freeAnswerName(def: FunnelDefinition, base = "pergunta"): string {
  const used = usedNames(def);
  const clean = base.replace(/[^a-z0-9_-]/g, "").slice(0, 34) || "pergunta";
  if (clean !== "pergunta" && !used.has(clean)) return clean;
  for (let n = clean === "pergunta" ? 1 : 2; n < 1000; n++) {
    const candidate = `${clean}_${n}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${clean}_${newId("o").slice(2)}`;
}

function option(label: string, extra: Partial<FunnelOption> = {}): FunnelOption {
  return { id: newId("o"), label, ...extra };
}

/** A block with valid defaults for the zod (new ids every call). */
export function defaultBlock(type: BlockType, def?: FunnelDefinition): FunnelBlock {
  const id = newId("b");
  switch (type) {
    case "heading":
      return { id, type, text: "[Seu título aqui]", level: 1, align: "center" };
    case "text":
      return { id, type, text: "[Escreva o texto aqui]", align: "center", size: "md" };
    case "image":
      return { id, type, url: PLACEHOLDER_IMAGE, alt: "", rounded: true };
    case "video":
      return { id, type, url: PLACEHOLDER_VIDEO, title: "[Vídeo]" };
    case "button":
      return { id, type, label: "Continuar", action: { kind: "next" }, style: "primary" };
    case "options":
      return {
        id,
        type,
        name: def ? freeAnswerName(def) : "pergunta_1",
        question: "[Escreva a pergunta]",
        multiple: false,
        layout: "list",
        options: [option("[Opção 1]"), option("[Opção 2]"), option("[Opção 3]")],
      };
    case "field":
      return { id, type, field: "email", label: "Seu melhor e-mail", placeholder: "nome@email.com", required: true };
    case "compare":
      return {
        id,
        type,
        before: { title: "Antes", items: ["[Como era]"] },
        after: { title: "Depois", items: ["[Como ficou]"] },
        authorized: false,
      };
    case "testimonial":
      return { id, type, quote: "[Depoimento real, com autorização]", author: "[Nome]", authorized: false };
    case "checklist":
      return { id, type, items: ["[Item 1]", "[Item 2]", "[Item 3]"] };
    case "countdown": {
      const in7 = new Date(Date.now() + 7 * 86_400_000);
      in7.setSeconds(0, 0);
      return { id, type, deadline: in7.toISOString(), label: "[Até quando vale de verdade]" };
    }
    case "loading":
      return { id, type, text: "Montando o seu resultado a partir das suas respostas…", durationSec: 3 };
    case "offer":
      return { id, type, title: "[Nome do produto]", priceCents: null, bonuses: [], guaranteeDays: null };
    case "gallery":
      return { id, type, images: [{ url: PLACEHOLDER_IMAGE, alt: "[Descreva a imagem]" }] };
    case "faq":
      return { id, type, items: [{ q: "[Pergunta]", a: "[Resposta]" }] };
    case "spacer":
      return { id, type, size: "md" };
  }
}

export function emptyStep(title: string): FunnelStep {
  return { id: newId("s"), title, blocks: [defaultBlock("heading"), defaultBlock("button")] };
}

// ─── Steps ──────────────────────────────────────────────────────────────────

export function addStep(def: FunnelDefinition, afterIndex?: number, title?: string): { def: FunnelDefinition; stepId: string | null } {
  if (def.steps.length >= MAX_STEPS) return { def, stepId: null };
  const step = emptyStep(title ?? `Tela ${def.steps.length + 1}`);
  const at = afterIndex === undefined ? def.steps.length : Math.min(def.steps.length, Math.max(0, afterIndex + 1));
  const steps = def.steps.slice();
  steps.splice(at, 0, step);
  return { def: { ...def, steps }, stepId: step.id };
}

/** Copy of a block with fresh ids (and a free answer name for questions). */
function copyBlock(block: FunnelBlock, def: FunnelDefinition, reserved: Set<string>): FunnelBlock {
  const copy = { ...clone(block), id: newId("b") } as FunnelBlock;
  if (copy.type === "options") {
    let name = freeAnswerName(def, block.type === "options" ? block.name : "pergunta");
    while (reserved.has(name)) name = `${name}_2`.slice(0, 40);
    reserved.add(name);
    copy.name = name;
  }
  return copy;
}

export function duplicateStep(def: FunnelDefinition, stepId: string): { def: FunnelDefinition; stepId: string | null } {
  const i = def.steps.findIndex((s) => s.id === stepId);
  if (i < 0 || def.steps.length >= MAX_STEPS) return { def, stepId: null };
  const src = def.steps[i];
  const reserved = new Set<string>();
  const step: FunnelStep = {
    ...clone(src),
    id: newId("s"),
    title: `${src.title} (cópia)`.slice(0, 120),
    blocks: src.blocks.map((b) => copyBlock(b, def, reserved)),
  };
  const steps = def.steps.slice();
  steps.splice(i + 1, 0, step);
  return { def: { ...def, steps }, stepId: step.id };
}

/** Removes a screen; buttons, options and loading routes that pointed to it go to "next". */
export function removeStep(def: FunnelDefinition, stepId: string): FunnelDefinition {
  if (!def.steps.some((s) => s.id === stepId)) return def;
  const steps = def.steps
    .filter((s) => s.id !== stepId)
    .map((s) => ({ ...s, blocks: s.blocks.map((b) => clearLinksTo(b, stepId)) }));
  return { ...def, steps };
}

function clearLinksTo(block: FunnelBlock, stepId: string): FunnelBlock {
  switch (block.type) {
    case "button":
      return block.action.kind === "goto" && block.action.stepId === stepId ? { ...block, action: { kind: "next" } } : block;
    case "options":
      return block.options.some((o) => o.goto === stepId)
        ? {
            ...block,
            options: block.options.map((o) => {
              if (o.goto !== stepId) return o;
              const rest = { ...o };
              delete rest.goto;
              return rest;
            }),
          }
        : block;
    case "loading":
      return block.routes?.some((r) => r.stepId === stepId) ? { ...block, routes: block.routes.filter((r) => r.stepId !== stepId) } : block;
    default:
      return block;
  }
}

export function moveStep(def: FunnelDefinition, from: number, to: number): FunnelDefinition {
  const steps = move(def.steps, from, to);
  return steps === def.steps ? def : { ...def, steps };
}

export function updateStep(def: FunnelDefinition, stepId: string, patch: Partial<Omit<FunnelStep, "id" | "blocks">>): FunnelDefinition {
  return { ...def, steps: def.steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s)) };
}

// ─── Blocks ─────────────────────────────────────────────────────────────────

export type AddBlockRefusal = "two_options" | "too_many" | "no_step";

/** Why a block cannot be added (null = it can). One question per screen. */
export function addBlockRefusal(def: FunnelDefinition, stepId: string, type: BlockType): AddBlockRefusal | null {
  const step = def.steps.find((s) => s.id === stepId);
  if (!step) return "no_step";
  if (step.blocks.length >= MAX_BLOCKS_PER_STEP) return "too_many";
  if (type === "options" && step.blocks.some((b) => b.type === "options")) return "two_options";
  return null;
}

export function addBlock(
  def: FunnelDefinition,
  stepId: string,
  type: BlockType,
  atIndex?: number
): { def: FunnelDefinition; blockId: string | null } {
  if (addBlockRefusal(def, stepId, type)) return { def, blockId: null };
  const block = defaultBlock(type, def);
  const steps = def.steps.map((s) => {
    if (s.id !== stepId) return s;
    const blocks = s.blocks.slice();
    const at = atIndex === undefined ? blocks.length : Math.min(blocks.length, Math.max(0, atIndex));
    blocks.splice(at, 0, block);
    return { ...s, blocks };
  });
  return { def: { ...def, steps }, blockId: block.id };
}

export function duplicateBlock(def: FunnelDefinition, stepId: string, blockId: string): { def: FunnelDefinition; blockId: string | null } {
  const step = def.steps.find((s) => s.id === stepId);
  const i = step?.blocks.findIndex((b) => b.id === blockId) ?? -1;
  if (!step || i < 0) return { def, blockId: null };
  const src = step.blocks[i];
  if (addBlockRefusal(def, stepId, src.type)) return { def, blockId: null };
  const copy = copyBlock(src, def, new Set());
  const steps = def.steps.map((s) => {
    if (s.id !== stepId) return s;
    const blocks = s.blocks.slice();
    blocks.splice(i + 1, 0, copy);
    return { ...s, blocks };
  });
  return { def: { ...def, steps }, blockId: copy.id };
}

export function removeBlock(def: FunnelDefinition, stepId: string, blockId: string): FunnelDefinition {
  return { ...def, steps: def.steps.map((s) => (s.id === stepId ? { ...s, blocks: s.blocks.filter((b) => b.id !== blockId) } : s)) };
}

export function moveBlock(def: FunnelDefinition, stepId: string, from: number, to: number): FunnelDefinition {
  let changed = false;
  const steps = def.steps.map((s) => {
    if (s.id !== stepId) return s;
    const blocks = move(s.blocks, from, to);
    if (blocks === s.blocks) return s;
    changed = true;
    return { ...s, blocks };
  });
  return changed ? { ...def, steps } : def;
}

/** Shallow merge into a block. The type and the id never change here. */
export function updateBlock(def: FunnelDefinition, stepId: string, blockId: string, patch: Record<string, unknown>): FunnelDefinition {
  const safe = { ...patch };
  delete safe.id;
  delete safe.type;
  return {
    ...def,
    steps: def.steps.map((s) =>
      s.id !== stepId ? s : { ...s, blocks: s.blocks.map((b) => (b.id === blockId ? ({ ...b, ...safe } as FunnelBlock) : b)) }
    ),
  };
}

export function updateSettings(def: FunnelDefinition, patch: Partial<FunnelSettings>): FunnelDefinition {
  return { ...def, settings: { ...def.settings, ...patch } };
}

// ─── Options helpers (used by the properties panel) ─────────────────────────

export function newOption(n: number): FunnelOption {
  return option(`[Opção ${n}]`);
}

export const MAX_OPTIONS_PER_BLOCK = MAX_OPTIONS;

/** Where a block sits: step index and block index (for the "go to" links of the checks). */
export function locateBlock(def: FunnelDefinition, blockId: string): { stepId: string; index: number } | null {
  for (const s of def.steps) {
    const index = s.blocks.findIndex((b) => b.id === blockId);
    if (index >= 0) return { stepId: s.id, index };
  }
  return null;
}

/** One-line summary of a block for the block list. */
export function blockSummary(block: FunnelBlock): string {
  switch (block.type) {
    case "heading":
    case "text":
      return block.text.split("\n")[0];
    case "image":
      return block.alt || block.url;
    case "video":
      return block.title || block.url;
    case "button":
      return block.label;
    case "options":
      return block.question || block.options.map((o) => o.label).join(" · ");
    case "field":
      return block.label;
    case "compare":
      return `${block.before.title} / ${block.after.title}`;
    case "testimonial":
      return block.author;
    case "checklist":
      return block.title || block.items.join(" · ");
    case "countdown":
      return block.label;
    case "loading":
      return block.text;
    case "offer":
      return block.title || "";
    case "gallery":
      return String(block.images.length);
    case "faq":
      return block.items.map((i) => i.q).join(" · ");
    case "spacer":
      return block.size;
  }
}
