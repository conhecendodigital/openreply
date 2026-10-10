"use client";

/**
 * Mapa do funil (aba Funis do admin, 10/10/2026): o mesmo desenho do mapa de
 * referência do dono. Redes e mensagens em círculo, páginas desenhadas como
 * janelinha de navegador, eventos (compra, pix/boleto, não comprou) em losango,
 * seta cheia no caminho principal e tracejada na recuperação. Dá pra arrastar
 * os blocos pra olhar melhor; nada é salvo.
 */

import "@xyflow/react/dist/style.css";
import { memo, useMemo } from "react";
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import { mapText, type FunnelMap, type MapNodeKind, type MapSide } from "@/lib/admin-funnels/maps";
import { BRAND_ICONS, type BrandIcon } from "@/lib/admin-funnels/brand-icons";

type Lang = "pt" | "en";
type BlockData = { kind: MapNodeKind; label: string; metric: string | null };
type BlockNode = Node<BlockData, "block">;

const BLUE = "#1a8cff";

const ROUND: Partial<Record<MapNodeKind, { bg: string; icon: string }>> = {
  instagram: { bg: "linear-gradient(135deg,#f58529,#dd2a7b 50%,#8134af)", icon: "instagram" },
  facebook: { bg: "#1877f2", icon: "facebook" },
  youtube: { bg: "#ff0033", icon: "youtube" },
  dm: { bg: "#7b61ff", icon: "dm" },
  whatsapp: { bg: "#25d366", icon: "whatsapp" },
  email: { bg: BLUE, icon: "email" },
  call: { bg: "#13b5a6", icon: "call" },
};

const DIAMOND: Partial<Record<MapNodeKind, { bg: string; icon: string }>> = {
  paid: { bg: "#1fc47a", icon: "dollar" },
  pending: { bg: "#a77bff", icon: "pix" },
  lost: { bg: "#2cc4c4", icon: "cart" },
};

