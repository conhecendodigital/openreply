import { describe, expect, it } from "vitest";
import { pt } from "../lib/i18n/pt";
import { translate } from "../lib/i18n";
import { TRIGGER_NODE_ID, emptyFlowDefinition, flowDefinitionSchema, flowEdges, type FlowDefinition } from "../lib/flows/schema";
import { validateFlow, type FlowIssueCode } from "../lib/flows/validate";
import {
  addNode,
  autoLayout,
  ensurePositions,
  linkOf,
  listOrder,
  removeNode,
  setLink,
  setPosition,
} from "../components/flows/flow-model";
import { FLOW_LABEL_KEYS, issueText, nodeSummary, triggerSummary } from "../components/flows/flow-labels";

const t = (k: string, v?: Record<string, string | number>) => translate("pt", k, v);

function base(): FlowDefinition {
  const def = emptyFlowDefinition("DM");
  return { ...def, trigger: { ...def.trigger, keywords: ["QUERO"] } };
}

describe("flow builder model", () => {
  it("adds a node linked to the free handle and keeps the definition valid for zod", () => {
    const first = addNode(base(), "message", { sourceId: TRIGGER_NODE_ID, handle: "next" });
    expect(first.def.trigger.next).toBe(first.id);
    const second = addNode(first.def, "end", { sourceId: first.id, handle: "next" });
    expect(linkOf(second.def, first.id, "next")).toBe(second.id);
    expect(flowDefinitionSchema.safeParse(second.def).success).toBe(true);
    // The new node lands to the right of the one it comes from.
    const from = second.def.nodes.find((n) => n.id === first.id)!.position!;
    const to = second.def.nodes.find((n) => n.id === second.id)!.position!;
    expect(to.x).toBeGreaterThan(from.x);
  });

  it("links buttons, yes/no and timeout through handle ids", () => {
    let def = addNode(base(), "message", { sourceId: TRIGGER_NODE_ID, handle: "next" }).def;
    const msgId = def.trigger.next!;
    def = {
      ...def,
      nodes: def.nodes.map((n) =>
        n.type === "message" ? { ...n, text: "Oi", buttons: [{ id: "b1", kind: "next" as const, label: "Quero", next: null }] } : n
      ),
    };
    const cond = addNode(def, "condition", { sourceId: msgId, handle: "btn:b1" });
    def = cond.def;
    expect(linkOf(def, msgId, "btn:b1")).toBe(cond.id);
    const yes = addNode(def, "end", { sourceId: cond.id, handle: "yes" });
    def = setLink(yes.def, cond.id, "no", yes.id);
    const kinds = flowEdges(def).map((e) => `${e.source}:${e.kind}`);
    expect(kinds).toContain(`${cond.id}:yes`);
    expect(kinds).toContain(`${cond.id}:no`);
    expect(kinds).toContain(`${msgId}:button`);
    expect(validateFlow(flowDefinitionSchema.parse(def)).ok).toBe(true);
  });

  it("removing a node clears every link that pointed at it", () => {
    let def = addNode(base(), "message", { sourceId: TRIGGER_NODE_ID, handle: "next" }).def;
    const id = def.trigger.next!;
    def = removeNode(def, id);
    expect(def.nodes).toHaveLength(0);
    expect(def.trigger.next).toBeNull();
  });

  it("lays out by distance from the trigger and fills missing positions", () => {
    let def = addNode(base(), "message", { sourceId: TRIGGER_NODE_ID, handle: "next" }).def;
    const a = def.trigger.next!;
    def = addNode(def, "end", { sourceId: a, handle: "next" }).def;
    def = setPosition(def, a, { x: 999, y: 999 });
    const laid = autoLayout(def);
    expect(laid.trigger.position).toEqual({ x: 0, y: 0 });
    expect(laid.nodes[0].position!.x).toBeLessThan(laid.nodes[1].position!.x);
    const noPos: FlowDefinition = { ...def, nodes: def.nodes.map((n) => ({ ...n, position: undefined })) };
    expect(ensurePositions(noPos).nodes.every((n) => n.position)).toBe(true);
  });

  it("lists reachable steps first, loose ones after", () => {
    let def = addNode(base(), "message", { sourceId: TRIGGER_NODE_ID, handle: "next" }).def;
    const loose = addNode(def, "wait");
    def = loose.def;
    expect(listOrder(def, [def.trigger.next!])).toEqual([def.trigger.next, loose.id]);
  });
});

describe("flow screen texts", () => {
  it("has Portuguese for every label the flow screens build from codes", () => {
    const missing = FLOW_LABEL_KEYS.filter((k) => !(k in pt));
    expect(missing).toEqual([]);
  });

  it("translates validator codes and summaries", () => {
    const code: FlowIssueCode = "loose_node";
    expect(issueText(t, { code, message: "x" })).toBe("Este passo está solto, sem ligação com o fluxo");
    expect(triggerSummary(t, { ...base().trigger })).toBe("Mensagem no Direct · QUERO");
    expect(nodeSummary(t, { id: "w", type: "wait", mode: "delay", minutes: 90, next: null })).toBe("Esperar 1 h 30 min");
  });
});
