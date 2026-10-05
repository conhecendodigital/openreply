"use client";

/**
 * Etapa 6 (Quiz): blocks of the selected screen, top to bottom, with a
 * one-line summary. "+ Block" opens the menu of the 16 types; a second
 * question on the same screen is refused with the reason (one question per
 * screen, like Inlead). Reorder by dragging (desktop) or up/down.
 */

import { useState } from "react";
import { useT } from "@/components/lang-provider";
import { MAX_BLOCKS_PER_STEP } from "@/lib/funnels/schema";
import type { BlockType, FunnelDefinition } from "@/lib/funnels/types";
import {
  addBlock,
  addBlockRefusal,
  blockSummary,
  duplicateBlock,
  moveBlock,
  removeBlock,
} from "@/components/funnels/editor-model";
import { BLOCK_MENU, BLOCK_TYPE_HINT, BLOCK_TYPE_LABEL } from "@/components/funnels/funnel-labels";
import { IconButton, Icons } from "@/components/funnels/form-controls";

type SetDef = (update: (d: FunnelDefinition) => FunnelDefinition) => void;

export default function BlockList({
  def,
  stepId,
  selectedBlockId,
  onSelect,
  setDef,
  counts,
}: {
  def: FunnelDefinition;
  stepId: string;
  selectedBlockId: string | null;
  onSelect: (blockId: string | null) => void;
  setDef: SetDef;
  counts: Map<string, { errors: number; warnings: number }>;
}) {
  const t = useT();
  const [menuOpen, setMenuOpen] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const step = def.steps.find((s) => s.id === stepId);
  if (!step) return null;
  const selectedIndex = step.blocks.findIndex((b) => b.id === selectedBlockId);

  const add = (type: BlockType) => {
    const why = addBlockRefusal(def, stepId, type);
    if (why === "two_options") {
      setRefusal(t("This screen already has a question. Keep one question per screen: add a new screen for the next one."));
      return;
    }
    if (why === "too_many") {
      setRefusal(t("A screen has at most {n} blocks.", { n: MAX_BLOCKS_PER_STEP }));
      return;
    }
    const out = addBlock(def, stepId, type, selectedIndex >= 0 ? selectedIndex + 1 : undefined);
    if (!out.blockId) return;
    setDef(() => out.def);
    setMenuOpen(false);
    setRefusal(null);
    onSelect(out.blockId);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="min-w-0 truncate text-sm font-semibold">
          {t("Blocks")} · <span className="text-muted">{step.title || t("Untitled screen")}</span>
        </h3>
      </div>
      {step.blocks.length === 0 && <p className="rounded-xl bg-surface-hover px-3 py-3 text-sm text-muted">{t("This screen is empty. Add a block.")}</p>}
      <ol className="space-y-1.5">
        {step.blocks.map((block, i) => {
          const selected = block.id === selectedBlockId;
          const c = counts.get(block.id);
          const summary = blockSummary(block);
          return (
            <li
              key={block.id}
              draggable
              onDragStart={(e) => {
                setDragFrom(i);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", block.id);
              }}
              onDragOver={(e) => {
                if (dragFrom === null) return;
                e.preventDefault();
                setDragOver(i);
              }}
              onDragLeave={() => setDragOver((o) => (o === i ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                if (dragFrom !== null && dragFrom !== i) setDef((d) => moveBlock(d, stepId, dragFrom, i));
                setDragFrom(null);
                setDragOver(null);
              }}
              onDragEnd={() => {
                setDragFrom(null);
                setDragOver(null);
              }}
              className={`rounded-xl border ${selected ? "border-accent bg-accent/5" : "border-border bg-background"} ${
                dragOver === i && dragFrom !== i ? "ring-2 ring-accent/40" : ""
              } ${dragFrom === i ? "opacity-50" : ""}`}
            >
              <div className="flex items-center gap-1 pr-1">
                <span className="hidden cursor-grab pl-2 text-muted xl:inline" aria-hidden="true">
                  {Icons.grip}
                </span>
                <button
                  type="button"
                  onClick={() => onSelect(selected ? null : block.id)}
                  aria-pressed={selected}
                  className="flex min-h-11 min-w-0 flex-1 flex-col items-start px-2 py-2 text-left"
                >
                  <span className="flex w-full items-center gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">{t(BLOCK_TYPE_LABEL[block.type])}</span>
                    {block.delaySec ? <span className="text-[11px] text-muted">· {t("after {n}s", { n: block.delaySec })}</span> : null}
                    <span className="flex-1" />
                    {c?.errors ? (
                      <span className="rounded-full bg-error px-1.5 text-[11px] font-semibold text-white" aria-label={t("{n} to fix", { n: c.errors })}>
                        {c.errors}
                      </span>
                    ) : c?.warnings ? (
                      <span className="text-warning" aria-label={t("{n} warnings", { n: c.warnings })}>
                        {Icons.alert}
                      </span>
                    ) : null}
                  </span>
                  {summary && <span className="block w-full truncate text-sm">{summary}</span>}
                </button>
              </div>
              {selected && (
                <div className="flex flex-wrap items-center gap-0.5 border-t border-border px-1 py-1">
                  <IconButton label={t("Move up")} onClick={() => setDef((d) => moveBlock(d, stepId, i, i - 1))} disabled={i === 0}>
                    {Icons.up}
                  </IconButton>
                  <IconButton label={t("Move down")} onClick={() => setDef((d) => moveBlock(d, stepId, i, i + 1))} disabled={i === step.blocks.length - 1}>
                    {Icons.down}
                  </IconButton>
                  <IconButton
                    label={t("Duplicate block")}
                    disabled={block.type === "options" || step.blocks.length >= MAX_BLOCKS_PER_STEP}
                    onClick={() => {
                      const out = duplicateBlock(def, stepId, block.id);
                      if (!out.blockId) return;
                      setDef(() => out.def);
                      onSelect(out.blockId);
                    }}
                  >
                    {Icons.copy}
                  </IconButton>
                  <IconButton
                    label={t("Delete block")}
                    tone="danger"
                    onClick={() => {
                      setDef((d) => removeBlock(d, stepId, block.id));
                      onSelect(null);
                    }}
                  >
                    {Icons.remove}
                  </IconButton>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <button
        type="button"
        aria-expanded={menuOpen}
        onClick={() => {
          setMenuOpen((o) => !o);
          setRefusal(null);
        }}
        className="min-h-11 w-full rounded-xl border border-dashed border-border-hover px-3 text-sm font-semibold text-accent hover:bg-surface-hover"
      >
        + {t("Block")}
      </button>
      {refusal && (
        <p role="alert" className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-[#8a560c]">
          {refusal}
        </p>
      )}
      {menuOpen && (
        <div className="space-y-3 rounded-xl border border-border p-2">
          {BLOCK_MENU.map((group) => (
            <div key={group.group} className="space-y-1">
              <p className="px-2 text-[11px] font-semibold uppercase tracking-wide text-muted">{t(group.group)}</p>
              <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2 xl:grid-cols-1">
                {group.types.map((type) => {
                  const blocked = addBlockRefusal(def, stepId, type) !== null;
                  return (
                    <li key={type}>
                      <button
                        type="button"
                        onClick={() => add(type)}
                        aria-disabled={blocked || undefined}
                        className={`flex min-h-11 w-full flex-col items-start rounded-lg px-2 py-1.5 text-left hover:bg-surface-hover ${blocked ? "opacity-50" : ""}`}
                      >
                        <span className="text-sm font-semibold">{t(BLOCK_TYPE_LABEL[type])}</span>
                        <span className="text-xs text-muted">{t(BLOCK_TYPE_HINT[type])}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
