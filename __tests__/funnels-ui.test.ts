import { describe, expect, it } from "vitest";
import { translate } from "../lib/i18n";
import { pt } from "../lib/i18n/pt";
import { ptFunnels } from "../lib/i18n/pt-funnels";
import { BLOCK_TYPES, FUNNEL_ISSUE_CODES, type FunnelDefinition } from "../lib/funnels/types";
import { emptyFunnelDefinition, funnelDefinitionSchema } from "../lib/funnels/schema";
import { FUNNEL_TEMPLATES, getFunnelTemplate } from "../lib/funnels/templates";
import { ISSUE_MESSAGES, validateFunnel } from "../lib/funnels/validate";
import {
  addBlock,
  addBlockRefusal,
  addStep,
  defaultBlock,
  duplicateBlock,
  duplicateStep,
  moveBlock,
  moveStep,
  removeBlock,
  removeStep,
  updateBlock,
  updateSettings,
  updateStep,
} from "../components/funnels/editor-model";
import { BLOCK_TYPE_LABEL, funnelLabelKeys, issueText } from "../components/funnels/funnel-labels";
import { FUNNEL_ERROR_CODES, FUNNEL_ERROR_TEXT, funnelErrorText } from "../components/funnels/funnel-api";
import { contrastRatio, onColor } from "../components/funnels/funnel-player";

const tPt = (k: string, v?: Record<string, string | number>) => translate("pt", k, v);

function expectValid(def: FunnelDefinition) {
  const r = funnelDefinitionSchema.safeParse(def);
  if (!r.success) throw new Error(JSON.stringify(r.error.issues.slice(0, 3)));
  expect(r.success).toBe(true);
}

describe("editor-model", () => {
  it("defaultBlock of every type passes the zod", () => {
    for (const type of BLOCK_TYPES) {
      const def = emptyFunnelDefinition();
      def.steps[0].blocks = [defaultBlock(type, def)];
      expectValid(def);
    }
  });

  it("adds every block type to a screen and keeps the definition valid", () => {
    let def = emptyFunnelDefinition();
    const stepId = def.steps[0].id;
    for (const type of BLOCK_TYPES) {
      const out = addBlock(def, stepId, type);
      expect(out.blockId).not.toBeNull();
      def = out.def;
    }
    expectValid(def);
    expect(def.steps[0].blocks.length).toBe(2 + BLOCK_TYPES.length);
  });

  it("never adds a second question to the same screen", () => {
    const def = addBlock(emptyFunnelDefinition(), "s_capa", "options").def;
    expect(addBlockRefusal(def, "s_capa", "options")).toBe("two_options");
    const again = addBlock(def, "s_capa", "options");
    expect(again.blockId).toBeNull();
    expect(again.def).toBe(def);
    const optionsId = def.steps[0].blocks.find((b) => b.type === "options")!.id;
    expect(duplicateBlock(def, "s_capa", optionsId).blockId).toBeNull();
  });

  it("adds, duplicates, moves and removes screens and blocks without breaking the zod", () => {
    let def = getFunnelTemplate("quiz-diagnostico")!.build();
    const first = def.steps[0].id;
    const added = addStep(def, 0, "Nova");
    def = added.def;
    expect(def.steps[1].id).toBe(added.stepId);
    def = duplicateStep(def, def.steps[2].id).def; // a question screen: copy gets a free answer name
    expectValid(def);
    def = moveStep(def, 0, 3);
    expect(def.steps[3].id).toBe(first);
    const s = def.steps[1];
    def = moveBlock(def, s.id, 0, s.blocks.length - 1);
    const dup = duplicateBlock(def, s.id, def.steps[1].blocks[0].id);
    def = dup.def;
    def = removeBlock(def, s.id, dup.blockId!);
    def = updateStep(def, s.id, { title: "Renomeada", header: { showBack: true } });
    def = updateBlock(def, s.id, def.steps[1].blocks[0].id, { id: "hacked", type: "spacer", delaySec: 2 });
    expect(def.steps[1].blocks[0].id).not.toBe("hacked");
    expect(def.steps[1].blocks[0].delaySec).toBe(2);
    def = updateSettings(def, { pixelId: "123456789" });
    expectValid(def);
  });

  it("removing a screen clears the gotos and the loading routes that pointed to it", () => {
    for (const tpl of FUNNEL_TEMPLATES) {
      let def = tpl.build();
      // remove every screen that something points to, one by one
      const targets = new Set<string>();
      for (const st of def.steps)
        for (const b of st.blocks) {
          if (b.type === "button" && b.action.kind === "goto") targets.add(b.action.stepId);
          if (b.type === "options") b.options.forEach((o) => o.goto && targets.add(o.goto));
          if (b.type === "loading") b.routes?.forEach((r) => targets.add(r.stepId));
        }
      for (const id of targets) def = removeStep(def, id);
      expectValid(def);
      const codes = validateFunnel(def).errors.map((e) => e.code);
      expect(codes).not.toContain("goto_missing");
      expect(codes).not.toContain("route_missing");
    }
  });

  it("templates stay valid after a duplicate of every screen", () => {
    for (const tpl of FUNNEL_TEMPLATES) {
      let def = tpl.build();
      for (const st of [...def.steps]) def = duplicateStep(def, st.id).def;
      expectValid(def);
    }
  });
});

describe("labels and i18n of the quiz screens", () => {
  it("has a Portuguese sentence for every validation issue", () => {
    for (const code of FUNNEL_ISSUE_CODES) {
      const text = issueText(tPt, { code, params: { step: "Capa", block: "b_1", n: 2, text: "[x]" } });
      expect(text, code).not.toBe(ISSUE_MESSAGES[code]);
      expect(text, code).not.toMatch(/\{(step|block|n|text)\}/);
    }
  });

  it("explains every API error code in Portuguese", () => {
    for (const code of FUNNEL_ERROR_CODES) {
      const text = funnelErrorText(tPt, { success: false, error: "x", details: { code } });
      expect(text, code).toBe(pt[FUNNEL_ERROR_TEXT[code]]);
      expect(text, code).toBeTruthy();
    }
    expect(funnelErrorText(tPt, { success: false, error: "network" })).toBe(pt["No connection. Try again."]);
  });

  it("translates the labels kept as data (block names, hints, groups, status)", () => {
    for (const k of [...funnelLabelKeys(), ...Object.values(BLOCK_TYPE_LABEL)]) expect(k in pt, k).toBe(true);
    for (const tpl of FUNNEL_TEMPLATES) {
      expect(tpl.name in pt, tpl.name).toBe(true);
      expect(tpl.description in pt, tpl.description).toBe(true);
    }
  });

  it("keeps the brand rules in the Portuguese texts", () => {
    for (const [k, v] of Object.entries(ptFunnels)) {
      expect(v, k).not.toMatch(/[—–]/);
      expect(v, k).not.toMatch(/\bprompt/i);
      expect(v, k).not.toMatch(/\bskill/i);
    }
  });

  it("no older key overrides a quiz translation with another meaning", () => {
    const changed = Object.keys(ptFunnels).filter((k) => pt[k] !== ptFunnels[k]);
    expect(changed).toEqual([]);
  });
});

describe("player colors", () => {
  it("keeps white text on the Instagram blue and switches to black on light colors", () => {
    expect(onColor("#0095f6")).toBe("#ffffff");
    expect(onColor("#ffd400")).toBe("#000000");
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
  });
});
