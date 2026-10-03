"use client";

/**
 * Flow canvas (Etapa 3): @xyflow/react drawing of the flow definition.
 *
 * The definition is the only source of truth. Nodes and edges are derived
 * from it on every render; dragging, connecting and deleting call back into
 * the editor, which edits the definition (components/flows/flow-model.ts).
 * Sizes measured by xyflow are kept here so derived nodes stay visible.
 */

import "@xyflow/react/dist/style.css";
import { memo, useMemo, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import { useT } from "@/components/lang-provider";
import { TRIGGER_NODE_ID, flowEdges, type FlowDefinition, type FlowNode } from "@/lib/flows/schema";
import { NODE_TONE, NODE_TYPE_LABEL, nodeSummary, triggerSummary } from "@/components/flows/flow-labels";
import { isHttpsUrl } from "@/lib/flows/validate";
import { NODE_WIDTH, handleOf, type HandleId } from "@/components/flows/flow-model";

export type NodeBadge = { text: string; tone?: "muted" | "accent" | "warning" | "error" | "success" };

type OutHandle = { id: HandleId; label: string; tone: "default" | "yes" | "no" | "button" | "muted" };

type CardData = {
  kind: FlowNode["type"] | "trigger";
  title: string;
  summary: string;
  image?: string | null;
  buttons: { label: string; link: boolean }[];
  outs: OutHandle[];
  hasTarget: boolean;
  errors: number;
  warnings: number;
  badges: NodeBadge[];
};

type CardNode = Node<CardData, "card">;

const BADGE_TONE: Record<NonNullable<NodeBadge["tone"]>, string> = {
  muted: "bg-surface-hover text-muted",
  accent: "bg-accent/10 text-accent",
  warning: "bg-warning/15 text-[#a8660f]",
  error: "bg-error/10 text-error",
  success: "bg-success/15 text-[#3a8a12]",
};

const HANDLE_TONE: Record<OutHandle["tone"], string> = {
  default: "!bg-foreground",
  yes: "!bg-success",
  no: "!bg-error",
  button: "!bg-accent",
  muted: "!bg-zinc-400",
};

const CardNodeView = memo(function CardNodeView({ data, selected }: NodeProps<CardNode>) {
  return (
    <div
      style={{ width: NODE_WIDTH }}
      className={`rounded-2xl border bg-surface text-left shadow-sm transition-shadow ${
        selected ? "border-accent ring-2 ring-accent/30" : data.errors ? "border-error/60" : "border-border"
      }`}
    >
      {data.hasTarget && (
        <Handle type="target" position={Position.Left} className="!h-3 !w-3 !border-2 !border-white !bg-zinc-400" />
      )}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${NODE_TONE[data.kind]}`} />
        <span className="flex-1 truncate text-xs font-semibold uppercase tracking-wide text-muted">{data.title}</span>
        {data.errors > 0 && (
          <span className="rounded-full bg-error px-1.5 text-[11px] font-semibold text-white">{data.errors}</span>
        )}
        {data.errors === 0 && data.warnings > 0 && (
          <span className="rounded-full bg-warning px-1.5 text-[11px] font-semibold text-white">{data.warnings}</span>
        )}
      </div>
      <div className="space-y-2 px-3 py-2.5">
        {data.image && isHttpsUrl(data.image) && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={data.image} alt="" className="h-20 w-full rounded-lg object-cover" />
        )}
        <p className="whitespace-pre-wrap break-words text-sm leading-snug text-foreground">{data.summary}</p>
        {data.buttons.length > 0 && (
          <div className="space-y-1">
            {data.buttons.map((b, i) => (
              <div key={i} className="truncate rounded-lg bg-surface-hover px-2 py-1 text-center text-xs font-semibold">
                {b.link ? "↗ " : ""}
                {b.label || "…"}
              </div>
            ))}
          </div>
        )}
        {data.badges.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {data.badges.map((b, i) => (
              <span key={i} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${BADGE_TONE[b.tone ?? "muted"]}`}>
                {b.text}
              </span>
            ))}
          </div>
        )}
      </div>
      {data.outs.length > 0 && (
        <div className="border-t border-border py-1">
          {data.outs.map((o) => (
            <div key={o.id} className="relative flex items-center justify-end px-3 py-1">
              <span className="truncate text-[11px] font-medium text-muted">{o.label}</span>
              <Handle
                id={o.id}
                type="source"
                position={Position.Right}
                className={`!h-3 !w-3 !border-2 !border-white ${HANDLE_TONE[o.tone]}`}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

const nodeTypes = { card: CardNodeView };

const EDGE_COLOR: Record<string, string> = {
  next: "#737373",
  yes: "#58c322",
  no: "#ed4956",
  button: "#0095f6",
  timeout: "#a3a3a3",
};

export interface FlowCanvasProps {
  def: FlowDefinition;
  selectedId: string | null;
  issueCount: Map<string, { errors: number; warnings: number }>;
  badges?: Map<string, NodeBadge[]>;
  readOnly?: boolean;
  onSelect: (id: string | null) => void;
  onMove: (id: string, position: { x: number; y: number }) => void;
  onLink: (sourceId: string, handle: HandleId, target: string | null) => void;
  onDelete: (id: string) => void;
}

export default function FlowCanvas(props: FlowCanvasProps) {
  const { def, selectedId, issueCount, badges, readOnly = false, onSelect, onMove, onLink, onDelete } = props;
  const t = useT();
  const [measured, setMeasured] = useState<Record<string, { width: number; height: number }>>({});
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);

  const nodes = useMemo<CardNode[]>(() => {
    const issues = (id: string) => issueCount.get(id) ?? { errors: 0, warnings: 0 };
    const trigger: CardNode = {
      id: TRIGGER_NODE_ID,
      type: "card",
      position: def.trigger.position ?? { x: 0, y: 0 },
      selected: selectedId === TRIGGER_NODE_ID,
      deletable: false,
      measured: measured[TRIGGER_NODE_ID],
      data: {
        kind: "trigger",
        title: t("Trigger"),
        summary: triggerSummary(t, def.trigger),
        buttons: [],
        outs: [{ id: "next", label: t("Then"), tone: "default" }],
        hasTarget: false,
        ...issues(TRIGGER_NODE_ID),
        badges: badges?.get(TRIGGER_NODE_ID) ?? [],
      },
    };
    const rest = def.nodes.map((node): CardNode => {
      const outs: OutHandle[] = [];
      const buttons: CardData["buttons"] = [];
      let image: string | null = null;
      switch (node.type) {
        case "message":
          image = node.imageUrl || null;
          for (const b of node.buttons) {
            buttons.push({ label: b.label, link: b.kind === "link" });
            if (b.kind === "next") outs.push({ id: `btn:${b.id}`, label: t("Tap: {label}", { label: b.label || "…" }), tone: "button" });
          }
          outs.push({ id: "next", label: t("Then"), tone: "default" });
          break;
        case "condition":
          outs.push({ id: "yes", label: t("Yes"), tone: "yes" }, { id: "no", label: t("No"), tone: "no" });
          break;
        case "action":
          outs.push({ id: "next", label: t("Then"), tone: "default" });
          break;
        case "wait":
          if (node.mode === "reply") {
            outs.push(
              { id: "next", label: t("When they reply"), tone: "default" },
              { id: "timeout", label: t("No reply in time"), tone: "muted" }
            );
          } else {
            outs.push({ id: "next", label: t("Then"), tone: "default" });
          }
          break;
        case "end":
          break;
      }
      return {
        id: node.id,
        type: "card",
        position: node.position ?? { x: 0, y: 0 },
        selected: selectedId === node.id,
        measured: measured[node.id],
        data: {
          kind: node.type,
          title: t(NODE_TYPE_LABEL[node.type]),
          summary: nodeSummary(t, node),
          image,
          buttons,
          outs,
          hasTarget: true,
          ...issues(node.id),
          badges: badges?.get(node.id) ?? [],
        },
      };
    });
    return [trigger, ...rest];
  }, [def, selectedId, issueCount, badges, measured, t]);

  const edges = useMemo<Edge[]>(() => {
    const known = new Set([TRIGGER_NODE_ID, ...def.nodes.map((n) => n.id)]);
    return flowEdges(def)
      .filter((e) => known.has(e.target))
      .map((e) => {
        const color = EDGE_COLOR[e.kind] ?? EDGE_COLOR.next;
        return {
          id: e.id,
          selected: e.id === selectedEdge,
          source: e.source,
          target: e.target,
          sourceHandle: handleOf(e),
          type: "smoothstep",
          animated: e.waitsForPerson,
          style: { stroke: color, strokeWidth: 2, ...(e.kind === "timeout" ? { strokeDasharray: "6 4" } : {}) },
          markerEnd: { type: MarkerType.ArrowClosed, color },
        } satisfies Edge;
      });
  }, [def, selectedEdge]);

  function handleNodesChange(changes: NodeChange<CardNode>[]) {
    const sizes: Record<string, { width: number; height: number }> = {};
    for (const c of changes) {
      if (c.type === "dimensions" && c.dimensions) sizes[c.id] = c.dimensions;
      else if (c.type === "position" && c.position && !readOnly) onMove(c.id, c.position);
      else if (c.type === "select" && c.selected) onSelect(c.id);
      else if (c.type === "remove" && !readOnly && c.id !== TRIGGER_NODE_ID) onDelete(c.id);
    }
    if (Object.keys(sizes).length > 0) setMeasured((prev) => ({ ...prev, ...sizes }));
  }

  function handleEdgesChange(changes: EdgeChange[]) {
    for (const c of changes) {
      if (c.type === "select") {
        setSelectedEdge(c.selected ? c.id : null);
        continue;
      }
      if (c.type !== "remove" || readOnly) continue;
      const edge = edges.find((e) => e.id === c.id);
      if (edge?.sourceHandle) onLink(edge.source, edge.sourceHandle as HandleId, null);
    }
  }

  function handleConnect(conn: Connection) {
    if (readOnly || !conn.source || !conn.target || conn.target === TRIGGER_NODE_ID) return;
    onLink(conn.source, (conn.sourceHandle ?? "next") as HandleId, conn.target);
  }

  return (
    <ReactFlow<CardNode, Edge>
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={handleNodesChange}
      onEdgesChange={handleEdgesChange}
      onConnect={handleConnect}
      onBeforeDelete={async ({ nodes: gone }) =>
        gone.length === 0 || window.confirm(t("Delete this step? Links that pointed to it are removed."))
      }
      isValidConnection={(c) =>
        c.target !== TRIGGER_NODE_ID && (c.source !== c.target || String(c.sourceHandle ?? "").startsWith("btn:"))
      }
      onPaneClick={() => {
        setSelectedEdge(null);
        onSelect(null);
      }}
      nodesDraggable={!readOnly}
      nodesConnectable={!readOnly}
      deleteKeyCode={readOnly ? null : ["Backspace", "Delete"]}
      fitView
      fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
      minZoom={0.2}
      maxZoom={1.5}
      proOptions={{ hideAttribution: false }}
    >
      <Background gap={20} size={1} color="#dbdbdb" />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable className="!hidden md:!block" nodeColor="#dbdbdb" />
    </ReactFlow>
  );
}
