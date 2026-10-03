"use client";

/**
 * Small pieces shared by the Contacts and Moderation screens (2026-10-03):
 * avatar with the person's initial (Instagram style), tag chip and a
 * "5 min ago" formatter in the current language.
 */

import { useCallback, useState } from "react";
import { useLang, useT } from "@/components/lang-provider";
import type { TFunction } from "@/lib/i18n";

export function ContactAvatar({
  username,
  name,
  src,
  size = 44,
}: {
  username: string | null;
  name?: string | null;
  /** Profile photo from the Meta User Profile API (2026-10-06). Meta CDN links expire: falls back to the initial. */
  src?: string | null;
  size?: number;
}) {
  const [broken, setBroken] = useState<string | null>(null);
  const letter = (username || name || "?").replace(/^@/, "").charAt(0).toUpperCase() || "?";
  const showPhoto = Boolean(src) && broken !== src;
  return (
    <span
      className="ig-gradient inline-grid shrink-0 place-items-center rounded-full p-[2px]"
      style={{ width: size, height: size }}
      aria-hidden
    >
      {showPhoto ? (
        // eslint-disable-next-line @next/next/no-img-element -- Meta CDN profile photo, not optimizable
        <img
          src={src as string}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setBroken(src ?? null)}
          className="h-full w-full rounded-full border-2 border-background bg-surface-hover object-cover"
        />
      ) : (
        <span
          className="grid h-full w-full place-items-center rounded-full border-2 border-background bg-surface-hover font-semibold text-foreground"
          style={{ fontSize: Math.round(size * 0.4) }}
        >
          {letter}
        </span>
      )}
    </span>
  );
}

/**
 * How a contact is called on screen (2026-10-06). Contacts that came in by DM,
 * ig.me link or button only bring the IGSID; until the profile lookup fills the
 * @, show the name, or "Direct person ···1234" (end of the ID) instead of
 * "Unknown user".
 */
export function contactDisplayName(
  t: TFunction,
  c: { username?: string | null; name?: string | null; igUserId?: string | null }
): string {
  if (c.username) return `@${c.username.replace(/^@/, "")}`;
  if (c.name?.trim()) return c.name.trim();
  const tail = (c.igUserId ?? "").slice(-4);
  return tail ? t("Direct person ···{id}", { id: tail }) : t("Direct person");
}

/** Same label as contactDisplayName, as a component (keeps `t` out of the caller's render). */
export function ContactName(props: { username?: string | null; name?: string | null; igUserId?: string | null }) {
  const t = useT();
  return <>{contactDisplayName(t, props)}</>;
}

/** True when the contact has no @ yet (the label above is a fallback). */
export function isUnnamedContact(c: { username?: string | null }): boolean {
  return !c.username;
}

/** Deep link to the conversation in the Direct screen. */
export function inboxHref(instagramAccountId: string, igUserId: string): string {
  return `/inbox?account=${encodeURIComponent(instagramAccountId)}&contact=${encodeURIComponent(igUserId)}`;
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
