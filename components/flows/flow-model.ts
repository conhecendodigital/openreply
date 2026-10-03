/**
 * Builder-side helpers for the flow definition (browser-safe, no React).
 *
 * The definition (lib/flows/schema.ts) keeps the links inside each node, so
 * every edit here returns a NEW definition: link a handle to a node, remove a
 * node (and every link that pointed at it), create a node next to another,
 * lay the canvas out. The screens never keep a second copy of the edges.
 *
 * Canvas handle ids: "next", "yes", "no", "timeout" and "btn:<buttonId>".
 */
import {
  MAX_BUTTONS,
  MAX_WAIT_MIN,
  MIN_WAIT_MIN,
  TRIGGER_NODE_ID,
  flowEdges,
  type FlowDefinition,
  type FlowEdge,
  type FlowNode,
  type FlowNodeType,
} from "@/lib/flows/schema";

export type HandleId = "next" | "yes" | "no" | "timeout" | `btn:${string}`;

export const NODE_WIDTH = 260;
const COL_GAP = 340;
const ROW_GAP = 190;

export function handleOf(edge: Pick<FlowEdge, "kind" | "buttonId">): HandleId {
  if (edge.kind === "button") return `btn:${edge.buttonId}`;
  return edge.kind;
}

function randomPart(): string {
  const bytes = new Uint8Array(4);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => (b % 36).toString(36)).join("");
}

const PREFIX: Record<FlowNodeType, string> = {
  message: "msg",
  condition: "cond",
  action: "acao",
  wait: "espera",
  end: "fim",
};

export function newNodeId(def: FlowDefinition, type: FlowNodeType): string {
  const taken = new Set(def.nodes.map((n) => n.id));
  for (;;) {
    const id = `${PREFIX[type]}_${randomPart()}`;
    if (!taken.has(id) && id !== TRIGGER_NODE_ID) return id;
  }
}

export function newButtonId(node: Extract<FlowNode, { type: "message" }>): string {
  const taken = new Set(node.buttons.map((b) => b.id));
  for (let i = 1; ; i++) if (!taken.has(`b${i}`)) return `b${i}`;
}

export function makeNode(type: FlowNodeType, id: string, position: { x: number; y: number }): FlowNode {
  switch (type) {
    case "message":
      return { id, type, position, text: "", imageUrl: null, buttons: [], next: null };
    case "condition":
      return { id, type, position, check: { kind: "follows" }, yes: null, no: null };
    case "action":
      return { id, type, position, action: { kind: "add_tag", tag: "" }, next: null };
    case "wait":
      return { id, type, mode: "delay", position, minutes: 10, next: null };
    case "end":
      return { id, type, position };
  }
}

export function positionOf(def: FlowDefinition, id: string): { x: number; y: number } {
  if (id === TRIGGER_NODE_ID) return def.trigger.position ?? { x: 0, y: 0 };
  return def.nodes.find((n) => n.id === id)?.position ?? { x: 0, y: 0 };
}

/** Where a new node goes: to the right of `fromId`, or after the right-most node. */
export function nextPosition(def: FlowDefinition, fromId?: string | null): { x: number; y: number } {
  const all = [def.trigger.position ?? { x: 0, y: 0 }, ...def.nodes.map((n) => n.position ?? { x: 0, y: 0 })];
  if (fromId) {
    const from = positionOf(def, fromId);
    const x = from.x + COL_GAP;
    let y = from.y;
    // Step down until the spot is free.
    while (all.some((p) => Math.abs(p.x - x) < NODE_WIDTH && Math.abs(p.y - y) < ROW_GAP - 40)) y += ROW_GAP;
    return { x, y };
  }
  const maxX = Math.max(...all.map((p) => p.x));
  return { x: maxX + COL_GAP, y: 0 };
}

/** Point one handle of `sourceId` at `target` (null = remove the link). */
export function setLink(def: FlowDefinition, sourceId: string, handle: HandleId, target: string | null): FlowDefinition {
  if (sourceId === TRIGGER_NODE_ID) {
    return handle === "next" ? { ...def, trigger: { ...def.trigger, next: target } } : def;
  }
  return {
    ...def,
    nodes: def.nodes.map((node): FlowNode => {
      if (node.id !== sourceId) return node;
      switch (node.type) {
        case "message":
          if (handle.startsWith("btn:")) {
            const bid = handle.slice(4);
            return {
              ...node,
              buttons: node.buttons.map((b) => (b.id === bid && b.kind === "next" ? { ...b, next: target } : b)),
            };
          }
          return handle === "next" ? { ...node, next: target } : node;
        case "condition":
          if (handle === "yes") return { ...node, yes: target };
          if (handle === "no") return { ...node, no: target };
          return node;
        case "action":
          return handle === "next" ? { ...node, next: target } : node;
        case "wait":
          if (handle === "next") return { ...node, next: target };
          if (handle === "timeout" && node.mode === "reply") return { ...node, onTimeout: target };
          return node;
        case "end":
          return node;
      }
    }),
  };
}

/** Where one handle points now. */
export function linkOf(def: FlowDefinition, sourceId: string, handle: HandleId): string | null {
  const edge = flowEdges(def).find((e) => e.source === sourceId && handleOf(e) === handle);
  return edge?.target ?? null;
}

