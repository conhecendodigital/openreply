"use client";

import { useId } from "react";
import type { FieldBlock } from "@/lib/funnels/types";
import { borderColor, type PlayerCtx } from "@/components/funnels/blocks/shared";

const INPUT: Record<FieldBlock["field"], { type: string; autoComplete: string; inputMode?: "email" | "tel" | "text" }> = {
  name: { type: "text", autoComplete: "name", inputMode: "text" },
  email: { type: "email", autoComplete: "email", inputMode: "email" },
  whatsapp: { type: "tel", autoComplete: "tel", inputMode: "tel" },
};

/** Lead field. The consent box and the send are handled by the player (one per screen). */
export default function FieldView({ block, ctx }: { block: FieldBlock; ctx: PlayerCtx }) {
  const id = useId();
  const cfg = INPUT[block.field];
  const error = ctx.fieldErrors[block.field];
  return (
    <div className="space-y-1.5 text-left">
      <label htmlFor={id} className="block text-[15px] font-semibold">
        {block.label}
        {block.required !== false && <span aria-hidden="true"> *</span>}
      </label>
      <input
        id={id}
        name={block.field}
        type={cfg.type}
        inputMode={cfg.inputMode}
        autoComplete={cfg.autoComplete}
        placeholder={block.placeholder}
        required={block.required !== false}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-e` : undefined}
        value={ctx.fields[block.field] ?? ""}
        onChange={(e) => ctx.setField(block.field, e.target.value)}
        className="min-h-12 w-full px-4 text-base outline-none focus-visible:outline-2 focus-visible:outline-offset-1"
        style={{
          fontSize: 16,
          borderRadius: "var(--fq-radius)",
          border: `1px solid ${error ? "var(--fq-error)" : borderColor}`,
          background: "var(--fq-bg)",
          color: "var(--fq-text)",
          outlineColor: "var(--fq-primary)",
        }}
      />
      {error && (
        <p id={`${id}-e`} role="alert" className="text-sm font-semibold" style={{ color: "var(--fq-error)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
