"use client";

/**
 * Etapa 6 (Quiz): the screens of the funnel, in order. Drag and drop with
 * native HTML5 on desktop, plus up/down buttons that always work (phone,
 * keyboard). The selected screen shows its actions: rename, duplicate,
 * delete. A red badge counts the errors that block publishing.
 */

import { useState } from "react";
import { useT } from "@/components/lang-provider";
import { MAX_STEPS } from "@/lib/funnels/schema";
import type { FunnelDefinition } from "@/lib/funnels/types";
import { addStep, duplicateStep, moveStep, removeStep, updateStep } from "@/components/funnels/editor-model";
import { IconButton, Icons } from "@/components/funnels/form-controls";

type SetDef = (update: (d: FunnelDefinition) => FunnelDefinition) => void;

export default function StepList({
  def,
  selectedStepId,
  onSelect,
  setDef,
  counts,
}: {
  def: FunnelDefinition;
  selectedStepId: string;
  onSelect: (stepId: string) => void;
  setDef: SetDef;
  counts: Map<string, { errors: number; warnings: number }>;
}) {
  const t = useT();
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const selectedIndex = def.steps.findIndex((s) => s.id === selectedStepId);
  const full = def.steps.length >= MAX_STEPS;

  const add = () => {
    const out = addStep(def, selectedIndex >= 0 ? selectedIndex : undefined, t("Screen {n}", { n: def.steps.length + 1 }));
    if (!out.stepId) return;
    setDef(() => out.def);
    onSelect(out.stepId);
  };
  const duplicate = () => {
    const out = duplicateStep(def, selectedStepId);
    if (!out.stepId) return;
    setDef(() => out.def);
    onSelect(out.stepId);
  };
  const remove = (id: string, title: string) => {
    if (def.steps.length <= 1) return;
    if (!window.confirm(t("Delete the screen “{name}”? Buttons and options that went to it will go to the next screen.", { name: title }))) return;
    const i = def.steps.findIndex((s) => s.id === id);
    setDef((d) => removeStep(d, id));
    const next = def.steps[i + 1] ?? def.steps[i - 1];
    if (next) onSelect(next.id);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t("Screens")}</h3>
        <span className="text-xs text-muted">{t("{n} of {max}", { n: def.steps.length, max: MAX_STEPS })}</span>
      </div>
      <ol className="space-y-1.5">
        {def.steps.map((step, i) => {
          const selected = step.id === selectedStepId;
          const c = counts.get(step.id);
          return (
            <li
              key={step.id}
              draggable
              onDragStart={(e) => {
                setDragFrom(i);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", step.id);
              }}
              onDragOver={(e) => {
                if (dragFrom === null) return;
                e.preventDefault();
                setDragOver(i);
              }}
              onDragLeave={() => setDragOver((o) => (o === i ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                if (dragFrom !== null && dragFrom !== i) setDef((d) => moveStep(d, dragFrom, i));
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
                  onClick={() => onSelect(step.id)}
                  aria-current={selected ? "step" : undefined}
                  className="flex min-h-11 min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left"
                >
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-surface-hover text-xs font-semibold">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{step.title || t("Untitled screen")}</span>
                  {c?.errors ? (
                    <span className="flex items-center gap-0.5 rounded-full bg-error px-1.5 text-[11px] font-semibold text-white" aria-label={t("{n} to fix", { n: c.errors })}>
                      {c.errors}
                    </span>
                  ) : c?.warnings ? (
                    <span className="text-warning" aria-label={t("{n} warnings", { n: c.warnings })}>
                      {Icons.alert}
                    </span>
                  ) : null}
                </button>
              </div>
              {selected && (
                <div className="space-y-2 border-t border-border px-2 pb-2 pt-2">
                  <label className="sr-only" htmlFor={`step-title-${step.id}`}>
                    {t("Screen name")}
                  </label>
                  <input
                    id={`step-title-${step.id}`}
                    value={step.title}
                    maxLength={120}
                    onChange={(e) => setDef((d) => updateStep(d, step.id, { title: e.target.value }))}
                    placeholder={t("Screen name")}
                    className="min-h-11 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-border-hover"
                  />
                  <div className="flex flex-wrap items-center gap-0.5">
                    <IconButton label={t("Move up")} onClick={() => setDef((d) => moveStep(d, i, i - 1))} disabled={i === 0}>
                      {Icons.up}
                    </IconButton>
                    <IconButton label={t("Move down")} onClick={() => setDef((d) => moveStep(d, i, i + 1))} disabled={i === def.steps.length - 1}>
                      {Icons.down}
                    </IconButton>
                    <IconButton label={t("Duplicate screen")} onClick={duplicate} disabled={full}>
                      {Icons.copy}
                    </IconButton>
                    <IconButton label={t("Delete screen")} tone="danger" onClick={() => remove(step.id, step.title)} disabled={def.steps.length <= 1}>
                      {Icons.remove}
                    </IconButton>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        onClick={add}
        disabled={full}
        className="min-h-11 w-full rounded-xl border border-dashed border-border-hover px-3 text-sm font-semibold text-accent hover:bg-surface-hover disabled:opacity-50"
      >
        + {t("Screen")}
      </button>
      {full && <p className="text-xs text-muted">{t("A quiz has at most {n} screens.", { n: MAX_STEPS })}</p>}
    </div>
  );
}
