/**
 * Pop-ups do quiz (pedido do Matheus, 14/10): botão "Quero sair" abre um
 * pop-up de retenção; pop-up por saída e por tempo abrem sozinhos 1x por visita.
 * Sem settings.popups, o quiz continua igual.
 */
import { describe, expect, it } from "vitest";
import type { FunnelDefinition, FunnelPopup } from "../lib/funnels/types";
import { MAX_POPUPS, parseFunnelDefinition } from "../lib/funnels/schema";
import { validateFunnel } from "../lib/funnels/validate";
import { nextStepId } from "../lib/funnels/navigation";
import { exitPopupFor, findPopup, hasExitPopup, popupOnStep, timedPopupsFor } from "../lib/funnels/popups";
import { addPopup, removePopup, removeStep, updatePopup } from "../components/funnels/editor-model";

const NOW = new Date("2026-10-14T12:00:00Z");

const retencao: FunnelPopup = {
  id: "p1",
  title: "Espera, antes de sair",
  text: "Falta só uma tela pra você ver o resultado.",
  primary: { label: "Quero continuar", action: { kind: "goto", stepId: "s2" } },
  secondary: { label: "Quero sair mesmo", action: { kind: "close" }, delaySec: 3 },
};

function base(popups?: FunnelPopup[]): FunnelDefinition {
  const def: FunnelDefinition = {
    schemaVersion: 1,
    settings: {
      theme: { mode: "light", primary: "#0095f6", background: "#ffffff", text: "#000000" },
      checkoutUrl: "https://pay.hotmart.com/X123",
    },
    steps: [
      {
        id: "s1",
        title: "Comando",
        blocks: [
          { id: "b1", type: "heading", text: "Seu Comando" },
          { id: "b2", type: "button", label: "Quero ver a aula", action: { kind: "next" } },
          { id: "b3", type: "button", label: "Quero sair", action: { kind: "popup", popupId: "p1" } },
        ],
      },
      {
        id: "s2",
        title: "Oferta",
        blocks: [
          { id: "b4", type: "heading", text: "Ingresso VIP" },
          { id: "b5", type: "button", label: "Garantir", action: { kind: "checkout" } },
        ],
      },
    ],
  };
  if (popups) def.settings.popups = popups;
  return def;
}

describe("lib/funnels/popups", () => {
  const saida: FunnelPopup = { ...retencao, id: "p2", trigger: { exit: true, stepIds: ["s2"] } };
  const tempo30: FunnelPopup = { ...retencao, id: "p3", trigger: { afterSec: 30 } };
  const tempo10: FunnelPopup = { ...retencao, id: "p4", trigger: { afterSec: 10, stepIds: ["s1"] } };
  const settings = { popups: [retencao, saida, tempo30, tempo10] };

  it("acha pelo id e devolve null quando não existe", () => {
    expect(findPopup(settings, "p2")?.id).toBe("p2");
    expect(findPopup(settings, "nada")).toBeNull();
    expect(findPopup(undefined, "p1")).toBeNull();
  });

  it("sem telas marcadas vale em todas", () => {
    expect(popupOnStep(retencao, "qualquer")).toBe(true);
    expect(popupOnStep(saida, "s1")).toBe(false);
    expect(popupOnStep(saida, "s2")).toBe(true);
  });

  it("pop-up de saída: só na tela certa e só 1x", () => {
    expect(hasExitPopup(settings)).toBe(true);
    expect(hasExitPopup({ popups: [retencao] })).toBe(false);
    expect(exitPopupFor(settings, "s1", new Set())).toBeNull();
    expect(exitPopupFor(settings, "s2", new Set())?.id).toBe("p2");
    expect(exitPopupFor(settings, "s2", new Set(["p2"]))).toBeNull();
  });

  it("pop-up por tempo: do mais cedo pro mais tarde, sem os já mostrados", () => {
    expect(timedPopupsFor(settings, "s1", new Set()).map((t) => [t.popup.id, t.afterMs])).toEqual([
      ["p4", 10_000],
      ["p3", 30_000],
    ]);
    expect(timedPopupsFor(settings, "s2", new Set()).map((t) => t.popup.id)).toEqual(["p3"]);
    expect(timedPopupsFor(settings, "s1", new Set(["p3", "p4"]))).toEqual([]);
    expect(timedPopupsFor(undefined, "s1", new Set())).toEqual([]);
  });
});

