"use client";

/**
 * Campo de etiquetas (hashtags do Instagram/TikTok/Facebook e tags do YouTube).
 * Enter, vírgula ou sair do campo transforma o texto em etiqueta; colar uma lista separa sozinho.
 */

import { useId, useState } from "react";
import { useT } from "@/components/lang-provider";
import { fieldClass, labelClass } from "@/components/posts/styles";
import { splitList } from "@/lib/social/text-fields";

export function ChipsInput({
  label,
  values,
  onChange,
  clean,
  prefix = "",
  placeholder,
  counter,
  hint,
}: {
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
  clean: (raw: string) => string;
  prefix?: string;
  placeholder: string;
  counter?: { value: number; max: number };
  hint?: string;
}) {
  const t = useT();
  const id = useId();
  const [draft, setDraft] = useState("");

  function add(text: string) {
    const next = [...values];
    for (const item of splitList(text, clean)) {
      if (!next.some((v) => v.toLowerCase() === item.toLowerCase())) next.push(item);
    }
    if (next.length !== values.length) onChange(next);
    setDraft("");
  }

  const over = counter ? counter.value > counter.max : false;

  return (
    <div className="flex flex-col gap-2 text-sm">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <div className={`${fieldClass} flex min-h-[44px] flex-wrap focus-within:border-accent/40 focus-within:ring-2 focus-within:ring-accent/20 items-center gap-1.5`}>
        {values.map((v) => (
          <span key={v} className="inline-flex max-w-full items-center gap-1 rounded-full bg-accent/10 py-0.5 pl-2.5 pr-1 text-xs font-medium text-accent">
            <span className="truncate">
              {prefix}
              {v}
            </span>
            <button
              type="button"
              aria-label={`${t("Remove")} ${prefix}${v}`}
              onClick={() => onChange(values.filter((x) => x !== v))}
              className="flex h-5 w-5 items-center justify-center rounded-full hover:bg-accent/20"
            >
              <span aria-hidden>×</span>
            </button>
          </span>
        ))}
        <input
          id={id}
          type="text"
          value={draft}
          onChange={(e) => {
            const v = e.target.value;
            if (v.endsWith(",")) add(v.slice(0, -1));
            else setDraft(v);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (draft.trim()) add(draft);
            } else if (e.key === "Backspace" && !draft && values.length) {
              onChange(values.slice(0, -1));
            }
          }}
          onBlur={() => draft.trim() && add(draft)}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text");
            if (/[,\n#]/.test(text)) {
              e.preventDefault();
              add(`${draft} ${text}`);
            }
          }}
          placeholder={values.length ? "" : placeholder}
          className="min-w-[8rem] flex-1 bg-transparent"
          // O anel de foco fica na caixa inteira (focus-within); a regra global de :focus-visible não usa camada, por isso o estilo inline.
          style={{ outline: "none" }}
        />
      </div>
      <div className="flex items-start justify-between gap-3 text-xs">
        <span className="text-muted">{hint}</span>
        {counter && (
          <span className={`shrink-0 ${over ? "text-error" : "text-muted"}`}>
            {counter.value}/{counter.max}
          </span>
        )}
      </div>
    </div>
  );
}