function Icon({ name }: { name: string }) {
  // Logos e Pix vêm do @edusites/icons (texto fixo do código, nunca de quem usa o painel).
  if (name in BRAND_ICONS) {
    const size = name === "pix" ? "h-4 w-4" : "h-6 w-6";
    return <span className={`block ${size} text-white`} aria-hidden dangerouslySetInnerHTML={{ __html: BRAND_ICONS[name as BrandIcon] }} />;
  }
  const p = { fill: "none", stroke: "#fff", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (name) {
    case "instagram":
      return <svg viewBox="0 0 24 24" className="h-6 w-6"><rect {...p} x="4" y="4" width="16" height="16" rx="5" /><circle {...p} cx="12" cy="12" r="3.5" /><circle cx="17" cy="7" r="1" fill="#fff" /></svg>;
    case "facebook":
      return <svg viewBox="0 0 24 24" className="h-6 w-6"><path {...p} d="M14 8h2V4h-2a4 4 0 0 0-4 4v2H8v4h2v6h4v-6h2l1-4h-3V8z" /></svg>;
    case "youtube":
      return <svg viewBox="0 0 24 24" className="h-6 w-6"><rect {...p} x="3" y="6" width="18" height="12" rx="4" /><path d="M10 9.5v5l4.5-2.5z" fill="#fff" /></svg>;
    case "dm":
      return <svg viewBox="0 0 24 24" className="h-6 w-6"><path {...p} d="M21 3 3 10l7 3 3 7z" /><path {...p} d="m10 13 4-4" /></svg>;
    case "whatsapp":
      return <svg viewBox="0 0 24 24" className="h-6 w-6"><path {...p} d="M4 20l1.3-3.8A8 8 0 1 1 8 19z" /><path {...p} d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 .8a4 4 0 0 1-1.8-1.8l.8-1-1-2z" /></svg>;
    case "email":
      return <svg viewBox="0 0 24 24" className="h-6 w-6"><rect {...p} x="3" y="6" width="18" height="12" rx="2" /><path {...p} d="m3 7 9 6 9-6" /></svg>;
    case "call":
      return <svg viewBox="0 0 24 24" className="h-6 w-6"><rect {...p} x="3" y="6" width="13" height="12" rx="2" /><path {...p} d="m16 10 5-3v10l-5-3" /></svg>;
    case "dollar":
      return <svg viewBox="0 0 24 24" className="h-5 w-5"><path {...p} d="M12 3v18M16 7.5c0-1.4-1.8-2.5-4-2.5s-4 1.1-4 2.6S9.8 10 12 11s4 1.6 4 3.4-1.8 2.6-4 2.6-4-1.1-4-2.5" /></svg>;
    case "doc":
      return <svg viewBox="0 0 24 24" className="h-5 w-5"><rect {...p} x="6" y="4" width="12" height="16" rx="2" /><path {...p} d="M9 9h6M9 12h6M9 15h4" /></svg>;
    case "cart":
      return <svg viewBox="0 0 24 24" className="h-5 w-5"><path {...p} d="M3 4h2l2 11h11l2-8H6.5" /><circle cx="9" cy="19" r="1.5" fill="#fff" /><circle cx="17" cy="19" r="1.5" fill="#fff" /></svg>;
    default:
      return null;
  }
}

function PageBody({ kind }: { kind: MapNodeKind }) {
  const line = (w: string) => <div className="h-1 rounded-full bg-[#1a8cff]/40" style={{ width: w }} />;
  const button = (text: string) => (
    <div className="rounded-sm bg-[#1a8cff] py-0.5 text-center text-[7px] font-bold tracking-wide text-white">{text}</div>
  );
  if (kind === "page-checkout") {
    return (
      <div className="flex flex-col items-center gap-1.5">
        <svg viewBox="0 0 24 24" className="h-8 w-8"><circle cx="12" cy="12" r="9" fill="none" stroke={BLUE} strokeWidth="1.5" /><path d="m8 12 3 3 5-6" fill="none" stroke={BLUE} strokeWidth="1.5" /></svg>
        <div className="w-full space-y-1">{line("100%")}{line("70%")}</div>
        <div className="w-full">{button("COMPRAR")}</div>
      </div>
    );
  }
  if (kind === "page-upsell") {
    return (
      <div className="space-y-1.5">
        <div className="space-y-1">{line("90%")}{line("60%")}</div>
        <div className="flex h-8 items-center justify-center rounded-sm border border-[#1a8cff]/60">
          <svg viewBox="0 0 24 24" className="h-4 w-4"><path d="M9 7v10l8-5z" fill="none" stroke={BLUE} strokeWidth="1.5" /></svg>
        </div>
        {button("SIM, QUERO")}
      </div>
    );
  }
  if (kind === "page-quiz" || kind === "page-form") {
    return (
      <div className="space-y-1.5">
        {line("80%")}
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-2.5 rounded-sm border border-[#1a8cff]/50" />
        ))}
        {button(kind === "page-quiz" ? "COMEÇAR" : "ENVIAR")}
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <div className="flex h-8 items-center justify-center rounded-sm border border-[#1a8cff]/60">
        <svg viewBox="0 0 24 24" className="h-4 w-4"><path d="m4 18 5-6 4 4 3-3 4 5z" fill="none" stroke={BLUE} strokeWidth="1.5" /><circle cx="16" cy="8" r="1.5" fill={BLUE} /></svg>
      </div>
      <div className="space-y-1">{line("100%")}{line("60%")}</div>
      {button("QUERO")}
    </div>
  );
}

const SIDES: [MapSide, Position][] = [["l", Position.Left], ["r", Position.Right], ["t", Position.Top], ["b", Position.Bottom]];

const hidden = { opacity: 0, width: 1, height: 1, minWidth: 0, minHeight: 0, border: 0 };