describe("schema e validação", () => {
  it("funil sem popups continua válido e igual", () => {
    const parsed = parseFunnelDefinition(base());
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.definition.settings.popups).toBeUndefined();
  });

  it("aceita pop-up completo com gatilhos", () => {
    const p: FunnelPopup = {
      ...retencao,
      imageUrl: "https://cdn.exemplo.com/foto.jpg",
      trigger: { exit: true, afterSec: 45, stepIds: ["s1"] },
    };
    expect(parseFunnelDefinition(base([p])).ok).toBe(true);
  });

  it("recusa id repetido, mais de 10 pop-ups e tempo fora do limite", () => {
    expect(parseFunnelDefinition(base([retencao, { ...retencao }])).ok).toBe(false);
    const muitos = Array.from({ length: MAX_POPUPS + 1 }, (_, i) => ({ ...retencao, id: `p${i + 1}` }));
    expect(parseFunnelDefinition(base(muitos)).ok).toBe(false);
    expect(parseFunnelDefinition(base([{ ...retencao, trigger: { afterSec: 0 } }])).ok).toBe(false);
    expect(parseFunnelDefinition(base([{ ...retencao, secondary: { ...retencao.secondary!, delaySec: 20 } }])).ok).toBe(false);
  });

  it("botão que abre pop-up que não existe vira erro popup_missing", () => {
    const sem = validateFunnel(base(), NOW);
    expect(sem.ok).toBe(false);
    expect(sem.errors.some((i) => i.code === "popup_missing")).toBe(true);
    const com = validateFunnel(base([retencao]), NOW);
    expect([...com.errors, ...com.warnings].some((i) => i.code === "popup_missing")).toBe(false);
  });

  it("botão de pop-up não troca de tela", () => {
    expect(nextStepId(base([retencao]), "s1", { kind: "button", action: { kind: "popup", popupId: "p1" } })).toBeNull();
  });
});

describe("editor-model", () => {
  it("addPopup cria com [colchetes] e trava no limite", () => {
    const { def, popupId } = addPopup(base());
    expect(popupId).toBeTruthy();
    expect(def.settings.popups).toHaveLength(1);
    expect(def.settings.popups?.[0].text).toMatch(/\[/);
    const cheio = base(Array.from({ length: MAX_POPUPS }, (_, i) => ({ ...retencao, id: `p${i + 1}` })));
    expect(addPopup(cheio).popupId).toBeNull();
  });

  it("updatePopup tira campo vazio", () => {
    const def = updatePopup(base([retencao]), "p1", { secondary: undefined, title: "Novo" });
    expect(def.settings.popups?.[0].title).toBe("Novo");
    expect("secondary" in (def.settings.popups?.[0] ?? {})).toBe(false);
  });

  it("removePopup: botão que abria vira próxima tela e a lista some se vazia", () => {
    const def = removePopup(base([retencao]), "p1");
    expect(def.settings.popups).toBeUndefined();
    const botao = def.steps[0].blocks.find((b) => b.id === "b3");
    expect(botao?.type === "button" && botao.action).toEqual({ kind: "next" });
  });

  it("removeStep limpa destino e telas do pop-up", () => {
    const p: FunnelPopup = { ...retencao, trigger: { exit: true, stepIds: ["s1", "s2"] } };
    const def = removeStep(base([p]), "s2");
    const depois = def.settings.popups?.[0];
    expect(depois?.primary.action).toEqual({ kind: "next" });
    expect(depois?.trigger?.stepIds).toEqual(["s1"]);
  });
});
