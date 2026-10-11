/**
 * Teste A/B do quiz (11/10/2026): sorteio estável por visitante, troca da
 * tela A pela B mantendo o id, regras do rascunho e o "Criar versão B" do editor.
 */
import { describe, expect, it } from "vitest";
import { abVariantFor, applyAbVariant, hasAbTest, percentB } from "../lib/funnels/ab";
import { funnelDefinitionSchema } from "../lib/funnels/schema";
import { addVariantB, removeStep } from "../components/funnels/editor-model";
import type { FunnelDefinition, FunnelStep } from "../lib/funnels/types";

const theme = { mode: "light" as const, primary: "#0095f6", background: "#ffffff", text: "#000000" };

function def(steps: FunnelDefinition["steps"], abPercentB?: number): FunnelDefinition {
  return { schemaVersion: 1, settings: { theme, ...(abPercentB ? { abPercentB } : {}) }, steps };
}

const capaA: FunnelStep = { id: "s_capa", title: "Capa", blocks: [{ id: "b1", type: "heading" as const, text: "Aula ao vivo" }, { id: "b2", type: "button" as const, label: "Quero", action: { kind: "next" as const } }] };
const capaB: FunnelStep = { id: "s_capa_b", title: "Capa B", abOf: "s_capa", blocks: [{ id: "b1b", type: "heading" as const, text: "Planilha no ChatGPT" }, { id: "b2b", type: "button" as const, label: "Quero", action: { kind: "next" as const } }] };
const fim: FunnelStep = { id: "s_fim", title: "Fim", blocks: [{ id: "b3", type: "text" as const, text: "Pronto" }] };

describe("sorteio A/B", () => {
  it("mesmo visitante cai sempre na mesma versão, e a % vale", () => {
    const ids = Array.from({ length: 2000 }, (_, i) => i.toString(16).padStart(32, "0"));
    expect(ids.map((v) => abVariantFor(v)).filter((x) => x === "B").length).toBe(1000);
    expect(abVariantFor(ids[7])).toBe(abVariantFor(ids[7]));
    const b30 = ids.filter((v) => abVariantFor(v, 30) === "B").length;
    expect(b30).toBe(600);
    expect(abVariantFor("x")).toBe("B"); // id estranho não quebra
  });

  it("% fica entre 10 e 90, padrão 50", () => {
    expect(percentB(undefined)).toBe(50);
    expect(percentB(5)).toBe(10);
    expect(percentB(99)).toBe(90);
  });

  it("A não vê a tela B; B vê o conteúdo da B com o id e o nome da A", () => {
    const steps = [capaA, capaB, fim];
    expect(hasAbTest(steps)).toBe(true);
    expect(applyAbVariant(steps, "A").map((s) => s.id)).toEqual(["s_capa", "s_fim"]);
    expect(applyAbVariant(steps, null).map((s) => s.id)).toEqual(["s_capa", "s_fim"]);
    const b = applyAbVariant(steps, "B");
    expect(b.map((s) => s.id)).toEqual(["s_capa", "s_fim"]);
    expect(b[0].title).toBe("Capa");
    expect(b[0].blocks[0]).toMatchObject({ id: "b1b", text: "Planilha no ChatGPT" });
    expect("abOf" in b[0]).toBe(false);
    expect(hasAbTest([capaA, fim])).toBe(false);
  });
});

describe("regras do rascunho", () => {
  it("aceita tela B válida e % de 10 a 90", () => {
    expect(funnelDefinitionSchema.safeParse(def([capaA, capaB, fim], 30)).success).toBe(true);
    expect(funnelDefinitionSchema.safeParse(def([capaA, capaB, fim], 95)).success).toBe(false);
  });

  it("B de tela que não existe, B de uma B e duas B pra mesma tela = erro", () => {
    expect(funnelDefinitionSchema.safeParse(def([capaA, { ...capaB, abOf: "nao_existe" }, fim])).success).toBe(false);
    const bDeB = { ...fim, id: "s_x", abOf: "s_capa_b" };
    expect(funnelDefinitionSchema.safeParse(def([capaA, capaB, bDeB])).success).toBe(false);
    const outraB = { ...capaB, id: "s_capa_c", blocks: [{ id: "b9", type: "text" as const, text: "C" }] };
    expect(funnelDefinitionSchema.safeParse(def([capaA, capaB, outraB, fim])).success).toBe(false);
  });

  it("a pergunta da B pode guardar a resposta com o mesmo nome da A; outra tela não", () => {
    const pergunta = (id: string, bid: string, extra = {}) => ({
      id,
      title: id,
      ...extra,
      blocks: [{ id: bid, type: "options" as const, name: "ia", multiple: false, options: [{ id: "o1", label: "ChatGPT" }] }],
    });
    expect(funnelDefinitionSchema.safeParse(def([pergunta("s_ia", "q1"), pergunta("s_ia_b", "q2", { abOf: "s_ia" })])).success).toBe(true);
    expect(funnelDefinitionSchema.safeParse(def([pergunta("s_ia_b", "q2", { abOf: "s_ia" }), pergunta("s_ia", "q1")])).success).toBe(true);
    expect(funnelDefinitionSchema.safeParse(def([pergunta("s_ia", "q1"), pergunta("s_outra", "q2")])).success).toBe(false);
  });
});

describe("editor", () => {
  it("Criar versão B: entra logo abaixo, ids novos, mesmo nome de resposta; uma só", () => {
    const d = def([capaA, fim]);
    const out = addVariantB(d, "s_capa");
    expect(out.stepId).toBeTruthy();
    expect(out.def.steps.map((s) => s.abOf ?? null)).toEqual([null, "s_capa", null]);
    const b = out.def.steps[1];
    expect(b.blocks.map((x) => x.id)).not.toContain("b1");
    expect(b.title).toBe("Capa (versão B)");
    expect(funnelDefinitionSchema.safeParse(out.def).success).toBe(true);
    expect(addVariantB(out.def, "s_capa").stepId).toBeNull();
    expect(addVariantB(out.def, b.id).stepId).toBeNull();
  });

  it("apagar a tela A apaga a B junto; apagar a B encerra o teste", () => {
    const d = def([capaA, capaB, fim]);
    expect(removeStep(d, "s_capa").steps.map((s) => s.id)).toEqual(["s_fim"]);
    expect(hasAbTest(removeStep(d, "s_capa_b").steps)).toBe(false);
  });
});