const Block = memo(function Block({ data }: NodeProps<BlockNode>) {
  const round = ROUND[data.kind];
  const diamond = DIAMOND[data.kind];
  return (
    <div className="flex w-[150px] flex-col items-center gap-1.5 text-center">
      <div className="text-[11px] font-semibold leading-tight text-foreground">{data.label}</div>
      <div className="relative flex items-center justify-center">
        {SIDES.map(([id, pos]) => (
          <Handle key={`t-${id}`} id={`t-${id}`} type="target" position={pos} style={hidden} />
        ))}
        {round && (
          <div className="flex h-12 w-12 items-center justify-center rounded-full shadow-md" style={{ background: round.bg }}>
            <Icon name={round.icon} />
          </div>
        )}
        {diamond && (
          <div className="flex h-10 w-10 rotate-45 items-center justify-center rounded-md shadow-md" style={{ background: diamond.bg }}>
            <div className="-rotate-45"><Icon name={diamond.icon} /></div>
          </div>
        )}
        {!round && !diamond && (
          <div className="w-[120px] rounded-md border border-border bg-white shadow-md">
            <div className="flex gap-1 border-b border-border px-1.5 py-1">
              <span className="h-1.5 w-1.5 rounded-full bg-[#ff5f57]" />
              <span className="h-1.5 w-1.5 rounded-full bg-[#febc2e]" />
              <span className="h-1.5 w-1.5 rounded-full bg-[#28c840]" />
            </div>
            <div className="p-2"><PageBody kind={data.kind} /></div>
          </div>
        )}
        {SIDES.map(([id, pos]) => (
          <Handle key={`s-${id}`} id={`s-${id}`} type="source" position={pos} style={hidden} />
        ))}
      </div>
      {data.metric !== null && (
        <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[11px] font-semibold tabular-nums">{data.metric}</span>
      )}
    </div>
  );
});

const nodeTypes = { block: Block };

export default function FunnelMapView({
  map,
  lang,
  metrics,
}: {
  map: FunnelMap;
  lang: Lang;
  metrics?: Partial<Record<string, number>>;
}) {
  const fmt = useMemo(() => new Intl.NumberFormat(lang === "pt" ? "pt-BR" : "en-US"), [lang]);
  const nodes: BlockNode[] = useMemo(
    () =>
      map.nodes.map((n) => {
        const value = n.metric && metrics ? metrics[n.metric] : undefined;
        return {
          id: n.id,
          type: "block",
          position: { x: n.x, y: n.y },
          data: { kind: n.kind, label: mapText(n.label, lang), metric: typeof value === "number" ? fmt.format(value) : null },
        };
      }),
    [map, lang, metrics, fmt]
  );
  const edges: Edge[] = useMemo(
    () =>
      map.edges.map((e, i) => ({
        id: `${e.from}-${e.to}-${i}`,
        source: e.from,
        target: e.to,
        sourceHandle: `s-${e.fromSide ?? "r"}`,
        targetHandle: `t-${e.toSide ?? "l"}`,
        label: e.label ? mapText(e.label, lang) : undefined,
        animated: false,
        style: { stroke: BLUE, strokeWidth: 1.6, ...(e.dashed ? { strokeDasharray: "6 5" } : {}) },
        markerEnd: { type: MarkerType.ArrowClosed, color: BLUE, width: 16, height: 16 },
      })),
    [map, lang]
  );

  return (
    <div className="h-[460px] w-full overflow-hidden rounded-2xl border border-border bg-white">
      <ReactFlow
        key={`${map.id}:${nodes.map((n) => n.data.metric ?? "").join(",")}:${lang}`}
        defaultNodes={nodes}
        defaultEdges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        // The canvas can mount before its box has the final width: fit again once it settles.
        onInit={(rf) => window.setTimeout(() => void rf.fitView({ padding: 0.15 }), 120)}
        nodesConnectable={false}
        edgesFocusable={false}
        proOptions={{ hideAttribution: true }}
        minZoom={0.3}
      >
        <Background gap={20} color="#eef2f7" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
