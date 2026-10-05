"use client";

/* eslint-disable @next/next/no-img-element -- option images come from any https host the owner pastes */

import { useId } from "react";
import { useT } from "@/components/lang-provider";
import { interpolate } from "@/lib/funnels/text";
import type { FunnelOption, OptionsBlock } from "@/lib/funnels/types";
import { CheckIcon, MediaPlaceholder, borderColor, isPlaceholderMedia, type PlayerCtx } from "@/components/funnels/blocks/shared";

/**
 * Single choice: real <button>s that move on by themselves a moment after the
 * tap. Multiple choice: checkboxes with a Continue button. The chosen state
 * shows with a thick border and a check, never only with color.
 */
export default function OptionsView({ block, ctx }: { block: OptionsBlock; ctx: PlayerCtx }) {
  const t = useT();
  const groupId = useId();
  const chosen = ctx.answers[block.name] ?? [];
  const grid = block.layout === "grid";
  const questionId = `${groupId}-q`;
  const errorId = `${groupId}-e`;

  // "icon": a small picture next to the text (emoji-like icons); "photo": the big picture on top.
  const iconImages = block.imageSize === "icon";
  const content = (o: FunnelOption, selected: boolean) => (
    <>
      {o.imageUrl && !iconImages &&
        (isPlaceholderMedia(o.imageUrl) ? (
          <span className="block w-full">
            <MediaPlaceholder label={t("Add your image")} ratio="1 / 1" />
          </span>
        ) : (
          <img src={o.imageUrl} alt="" aria-hidden="true" loading="lazy" decoding="async" className="aspect-square w-full object-cover" style={{ borderRadius: "calc(var(--fq-radius) - 4px)" }} />
        ))}
      <span className={`flex w-full items-center gap-3 ${grid ? "justify-center text-center" : ""}`}>
        {o.imageUrl && iconImages && !isPlaceholderMedia(o.imageUrl) && (
          <img src={o.imageUrl} alt="" aria-hidden="true" loading="lazy" decoding="async" width={40} height={40} className="h-10 w-10 shrink-0 rounded-full object-cover" />
        )}
        {o.emoji && (
          <span aria-hidden="true" className="text-2xl leading-none">
            {o.emoji}
          </span>
        )}
        <span className="flex-1">{interpolate(o.label, ctx.labels)}</span>
        {selected ? (
          <CheckIcon />
        ) : (
          <span aria-hidden="true" className="h-5 w-5 shrink-0 rounded-full border-2" style={{ borderColor }} />
        )}
      </span>
    </>
  );

  const itemStyle = (selected: boolean): React.CSSProperties => ({
    borderRadius: "var(--fq-radius)",
    border: selected ? "3px solid var(--fq-primary)" : `1px solid ${borderColor}`,
    padding: selected ? "10px 14px" : "12px 16px",
    background: selected ? "color-mix(in srgb, var(--fq-primary) 10%, var(--fq-bg))" : "var(--fq-bg)",
  });

  return (
    <fieldset className="min-w-0 space-y-3" aria-describedby={ctx.optionsError ? errorId : undefined}>
      {block.question ? (
        <legend id={questionId} className="mb-3 w-full text-center text-xl font-bold leading-tight [text-wrap:balance]">
          {interpolate(block.question, ctx.labels)}
        </legend>
      ) : (
        <legend className="sr-only">{t("Choose an option")}</legend>
      )}
      {block.multiple && (
        <p className="text-center text-sm" style={{ color: "color-mix(in srgb, var(--fq-text) 68%, transparent)" }}>
          {t("You can choose more than one")}
        </p>
      )}
      <div className={grid ? "grid grid-cols-2 gap-3" : "space-y-3"}>
        {block.options.map((o) => {
          const selected = block.multiple ? chosen.includes(o.id) : ctx.pendingOptionId === o.id || chosen.includes(o.id);
          if (!block.multiple) {
            return (
              <button
                key={o.id}
                type="button"
                aria-pressed={selected}
                disabled={ctx.busy || ctx.pendingOptionId !== null}
                onClick={() => ctx.selectOption(block, o)}
                className={`fq-press flex min-h-14 w-full flex-col items-stretch gap-2 text-left text-[17px] font-semibold [touch-action:manipulation] ${
                  grid ? "items-center" : ""
                }`}
                style={itemStyle(selected)}
              >
                {content(o, selected)}
              </button>
            );
          }
          return (
            <label
              key={o.id}
              className="fq-press relative flex min-h-14 w-full cursor-pointer flex-col items-stretch gap-2 text-[17px] font-semibold [touch-action:manipulation] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2"
              style={{ ...itemStyle(selected), outlineColor: "var(--fq-primary)" }}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={selected}
                onChange={() => ctx.toggleOption(block, o.id)}
                disabled={ctx.busy}
              />
              {content(o, selected)}
            </label>
          );
        })}
      </div>
      {ctx.optionsError && (
        <p id={errorId} role="alert" className="text-center text-sm font-semibold" style={{ color: "var(--fq-error)" }}>
          {ctx.optionsError}
        </p>
      )}
      {block.multiple && (
        <button
          type="button"
          onClick={() => ctx.continueMultiple(block)}
          disabled={ctx.busy}
          className="fq-press min-h-14 w-full px-5 py-3 text-[17px] font-bold [touch-action:manipulation] disabled:opacity-60"
          style={{ borderRadius: "var(--fq-radius)", background: "var(--fq-primary)", color: "var(--fq-on-primary)" }}
        >
          {block.continueLabel?.trim() || t("Continue")}
        </button>
      )}
    </fieldset>
  );
}
