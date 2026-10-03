"use client";

/**
 * Small pieces shared by the Contacts and Moderation screens (2026-10-03):
 * avatar with the person's initial (Instagram style), tag chip and a
 * "5 min ago" formatter in the current language.
 */

import { useCallback } from "react";
import { useLang } from "@/components/lang-provider";

export function ContactAvatar({
  username,
  name,
  size = 44,
}: {
  username: string | null;
  name?: string | null;
  size?: number;
}) {
  const letter = (username || name || "?").replace(/^@/, "").charAt(0).toUpperCase() || "?";
  return (
    <span
      className="ig-gradient inline-grid shrink-0 place-items-center rounded-full p-[2px]"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <span
        className="grid h-full w-full place-items-center rounded-full border-2 border-background bg-surface-hover font-semibold text-foreground"
        style={{ fontSize: Math.round(size * 0.4) }}
      >
        {letter}
      </span>
    </span>
  );
}

export function TagChip({
  name,
  source,
  onRemove,
  removeLabel,
  active = false,
  onClick,
  count,
}: {
  name: string;
  source?: string;
  onRemove?: () => void;
  removeLabel?: string;
  active?: boolean;
  onClick?: () => void;
  count?: number;
}) {
  const base = `inline-flex max-w-full items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
    active
      ? "border-foreground bg-foreground text-background"
      : source === "manual"
        ? "border-accent/30 bg-accent/10 text-accent"
        : "border-border bg-surface-hover text-foreground"
  }`;
  const label = (
    <>
      <span className="truncate">{name}</span>
      {count !== undefined && <span className={active ? "opacity-70" : "text-muted"}>{count}</span>}
    </>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-pressed={active} className={`${base} hover:border-border-hover`}>
        {label}
      </button>
    );
  }
  return (
    <span className={base}>
      {label}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          className="-mr-1 ml-0.5 grid h-4 w-4 place-items-center rounded-full hover:bg-black/10"
        >
          ×
        </button>
      )}
    </span>
  );
}

/** "3 min ago" / "há 3 min" in the current language. */
export function useTimeAgo() {
  const { lang } = useLang();
  return useCallback(
    (iso: string | null | undefined) => {
      if (!iso) return "";
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return "";
      const locale = lang === "pt" ? "pt-BR" : "en";
      const diff = (d.getTime() - Date.now()) / 1000;
      const abs = Math.abs(diff);
      const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" });
      if (abs < 60) return rtf.format(Math.round(diff), "second");
      if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
      if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
      if (abs < 86400 * 7) return rtf.format(Math.round(diff / 86400), "day");
      return d.toLocaleDateString(locale, {
        day: "numeric",
        month: "short",
        ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}),
      });
    },
    [lang]
  );
}

/** Full date and time for tooltips and logs. */
export function useDateTime() {
  const { lang } = useLang();
  return useCallback(
    (iso: string | null | undefined) => {
      if (!iso) return "";
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return "";
      return d.toLocaleString(lang === "pt" ? "pt-BR" : "en", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    },
    [lang]
  );
}

/** Instagram-style toggle switch. */
export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
        checked ? "bg-foreground" : "bg-border"
      }`}
    >
      <span
        className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-[18px]" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}
