/**
 * Flow definition (Flow.draft / Flow.published), validated with zod.
 *
 * Browser-safe (no server imports): the builder screen uses these types too.
 *
 * The links live inside each node (next, yes/no, buttons[].next, onTimeout),
 * so the canvas edges are derived from the nodes (flowEdges) and there is one
 * source of truth. The trigger is not in `nodes`: there is exactly one per
 * flow, by construction, and its canvas id is TRIGGER_NODE_ID.
 *
 * This schema only checks SHAPE (and size), so a half-written draft saves.
 * What a flow needs before it can be published lives in lib/flows/validate.ts.
 */
import { z } from "zod";

export const FLOW_SCHEMA_VERSION = 1;
export const TRIGGER_NODE_ID = "trigger";
export const MAX_FLOW_NODES = 50;
export const MAX_FLOW_KEYWORDS = 10;
export const MAX_KEYWORD_LENGTH = 50;
export const MAX_FLOW_TEXT = 1000;
/** Meta caps a button template's text at 640 characters. */
export const MAX_BUTTON_TEXT = 640;
export const MAX_BUTTONS = 3;
/** Meta caps a button title at 20 characters. */
export const MAX_BUTTON_LABEL = 20;
export const MIN_WAIT_MIN = 1;
/** Same ceiling as a sequence step: a wait never outlives the 24 h window. */
export const MAX_WAIT_MIN = 1380;
export const MAX_FLOW_NAME = 100;
export const MAX_TAG = 60;
/** Runtime guard against loops (a flow never runs more steps than this). */
export const MAX_RUN_STEPS = 30;

export const FLOW_TRIGGERS = [
  "COMMENT",
  "DM",
  "STORY_REPLY",
  "STORY_MENTION",
  "LIVE_COMMENT",
  "CONVERSATION_LINK",
] as const;
export type FlowTriggerType = (typeof FLOW_TRIGGERS)[number];

export const NODE_TYPES = ["message", "condition", "action", "wait", "end"] as const;
export type FlowNodeType = (typeof NODE_TYPES)[number];

const nodeId = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[A-Za-z0-9_-]+$/, "Use letters, numbers, - or _");
const ref = nodeId.optional().nullable();
const position = z.object({ x: z.number().finite(), y: z.number().finite() });

export const flowTriggerSchema = z.object({
  type: z.enum(FLOW_TRIGGERS),
  postId: z.string().max(100).optional().nullable(),
  postUrl: z.string().max(500).optional().nullable(),
  matchAnyPost: z.boolean().optional().default(false),
  storyId: z.string().max(100).optional().nullable(),
  conversationLinkId: z.string().max(100).optional().nullable(),
  keywords: z.array(z.string().max(MAX_KEYWORD_LENGTH)).max(MAX_FLOW_KEYWORDS).optional().default([]),
  matchAnyWord: z.boolean().optional().default(false),
  wholeWordMatch: z.boolean().optional().default(true),
  next: ref,
  position: position.optional(),
});

const buttonId = z.string().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/);

export const flowButtonSchema = z.discriminatedUnion("kind", [
  z.object({
    id: buttonId,
    kind: z.literal("link"),
    label: z.string().max(MAX_BUTTON_LABEL),
    url: z.string().max(2000),
  }),
  z.object({
    id: buttonId,
    kind: z.literal("next"),
    label: z.string().max(MAX_BUTTON_LABEL),
    next: ref,
  }),
]);

const messageNode = z.object({
  id: nodeId,
  type: z.literal("message"),
  position: position.optional(),
  text: z.string().max(MAX_FLOW_TEXT),
  imageUrl: z.string().max(2000).optional().nullable(),
  buttons: z.array(flowButtonSchema).max(MAX_BUTTONS).optional().default([]),
  next: ref,
});

const conditionNode = z.object({
  id: nodeId,
  type: z.literal("condition"),
  position: position.optional(),
  check: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("follows") }),
    z.object({ kind: z.literal("has_tag"), tag: z.string().max(MAX_TAG) }),
    /** Clicked a link of this flow (in this run). nodeId = only that node's links. */
    z.object({ kind: z.literal("clicked"), nodeId: ref }),
  ]),
  yes: ref,
  no: ref,
});

