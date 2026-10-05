/**
 * Etapa 6: modelos prontos. Passam no zod, só reclamam do que falta de dado
 * real (colchetes, preço, checkout, autorização), nada inventado, e o PT dos
 * textos de validação/modelos/blocos existe e segue a régua da marca.
 */
import { describe, expect, it } from "vitest";
import { funnelDefinitionSchema } from "../lib/funnels/schema";
import { BLOCK_TYPE_NAMES, ISSUE_MESSAGES, validateFunnel } from "../lib/funnels/validate";
import { FUNNEL_TEMPLATES, getFunnelTemplate } from "../lib/funnels/templates";
import { ptFunnelsApi } from "../lib/i18n/pt-funnels-api";
import { answerLabels, nextStepId } from "../lib/funnels/navigation";
import type { FunnelBlock } from "../lib/funnels/types";

const ALLOWED = new Set([
  "placeholder_left",
  "offer_no_price",
  "testimonial_not_authorized",
  "compare_not_authorized",
  "checkout_no_url",
  "last_step_no_checkout",
  "guarantee_no_days",
]);
const FORBIDDEN = /—|–|\bprompts?\b|\bskills?\b/i;

describe("modelos prontos", () => {
  it("são 5, com ids estáveis", () => {
    expect(FUNNEL_TEMPLATES.map((t) => t.id)).toEqual(["escada-sim-vsl", "quiz-diagnostico", "baldes", "qual-caminho", "em-branco"]);
    expect(getFunnelTemplate("nao-existe")).toBeNull();
  });

  it.each(FUNNEL_TEMPLATES.map((t) => [t.id, t] as const))("%s passa no zod e só reclama de dado real", (_id, t) => {
    const def = t.build();
    const parsed = funnelDefinitionSchema.safeParse(def);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    const v = validateFunnel(def);
    for (const issue of [...v.errors, ...v.warnings]) expect(ALLOWED.has(issue.code), `${issue.code} ${issue.stepId}`).toBe(true);
    // Bloqueado pra publicar até o dono preencher (nunca vai ao ar com colchete).
    expect(v.ok).toBe(false);
    expect(v.errors.some((i) => i.code === "placeholder_left")).toBe(true);
  });

  it.each(FUNNEL_TEMPLATES.map((t) => [t.id, t] as const))("%s: nada inventado nem fora da régua", (_id, t) => {
    const raw = JSON.stringify(t.build());
    expect(raw).not.toMatch(FORBIDDEN);
    expect(raw).not.toMatch(/R\$\s?\d/);
    for (const step of t.build().steps) {
      for (const b of step.blocks) {
        if (b.type === "offer") {
          expect(b.priceCents).toBeNull();
          expect(b.guaranteeDays ?? null).toBeNull();
        }
        if (b.type === "testimonial" || b.type === "compare") expect(b.authorized).not.toBe(true);
        if (b.type === "button" && b.action.kind === "checkout") expect(b.action.url ?? "").toBe("");
      }
    }
  });

  it("escada-sim-vsl: 6 telas, 1 botão nas 5 primeiras, vídeo só na 6ª, sem voltar/progresso", () => {
    const def = getFunnelTemplate("escada-sim-vsl")!.build();
    expect(def.steps).toHaveLength(6);
    def.steps.forEach((step, i) => {
      const buttons = step.blocks.filter((b) => b.type === "button");
      const videos = step.blocks.filter((b) => b.type === "video");
      if (i < 5) {
        expect(buttons, step.id).toHaveLength(1);
        expect(videos, step.id).toHaveLength(0);
        expect(step.blocks.some((b) => b.type === "options" || b.type === "field")).toBe(false);
      } else {
        expect(videos).toHaveLength(1);
        expect(buttons.every((b) => b.type === "button" && b.action.kind === "checkout")).toBe(true);
        expect(step.blocks.some((b) => b.type === "offer")).toBe(true);
      }
      expect(step.header?.showBack ?? false).toBe(false);
      expect(step.header?.showProgress ?? false).toBe(false);
    });
  });

  it("quiz-diagnostico: 12 telas, etiquetas quiz:* e resultado por pontos da P2", () => {
    const def = getFunnelTemplate("quiz-diagnostico")!.build();
    expect(def.steps).toHaveLength(12);
    const tags = def.steps.flatMap((s) => s.blocks.flatMap((b) => (b.type === "options" ? b.options.map((o) => o.tag) : [])));
    expect(tags.length).toBeGreaterThan(10);
    expect(tags.every((t) => t?.startsWith("quiz:"))).toBe(true);
    const loading = def.steps.find((s) => s.id === "s_carregando")!.blocks[0] as Extract<FunnelBlock, { type: "loading" }>;
    const route = (p2: string) => nextStepId(def, "s_carregando", { kind: "loading", block: loading, answers: { p2: [p2] } });
    expect(route("o_p2_nunca")).toBe("s_resultado_1");
    expect(route("o_p2_as_vezes")).toBe("s_resultado_1");
    expect(route("o_p2_semana")).toBe("s_resultado_2");
    expect(route("o_p2_dia")).toBe("s_resultado_3");
    // Resultado 1 não cai no 2: vai direto pra oferta.
    const btn = def.steps.find((s) => s.id === "s_resultado_1")!.blocks.find((b) => b.type === "button")!;
    expect(btn.type === "button" && nextStepId(def, "s_resultado_1", { kind: "button", action: btn.action })).toBe("s_oferta");
    expect(answerLabels(def, { p3: ["o_p3_outro"] })).toEqual({ p3: "Outro" });
  });

  it("baldes: cada balde vai pro seu ramo; qual-caminho: empate vai pro A", () => {
    const b = getFunnelTemplate("baldes")!.build();
    const balde = b.steps[1].blocks[0] as Extract<FunnelBlock, { type: "options" }>;
    expect(balde.options.map((o) => nextStepId(b, "s_balde", { kind: "option", option: o }))).toEqual(["s_a_situacao", "s_b_situacao", "s_c_situacao"]);
    const q = getFunnelTemplate("qual-caminho")!.build();
    const loading = q.steps.find((s) => s.id === "s_carregando")!.blocks[0] as Extract<FunnelBlock, { type: "loading" }>;
    const go = (answers: Record<string, string[]>) => nextStepId(q, "s_carregando", { kind: "loading", block: loading, answers });
    expect(go({ preferencia: ["o_q1_a"], tempo: ["o_q2_a"], uso: ["o_q3_nao"] })).toBe("s_rec_a");
    expect(go({ preferencia: ["o_q1_b"], tempo: ["o_q2_b"], uso: ["o_q3_bem"] })).toBe("s_rec_b");
    expect(go({})).toBe("s_rec_a");
  });
});

describe("PT da API de funis", () => {
  it("toda mensagem, modelo e tipo de bloco tem PT, sem travessão, 'prompt' ou 'Skill'", () => {
    const keys = [
      ...Object.values(ISSUE_MESSAGES),
      ...FUNNEL_TEMPLATES.flatMap((t) => [t.name, t.description]),
      ...Object.values(BLOCK_TYPE_NAMES),
    ];
    for (const key of keys) {
      expect(ptFunnelsApi[key], key).toBeTruthy();
      expect(ptFunnelsApi[key]).not.toMatch(FORBIDDEN);
    }
    for (const t of FUNNEL_TEMPLATES) expect(ptFunnelsApi[t.name]).toBe(t.namePt);
  });

  it("as variáveis {step} {text} {n} {block} sobrevivem na tradução", () => {
    for (const en of Object.values(ISSUE_MESSAGES)) {
      const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
      expect(vars(ptFunnelsApi[en]), en).toEqual(vars(en));
    }
  });
});
