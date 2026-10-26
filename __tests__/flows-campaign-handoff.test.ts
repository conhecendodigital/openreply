import { describe, expect, it } from "vitest";
import { handoffStartNode } from "@/lib/flows/campaign-handoff";
import { abSplitIsA } from "@/lib/flows/ab-split";
import { flowDefinitionSchema, type FlowDefinition } from "@/lib/flows/schema";

const def: FlowDefinition = flowDefinitionSchema.parse({
  trigger: { type: "COMMENT", keywords: ["x"], next: "teste_ab" },
  nodes: [
    { id: "teste_ab", type: "condition", check: { kind: "ab_split", percentA: 70 }, yes: "a_pagina", no: "b_abertura" },
    { id: "a_pagina", type: "message", text: "Comando + página", buttons: [{ id: "a1", kind: "link", label: "Ver", url: "https://x.y" }, { id: "a2", kind: "next", label: "Mais", next: "uso" }] },
    { id: "b_abertura", type: "message", text: "Toca aqui", buttons: [{ id: "b1", kind: "next", label: "Quero o Comando", next: "b_comando" }] },
    { id: "b_comando", type: "message", text: "Comando", buttons: [] },
    { id: "uso", type: "end" },
  ],
});

describe("tap on the opening DM of a campaign that became a flow", () => {
  it("A goes to the page message, B skips the opening it already tapped", () => {
    for (let i = 0; i < 50; i++) {
      const user = `u${i}`;
      const start = handoffStartNode(def, "f1", user);
      expect(start).toBe(abSplitIsA("f1", user, 70) ? "a_pagina" : "b_comando");
    }
  });

  it("flow without A/B: skips a plain opening", () => {
    const plain = flowDefinitionSchema.parse({
      trigger: { type: "COMMENT", keywords: ["x"], next: "abertura" },
      nodes: [
        { id: "abertura", type: "message", text: "Toca", buttons: [{ id: "b", kind: "next", label: "Quero", next: "comandos" }] },
        { id: "comandos", type: "message", text: "Comando", buttons: [] },
      ],
    });
    expect(handoffStartNode(plain, "f", "u")).toBe("comandos");
  });
});