const actionNode = z.object({
  id: nodeId,
  type: z.literal("action"),
  position: position.optional(),
  action: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("add_tag"), tag: z.string().max(MAX_TAG) }),
    z.object({ kind: z.literal("remove_tag"), tag: z.string().max(MAX_TAG) }),
    z.object({ kind: z.literal("notify_owner"), note: z.string().max(500).optional().nullable() }),
    /** A draft for a human to approve. The flow NEVER sends or approves it. */
    z.object({
      kind: z.literal("propose_draft"),
      text: z.string().max(MAX_FLOW_TEXT),
      reason: z.string().max(500).optional().nullable(),
    }),
    /** Human takeover: the robot stops talking to this person. */
    z.object({ kind: z.literal("handoff"), hours: z.number().int().min(1).max(168).optional().nullable() }),
  ]),
  next: ref,
});

const waitNode = z.discriminatedUnion("mode", [
  z.object({
    id: nodeId,
    type: z.literal("wait"),
    mode: z.literal("delay"),
    position: position.optional(),
    minutes: z.number().int().min(MIN_WAIT_MIN).max(MAX_WAIT_MIN),
    next: ref,
  }),
  z.object({
    id: nodeId,
    type: z.literal("wait"),
    mode: z.literal("reply"),
    position: position.optional(),
    /** Give up after this long (default MAX_WAIT_MIN). */
    timeoutMinutes: z.number().int().min(MIN_WAIT_MIN).max(MAX_WAIT_MIN).optional().nullable(),
    next: ref,
    /** Where to go when nobody answered in time; empty = the run ends. */
    onTimeout: ref,
  }),
]);

const endNode = z.object({
  id: nodeId,
  type: z.literal("end"),
  position: position.optional(),
});

// z.discriminatedUnion cannot nest a discriminated union (wait) by "type", so
// the node is a plain union; every member has a literal "type".
export const flowNodeSchema = z.union([messageNode, conditionNode, actionNode, waitNode, endNode]);

export const flowDefinitionSchema = z
  .object({
    schemaVersion: z.literal(FLOW_SCHEMA_VERSION).optional().default(FLOW_SCHEMA_VERSION),
    trigger: flowTriggerSchema,
    nodes: z.array(flowNodeSchema).max(MAX_FLOW_NODES),
  })
  .superRefine((def, ctx) => {
    const seen = new Set<string>();
    def.nodes.forEach((node, index) => {
      if (node.id === TRIGGER_NODE_ID) {
        ctx.addIssue({ code: "custom", path: ["nodes", index, "id"], message: `"${TRIGGER_NODE_ID}" is reserved` });
      }
      if (seen.has(node.id)) {
        ctx.addIssue({ code: "custom", path: ["nodes", index, "id"], message: `Duplicate node id ${node.id}` });
      }
      seen.add(node.id);
      if (node.type === "message") {
        const ids = new Set<string>();
        node.buttons.forEach((b, bi) => {
          if (ids.has(b.id)) {
            ctx.addIssue({ code: "custom", path: ["nodes", index, "buttons", bi, "id"], message: "Duplicate button id" });
          }
          ids.add(b.id);
        });
      }
    });
  });

export type FlowDefinition = z.infer<typeof flowDefinitionSchema>;
export type FlowDefinitionInput = z.input<typeof flowDefinitionSchema>;
export type FlowTrigger = FlowDefinition["trigger"];
export type FlowNode = FlowDefinition["nodes"][number];
export type FlowButton = z.infer<typeof flowButtonSchema>;
export type MessageNode = Extract<FlowNode, { type: "message" }>;
export type ConditionNode = Extract<FlowNode, { type: "condition" }>;
export type ActionNode = Extract<FlowNode, { type: "action" }>;
export type WaitNode = Extract<FlowNode, { type: "wait" }>;

export function parseFlowDefinition(
  value: unknown
): { ok: true; definition: FlowDefinition } | { ok: false; issues: z.core.$ZodIssue[] } {
  const parsed = flowDefinitionSchema.safeParse(value);
  return parsed.success ? { ok: true, definition: parsed.data } : { ok: false, issues: parsed.error.issues };
}

