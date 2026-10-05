"use client";

/**
 * Etapa 6 (Quiz): small form fields of the editor panels (properties and
 * settings). Same look as the rest of the panel: white field, thin gray
 * border, 44px touch targets, labels tied to their fields.
 */

import { useId, useState } from "react";
import { useT } from "@/components/lang-provider";

export const inputClass =
  "min-h-11 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-border-hover aria-[invalid=true]:border-error";

export function FieldShell({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  error?: string | null;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-xs font-semibold text-foreground">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-error" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function TextField({
  label,
  value,
  onChange,
  multiline = false,
  rows = 3,
  maxLength,
  placeholder,
  hint,
  error,
  type = "text",
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  rows?: number;
  maxLength?: number;
  placeholder?: string;
  hint?: React.ReactNode;
  error?: string | null;
  type?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
}) {
  const id = useId();
  return (
    <FieldShell label={label} hint={hint} error={error} htmlFor={id}>
      {multiline ? (
        <textarea
          id={id}
          value={value}
          rows={rows}
          maxLength={maxLength}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputClass} resize-y leading-relaxed`}
        />
      ) : (
        <input
          id={id}
          type={type}
          inputMode={inputMode}
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
        />
      )}
    </FieldShell>
  );
}

/** Whole number field. Empty = undefined (or null when `nullable`). */
export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  hint,
  placeholder,
}: {
  label: string;
  value: number | null | undefined;
  onChange: (v: number | undefined) => void;
  min?: number;
  max?: number;
  hint?: React.ReactNode;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <FieldShell label={label} hint={hint} htmlFor={id}>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        step={1}
        min={min}
        max={max}
        placeholder={placeholder}
        value={value ?? ""}
        onChange={(e) => {
          const raw = e.target.value.trim();
          if (raw === "") return onChange(undefined);
          let n = Math.round(Number(raw));
          if (!Number.isFinite(n)) return;
          if (min !== undefined) n = Math.max(min, n);
          if (max !== undefined) n = Math.min(max, n);
          onChange(n);
        }}
        className={inputClass}
      />
    </FieldShell>
  );
}

/** Price in reais typed by the owner -> cents. Empty = null. */
export function MoneyField({
  label,
  cents,
  onChange,
  hint,
  error,
}: {
  label: string;
  cents: number | null | undefined;
  onChange: (v: number | null) => void;
  hint?: React.ReactNode;
  error?: string | null;
}) {
  const id = useId();
  const shown = cents == null ? "" : (cents / 100).toFixed(2).replace(".", ",");
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <FieldShell label={label} hint={hint} error={error} htmlFor={id}>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">R$</span>
        <input
          id={id}
          inputMode="decimal"
          value={draft ?? shown}
          placeholder="0,00"
          aria-invalid={error ? true : undefined}
          onFocus={() => setDraft(shown)}
          onChange={(e) => {
            const raw = e.target.value.replace(/[^\d.,]/g, "");
            setDraft(raw);
            if (!raw) return onChange(null);
            // "1.234,56" or "1234.56" or "97" -> cents
            const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
            const n = Number(normalized);
            if (Number.isFinite(n) && n >= 0) onChange(Math.round(n * 100));
          }}
          onBlur={() => setDraft(null)}
          className={`${inputClass} pl-10`}
        />
      </div>
    </FieldShell>
  );
}

export function CheckField({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: React.ReactNode;
}) {
  return (
    <div>
      <label className="flex min-h-11 cursor-pointer items-start gap-3 py-1 text-sm">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[#0095f6]" />
        <span>
          <span className="font-semibold">{label}</span>
          {hint && <span className="block text-xs text-muted">{hint}</span>}
        </span>
      </label>
    </div>
  );
}

export function SelectField<V extends string>({
  label,
  value,
  onChange,
  options,
  hint,
}: {
  label: string;
  value: V;
  onChange: (v: V) => void;
  options: { value: V; label: string }[];
  hint?: React.ReactNode;
}) {
  const id = useId();
  return (
    <FieldShell label={label} hint={hint} htmlFor={id}>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as V)} className={inputClass}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

/** Small icon button (up, down, remove...) with a 44px touch target. */
export function IconButton({
  label,
  onClick,
  disabled,
  children,
  tone = "default",
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  tone?: "default" | "danger";
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`grid h-11 w-11 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-hover disabled:opacity-30 ${
        tone === "danger" ? "hover:text-error" : "hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

export const Icons = {
  up: (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
      <path d="m6 15 6-6 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  down: (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
      <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  remove: (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  copy: (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
      <rect x="8" y="8" width="12" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  ),
  grip: (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
      <path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  ),
  alert: (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
      <path d="M12 3 2 20h20zM12 10v4M12 17h.01" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};

/** List of short texts (checklist items, bonuses, before/after items). */
export function StringListField({
  label,
  items,
  onChange,
  addLabel,
  placeholder,
  max = 20,
  hint,
}: {
  label: string;
  items: string[];
  onChange: (v: string[]) => void;
  addLabel: string;
  placeholder?: string;
  max?: number;
  hint?: React.ReactNode;
}) {
  const t = useT();
  const set = (i: number, v: string) => onChange(items.map((x, j) => (j === i ? v : x)));
  const swap = (i: number, j: number) => {
    const out = items.slice();
    [out[i], out[j]] = [out[j], out[i]];
    onChange(out);
  };
  return (
    <fieldset className="space-y-1.5">
      <legend className="mb-1.5 text-xs font-semibold">{label}</legend>
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-1">
          <input
            value={item}
            placeholder={placeholder}
            aria-label={t("{label}, item {n}", { label, n: i + 1 })}
            onChange={(e) => set(i, e.target.value)}
            className={inputClass}
            maxLength={300}
          />
          <IconButton label={t("Move up")} onClick={() => swap(i, i - 1)} disabled={i === 0}>
            {Icons.up}
          </IconButton>
          <IconButton label={t("Remove")} tone="danger" onClick={() => onChange(items.filter((_, j) => j !== i))}>
            {Icons.remove}
          </IconButton>
        </div>
      ))}
      {items.length < max && (
        <button type="button" onClick={() => onChange([...items, ""])} className="min-h-11 rounded-lg px-2 text-sm font-semibold text-accent hover:bg-surface-hover">
          + {addLabel}
        </button>
      )}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </fieldset>
  );
}