/** Remove a node and every link that pointed at it. */
export function removeNode(def: FlowDefinition, id: string): FlowDefinition {
  const clear = (ref: string | null | undefined) => (ref === id ? null : ref ?? null);
  return {
    ...def,
    trigger: { ...def.trigger, next: clear(def.trigger.next) },
    nodes: def.nodes
      .filter((n) => n.id !== id)
      .map((node): FlowNode => {
        switch (node.type) {
          case "message":
            return {
              ...node,
              next: clear(node.next),
              buttons: node.buttons.map((b) => (b.kind === "next" ? { ...b, next: clear(b.next) } : b)),
            };
          case "condition":
            return {
              ...node,
              yes: clear(node.yes),
              no: clear(node.no),
              check: node.check.kind === "clicked" ? { ...node.check, nodeId: clear(node.check.nodeId) } : node.check,
            };
          case "action":
            return { ...node, next: clear(node.next) };
          case "wait":
            return node.mode === "reply"
              ? { ...node, next: clear(node.next), onTimeout: clear(node.onTimeout) }
              : { ...node, next: clear(node.next) };
          case "end":
            return node;
        }
      }),
  };
}

export function updateNode(def: FlowDefinition, id: string, patch: (node: FlowNode) => FlowNode): FlowDefinition {
  return { ...def, nodes: def.nodes.map((n) => (n.id === id ? patch(n) : n)) };
}

/** Add a node; when `from` is given, link that handle to it. */
export function addNode(
  def: FlowDefinition,
  type: FlowNodeType,
  from?: { sourceId: string; handle: HandleId } | null
): { def: FlowDefinition; id: string } {
  const id = newNodeId(def, type);
  const node = makeNode(type, id, nextPosition(def, from?.sourceId));
  let out: FlowDefinition = { ...def, nodes: [...def.nodes, node] };
  if (from) out = setLink(out, from.sourceId, from.handle, id);
  return { def: out, id };
}

export function setPosition(def: FlowDefinition, id: string, position: { x: number; y: number }): FlowDefinition {
  if (id === TRIGGER_NODE_ID) return { ...def, trigger: { ...def.trigger, position } };
  return { ...def, nodes: def.nodes.map((n) => (n.id === id ? { ...n, position } : n)) };
}

/** Left-to-right layout by distance from the trigger; loose nodes go last. */
export function autoLayout(def: FlowDefinition): FlowDefinition {
  const edges = flowEdges(def);
  const known = new Set(def.nodes.map((n) => n.id));
  const depth = new Map<string, number>([[TRIGGER_NODE_ID, 0]]);
  const queue = [TRIGGER_NODE_ID];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const e of edges) {
      if (e.source !== id || !known.has(e.target) || depth.has(e.target)) continue;
      depth.set(e.target, (depth.get(id) ?? 0) + 1);
      queue.push(e.target);
    }
  }
  const maxDepth = Math.max(0, ...depth.values());
  const rows = new Map<number, number>();
  const place = (d: number) => {
    const row = rows.get(d) ?? 0;
    rows.set(d, row + 1);
    return { x: d * COL_GAP, y: row * ROW_GAP };
  };
  const trigger = { ...def.trigger, position: place(0) };
  const ordered = [...def.nodes].sort((a, b) => (depth.get(a.id) ?? 1e9) - (depth.get(b.id) ?? 1e9));
  const positions = new Map<string, { x: number; y: number }>();
  for (const n of ordered) positions.set(n.id, place(depth.get(n.id) ?? maxDepth + 1));
  return { ...def, trigger, nodes: def.nodes.map((n) => ({ ...n, position: positions.get(n.id) })) };
}

/** A flow saved without positions (an API key, an old draft) gets a layout. */
export function ensurePositions(def: FlowDefinition): FlowDefinition {
  const missing = !def.trigger.position || def.nodes.some((n) => !n.position);
  const stacked =
    def.nodes.length > 1 &&
    new Set(def.nodes.map((n) => `${n.position?.x ?? 0}:${n.position?.y ?? 0}`)).size === 1;
  return missing || stacked ? autoLayout(def) : def;
}

export function clampWaitMinutes(value: number): number {
  if (!Number.isFinite(value)) return MIN_WAIT_MIN;
  return Math.min(MAX_WAIT_MIN, Math.max(MIN_WAIT_MIN, Math.round(value)));
}

export function canAddButton(node: Extract<FlowNode, { type: "message" }>): boolean {
  return node.buttons.length < MAX_BUTTONS;
}

/** The flow's message nodes that carry a link button (for "clicked the link?"). */
export function linkMessageNodes(def: FlowDefinition) {
  return def.nodes.filter(
    (n): n is Extract<FlowNode, { type: "message" }> => n.type === "message" && n.buttons.some((b) => b.kind === "link")
  );
}

/** Ids reachable from the trigger, in breadth-first order, then the loose ones. */
export function listOrder(def: FlowDefinition, bfs: string[]): string[] {
  const seen = new Set(bfs);
  return [...bfs, ...def.nodes.map((n) => n.id).filter((id) => !seen.has(id))];
}