/** A new flow's starting point: a trigger with nothing after it. */
export function emptyFlowDefinition(type: FlowTriggerType = "COMMENT"): FlowDefinition {
  return {
    schemaVersion: FLOW_SCHEMA_VERSION,
    trigger: {
      type,
      postId: null,
      postUrl: null,
      matchAnyPost: false,
      storyId: null,
      conversationLinkId: null,
      keywords: [],
      matchAnyWord: false,
      wholeWordMatch: true,
      next: null,
      position: { x: 0, y: 0 },
    },
    nodes: [],
  };
}

export type FlowEdgeKind = "next" | "yes" | "no" | "button" | "timeout";

export type FlowEdge = {
  id: string;
  source: string;
  target: string;
  kind: FlowEdgeKind;
  /** The button, for kind "button". */
  buttonId?: string;
  /** True when the person's tap or reply is what moves the run on. */
  waitsForPerson: boolean;
};

/** Every link of the flow, for the canvas (xyflow edges) and the validator. */
export function flowEdges(def: Pick<FlowDefinition, "trigger" | "nodes">): FlowEdge[] {
  const edges: FlowEdge[] = [];
  const add = (source: string, target: string | null | undefined, kind: FlowEdgeKind, extra: Partial<FlowEdge> = {}) => {
    if (!target) return;
    edges.push({
      id: `${source}:${kind}${extra.buttonId ? `:${extra.buttonId}` : ""}`,
      source,
      target,
      kind,
      waitsForPerson: false,
      ...extra,
    });
  };
  add(TRIGGER_NODE_ID, def.trigger.next, "next");
  for (const node of def.nodes) {
    switch (node.type) {
      case "message":
        for (const b of node.buttons) {
          if (b.kind === "next") add(node.id, b.next, "button", { buttonId: b.id, waitsForPerson: true });
        }
        add(node.id, node.next, "next");
        break;
      case "condition":
        add(node.id, node.yes, "yes");
        add(node.id, node.no, "no");
        break;
      case "action":
        add(node.id, node.next, "next");
        break;
      case "wait":
        if (node.mode === "reply") {
          add(node.id, node.next, "next", { waitsForPerson: true });
          add(node.id, node.onTimeout, "timeout");
        } else {
          add(node.id, node.next, "next");
        }
        break;
      case "end":
        break;
    }
  }
  return edges;
}

/** Node ids in breadth-first order from the trigger (the phone list view). */
export function bfsOrder(def: Pick<FlowDefinition, "trigger" | "nodes">): string[] {
  const edges = flowEdges(def);
  const known = new Set(def.nodes.map((n) => n.id));
  const order: string[] = [];
  const seen = new Set<string>([TRIGGER_NODE_ID]);
  const queue = [TRIGGER_NODE_ID];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const e of edges) {
      if (e.source !== id || seen.has(e.target) || !known.has(e.target)) continue;
      seen.add(e.target);
      order.push(e.target);
      queue.push(e.target);
    }
  }
  return order;
}

/** Does this flow's trigger need keywords? (Same rule as campaigns.) */
export function triggerNeedsKeywords(trigger: Pick<FlowTrigger, "type" | "matchAnyWord">): boolean {
  if (trigger.type === "STORY_MENTION" || trigger.type === "CONVERSATION_LINK") return false;
  return !trigger.matchAnyWord;
}

/** Comment triggers answer with the one private reply first. */
export function triggerIsComment(type: FlowTriggerType): boolean {
  return type === "COMMENT" || type === "LIVE_COMMENT";
}

/** Portuguese label (MCP, list). Screens use t() with their own keys. */
export function flowTriggerLabel(t: Partial<FlowTrigger> & { type?: FlowTriggerType | string | null }): string {
  switch (t.type) {
    case "DM":
      return "mensagem no Direct";
    case "STORY_REPLY":
      return t.storyId ? `resposta do story ${t.storyId}` : "resposta de qualquer story";
    case "STORY_MENTION":
      return "menção no story";
    case "LIVE_COMMENT":
      return "comentário em qualquer live";
    case "CONVERSATION_LINK":
      return "link de conversa (ig.me)";
    case "COMMENT":
      return t.matchAnyPost ? "comentário em qualquer post" : t.postUrl ? `comentário no post ${t.postUrl}` : "comentário em post";
    default:
      return "sem gatilho";
  }
}
