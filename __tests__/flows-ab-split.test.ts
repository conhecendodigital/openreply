import { describe, expect, it } from "vitest";
import { abSplitIsA } from "@/lib/flows/ab-split";
import { flowDefinitionSchema } from "@/lib/flows/schema";

describe("flow A/B split", () => {
  it("is stable for the same person and splits close to the percentage", () => {
    expect(abSplitIsA("f1", "u1", 70)).toBe(abSplitIsA("f1", "u1", 70));
    let a = 0;
    for (let i = 0; i < 5000; i++) if (abSplitIsA("flow-x", `user-${i}`, 70)) a++;
    expect(a / 5000).toBeGreaterThan(0.66);
    expect(a / 5000).toBeLessThan(0.74);
  });

  it("schema accepts ab_split 1-99 and refuses 0/100", () => {
    const def = (percentA: number) => ({
      trigger: { type: "DM", keywords: ["x"], next: "ab" },
      nodes: [{ id: "ab", type: "condition", check: { kind: "ab_split", percentA }, yes: null, no: null }],
    });
    expect(flowDefinitionSchema.safeParse(def(70)).success).toBe(true);
    expect(flowDefinitionSchema.safeParse(def(0)).success).toBe(false);
    expect(flowDefinitionSchema.safeParse(def(100)).success).toBe(false);
  });
});
