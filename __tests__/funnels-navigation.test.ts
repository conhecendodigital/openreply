/**
 * Etapa 6: navegação do player (próxima tela, destino, pontos, progresso) e
 * o texto rico mínimo (nunca HTML).
 */
import { describe, expect, it } from "vitest";
import type { FunnelDefinition, LoadingBlock } from "../lib/funnels/types";
import { answerLabels, nextStepId, progressPct, stepIndex, totalScore } from "../lib/funnels/navigation";
import { hasPlaceholder, interpolate, parseRichText } from "../lib/funnels/text";

const def: FunnelDefinition = {
  schemaVersion: 1,
  settings: { theme: { mode: "light", primary: "#0095f6", background: "#ffffff", text: "#000000" } },
  steps: [
    {
      id: "s1",
      title: "P1",
      blocks: [
        {
          id: "b1",
          type: "options",
          name: "nivel",
          multiple: false,
          options: [
            { id: "o0", label: "Zero", score: 0 },
            { id: "o1", label: "Um", score: 1, goto: "s4" },
            { id: "o2", label: "Dois", score: 2, goto: "nao-existe" },
          ],
        },
      ],
    },
    {
      id: "s2",
      title: "P2",
      blocks: [
        {
          id: "b2",
          type: "options",
          name: "temas",
          multiple: true,
          options: [
            { id: "t1", label: "IA", score: 1 },
            { id: "t2", label: "Vídeo", score: 1 },
            { id: "t3", label: "Foto" },
          ],
        },
      ],
    },
    { id: "s3", title: "Carregando", blocks: [] },
    { id: "s4", title: "Fim", blocks: [] },
  ],
};

const loading = (routes: LoadingBlock["routes"]): LoadingBlock => ({ id: "l1", type: "loading", text: "...", routes });

describe("nextStepId", () => {
  it("next, goto, goto inexistente e checkout", () => {
    expect(nextStepId(def, "s1", { kind: "button", action: { kind: "next" } })).toBe("s2");
    expect(nextStepId(def, "s1", { kind: "button", action: { kind: "goto", stepId: "s4" } })).toBe("s4");
    expect(nextStepId(def, "s1", { kind: "button", action: { kind: "goto", stepId: "sumiu" } })).toBe("s2");
    expect(nextStepId(def, "s1", { kind: "button", action: { kind: "checkout" } })).toBeNull();
  });

  it("última tela + next = null", () => {
    expect(nextStepId(def, "s4", { kind: "button", action: { kind: "next" } })).toBeNull();
  });

  it("opção com goto, sem goto e com goto quebrado", () => {
    const opts = (def.steps[0].blocks[0] as unknown as { options: unknown }).options as { id: string; label: string; goto?: string }[];
    expect(nextStepId(def, "s1", { kind: "option", option: opts[1] })).toBe("s4");
    expect(nextStepId(def, "s1", { kind: "option", option: opts[0] })).toBe("s2");
    expect(nextStepId(def, "s1", { kind: "option", option: opts[2] })).toBe("s2");
  });

  it("múltipla: continuar vai pra próxima", () => {
    expect(nextStepId(def, "s2", { kind: "continue" })).toBe("s3");
  });

  it("loading com faixas de pontos; nenhuma casa = próxima", () => {
    const routes = [
      { max: 1, stepId: "s1" },
      { min: 2, max: 2, stepId: "s2" },
      { min: 3, stepId: "s4" },
    ];
    const answers = (nivel: string[], temas: string[] = []) => ({ nivel, temas });
    expect(totalScore(def, answers(["o2"], ["t1", "t2"]))).toBe(4);
    expect(nextStepId(def, "s3", { kind: "loading", block: loading(routes), answers: answers(["o0"]) })).toBe("s1");
    expect(nextStepId(def, "s3", { kind: "loading", block: loading(routes), answers: answers(["o2"]) })).toBe("s2");
    expect(nextStepId(def, "s3", { kind: "loading", block: loading(routes), answers: answers(["o2"], ["t1"]) })).toBe("s4");
    expect(nextStepId(def, "s3", { kind: "loading", block: loading([{ min: 10, stepId: "s1" }]), answers: answers(["o0"]) })).toBe("s4");
    expect(nextStepId(def, "s3", { kind: "loading", block: loading([{ min: 0, stepId: "nao-existe" }]), answers: answers(["o0"]) })).toBe("s4");
  });
});

describe("progresso e respostas", () => {
  it("progressPct e stepIndex", () => {
    expect(stepIndex(def, "s3")).toBe(2);
    expect(progressPct(def, "s1")).toBe(25);
    expect(progressPct(def, "s4")).toBe(100);
    expect(progressPct(def, "x")).toBe(0);
  });

  it("answerLabels junta rótulos com vírgula", () => {
    expect(answerLabels(def, { nivel: ["o1"], temas: ["t1", "t3"], fantasma: ["z"] })).toEqual({ nivel: "Um", temas: "IA, Foto" });
  });
});

describe("texto rico", () => {
  it("interpolate troca {resposta.x}; sem resposta = vazio", () => {
    expect(interpolate("Você quer {resposta.nivel} e {resposta.nada}.", { nivel: "Um" })).toBe("Você quer Um e .");
  });

  it("negrito, itálico, lista e quebra de linha", () => {
    expect(parseRichText("Olá **mundo** e *você*\n- item 1\n- **item 2**\n\nFim")).toEqual([
      { kind: "p", runs: [{ text: "Olá " }, { text: "mundo", bold: true }, { text: " e " }, { text: "você", italic: true }] },
      { kind: "li", runs: [{ text: "item 1" }] },
      { kind: "li", runs: [{ text: "item 2", bold: true }] },
      { kind: "p", runs: [{ text: "Fim" }] },
    ]);
  });

  it("<script> vira texto, nunca HTML", () => {
    const lines = parseRichText("<script>alert(1)</script>");
    expect(lines).toEqual([{ kind: "p", runs: [{ text: "<script>alert(1)</script>" }] }]);
  });

  it("hasPlaceholder acha [colchete] de 2+ caracteres", () => {
    expect(hasPlaceholder("Descubra [resultado]")).toBe(true);
    expect(hasPlaceholder("Sem colchete [x]")).toBe(false);
    expect(hasPlaceholder("Nada")).toBe(false);
  });
});
