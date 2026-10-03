"use client";

/**
 * Etapa 2 pieces shared by the Direct, Approvals and Contact screens
 * (2026-10-04): the AI draft card (edit, approve and send, discard), the
 * "Take over" switch and the 24-hour window badge.
 *
 * Owner's rule: nothing the AI wrote is sent without a human click. The only
 * send here is POST /api/drafts/[id]/approve from a logged-in session.
 */

import { useEffect, useState } from "react";
import { useT } from "@/components/lang-provider";
import { contactDisplayName, useDateTime, useTimeAgo } from "@/components/contact-ui";

export type DraftStatus = "PENDING" | "APPROVED" | "SENT" | "REJECTED" | "EXPIRED" | "FAILED";

export interface MessagingWindow {
  open: boolean;
  closesAt: string | null;
  hoursLeft: number;
}

export interface TakeoverState {
  active: boolean;
  until: string | null;
  reason: string | null;
}

export interface DraftContact {
  id: string;
  igUserId: string;
  username: string | null;
  name: string | null;
  profilePicUrl?: string | null;
  tags: string[];
  window: MessagingWindow;
  takeover: TakeoverState;
  lastMessages: { mid: string; fromMe: boolean; text: string | null; sentAt: string; storyReply: boolean }[];
}

export interface Draft {
  id: string;
  instagramAccountId: string;
  contactId: string;
  text: string;
  reason: string | null;
  origin: string;
  status: DraftStatus;
  approvedBy: string | null;
  approvedVia: string | null;
  approvedAt: string | null;
  sentAt: string | null;
  error: string | null;
  editedAt: string | null;
  createdAt: string;
  updatedAt: string;
  contact: DraftContact;
}

export const DRAFT_STATUS_LABELS: Record<DraftStatus, string> = {
  PENDING: "Waiting for you",
  APPROVED: "Approved",
  SENT: "Sent",
  REJECTED: "Discarded",
  EXPIRED: "Expired",
  FAILED: "Failed",
};

export const DRAFT_STATUS_COLORS: Record<DraftStatus, string> = {
  PENDING: "text-accent",
  APPROVED: "text-foreground",
  SENT: "text-success",
  REJECTED: "text-muted",
  EXPIRED: "text-warning",
  FAILED: "text-error",
};

/** API error code -> a message the owner understands (translated by the caller). */
export function messagingErrorText(code: string | undefined, fallback?: string): string {
  switch (code) {
    case "window_closed":
      return "The 24-hour window closed. The person needs to message you again before anything can be sent.";
    case "takeover":
      return "You took over this conversation, so automations and the AI stay quiet.";
    case "pending_exists":
      return "There is already a draft waiting for this person.";
    case "not_pending":
      return "This draft was already handled. Reload to see its status.";
    case "changed":
      return "This draft changed after you opened it. Nothing was sent: read the new text and approve again.";
    case "maybe_sent":
      return "Instagram returned an unknown error. It may have been sent: check the Direct before trying again.";
    case "missing_scope":
    case "approval_required":
      return "Only a person can approve a draft.";
    default:
      return fallback ?? "Something went wrong. Try again.";
  }
}

type ApiPayload = { success: boolean; error?: string; data?: unknown; details?: { code?: string } };

async function postJson(url: string, body: unknown, method = "POST"): Promise<ApiPayload> {
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    return (await res.json()) as ApiPayload;
  } catch {
    return { success: false, error: "Network error" };
  }
}

/** "Window open · 5.2 h left" / "Window closed". */
export function WindowBadge({ window: w }: { window: MessagingWindow | null | undefined }) {
  const t = useT();
  if (!w) return null;
  if (!w.open) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] font-semibold text-muted">
        <span className="h-1.5 w-1.5 rounded-full bg-muted" aria-hidden />
        {t("24h window closed")}
      </span>
    );
  }
  const low = w.hoursLeft < 2;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
        low ? "border-warning/40 text-warning" : "border-success/40 text-success"
      }`}
      title={w.closesAt ?? undefined}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${low ? "bg-warning" : "bg-success"}`} aria-hidden />
      {t("Window open · {h}h left", { h: w.hoursLeft.toLocaleString(undefined, { maximumFractionDigits: 1 }) })}
    </span>
  );
}

const TAKEOVER_REASONS: Record<string, string> = {
  inbox_send: "you replied in the Direct",
  phone_echo: "you replied from the phone",
  manual: "you turned it on",
};

/**
 * "Take over" / "Hand back to automation". While on, no campaign, follow-up,
 * sequence or AI draft reaches the person.
 */
export function TakeoverToggle({
  contactId,
  takeover,
  onChange,
  size = "md",
}: {
  contactId: string | null;
  takeover: TakeoverState | null;
  onChange?: (next: TakeoverState) => void;
  size?: "sm" | "md";
}) {
  const t = useT();
  const dateTime = useDateTime();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = Boolean(takeover?.active);

  async function toggle() {
    if (!contactId || busy) return;
    setBusy(true);
    setError(null);
    const payload = await postJson(`/api/contacts/${encodeURIComponent(contactId)}/takeover`, { on: !active });
    setBusy(false);
    if (!payload.success) {
      setError(payload.error ?? "Could not change it");
      return;
    }
    const next = (payload.data as { takeover?: TakeoverState } | undefined)?.takeover;
    if (next) onChange?.(next);
  }

  const pad = size === "sm" ? "px-3 py-1 text-xs" : "px-4 py-1.5 text-sm";
  return (
    <div className="flex min-w-0 flex-col items-end gap-0.5">
      <div className="flex items-center gap-2">
        {active && (
          <span className="hidden truncate text-xs text-muted sm:inline">
            {takeover?.until
              ? t("You're answering until {date}", { date: dateTime(takeover.until) })
              : t("You're answering")}
          </span>
        )}
        <button
          type="button"
          onClick={() => void toggle()}
          disabled={!contactId || busy}
          title={
            active && takeover?.reason && TAKEOVER_REASONS[takeover.reason]
              ? t("On because {why}", { why: t(TAKEOVER_REASONS[takeover.reason]) })
              : undefined
          }
          className={`shrink-0 rounded-lg font-semibold disabled:opacity-50 ${pad} ${
            active ? "bg-surface-hover text-foreground hover:bg-border" : "bg-foreground text-background hover:opacity-85"
          }`}
        >
          {busy ? t("Saving…") : active ? t("Hand back to automation") : t("Take over conversation")}
        </button>
      </div>
      {error && <p className="text-[11px] text-error">{t(error)}</p>}
    </div>
  );
}

/** Small "Paused: you're answering" chip. */
export function TakeoverChip({ takeover }: { takeover: TakeoverState | null | undefined }) {
  const t = useT();
  if (!takeover?.active) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-foreground px-2 py-0.5 text-[11px] font-semibold text-background">
      {t("You took over")}
    </span>
  );
}

/**
 * The AI's proposed reply. Text is editable; "Approve and send" is the human
 * approval (it sends the edited text). Shows a clear warning when the 24-hour
 * window closed, since Instagram then refuses the message.
 */
export function DraftCard({
  draft,
  onDone,
  showContact = false,
  className = "",
}: {
  draft: Draft;
  onDone?: (result: { id: string; status: DraftStatus; message?: string }) => void;
  showContact?: boolean;
  className?: string;
}) {
  const t = useT();
  const timeAgo = useTimeAgo();
  const [text, setText] = useState(draft.text);
  const [busy, setBusy] = useState<null | "approve" | "reject" | "save">(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // A new draft (or a refresh with a newer text) replaces what is shown.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync the editor with the server copy
    setText(draft.text);
    setError(null);
  }, [draft.id, draft.text]);

  const edited = text.trim() !== draft.text.trim();
  const windowOpen = draft.contact.window.open;
  const tooLong = text.length > 1000;

  async function approve() {
    if (busy || !text.trim() || tooLong) return;
    setBusy("approve");
    setError(null);
    // Always the text on screen: what the person sees is what gets sent. If
    // the AI edited the draft meanwhile, the server refuses ("changed").
    const payload = await postJson(
      `/api/drafts/${encodeURIComponent(draft.id)}/approve`,
      edited ? { text: text.trim() } : { expectedText: text.trim() }
    );
    setBusy(null);
    if (payload.success) {
      onDone?.({ id: draft.id, status: "SENT" });
      return;
    }
    const code = payload.details?.code;
    if (code === "window_closed") {
      onDone?.({ id: draft.id, status: "EXPIRED", message: messagingErrorText(code) });
      return;
    }
    if (code === "maybe_sent") {
      onDone?.({ id: draft.id, status: "FAILED", message: messagingErrorText(code) });
      return;
    }
    setError(messagingErrorText(code, payload.error));
  }

  async function reject() {
    if (busy) return;
    setBusy("reject");
    setError(null);
    const payload = await postJson(`/api/drafts/${encodeURIComponent(draft.id)}/reject`, {});
    setBusy(null);
    if (payload.success) onDone?.({ id: draft.id, status: "REJECTED" });
    else setError(messagingErrorText(payload.details?.code, payload.error));
  }

  async function save() {
    if (busy || !edited || !text.trim() || tooLong) return;
    setBusy("save");
    setError(null);
    const payload = await postJson(`/api/drafts/${encodeURIComponent(draft.id)}`, { text: text.trim() }, "PATCH");
    setBusy(null);
    if (payload.success) {
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } else setError(messagingErrorText(payload.details?.code, payload.error));
  }

  return (
    <div className={`rounded-2xl border border-accent/30 bg-accent/5 p-3 ${className}`}>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1 font-semibold text-accent">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15.5l-1.9-4.6L5.5 9l4.6-1.4z" />
            <path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
          </svg>
          {draft.origin === "vendedor" ? t("Draft from the AI") : t("Draft")}
        </span>
        {showContact && (
          <span className="font-semibold text-foreground">{contactDisplayName(t, draft.contact)}</span>
        )}
        <span className="text-muted">{timeAgo(draft.createdAt)}</span>
        <span className="ml-auto">
          <WindowBadge window={draft.contact.window} />
        </span>
      </div>

      {draft.reason && (
        <p className="mb-2 text-xs text-muted">
          <span className="font-semibold text-foreground">{t("Why:")}</span> {draft.reason}
        </p>
      )}

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={Math.min(6, Math.max(2, Math.ceil(text.length / 60)))}
        maxLength={1200}
        aria-label={t("Proposed reply")}
        className="w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent/50"
      />
      {tooLong && <p className="mt-1 text-[11px] text-error">{t("At most 1000 characters")}</p>}

      {!windowOpen && (
        <p className="mt-2 rounded-lg bg-warning/10 px-3 py-2 text-xs text-foreground">
          {t("The 24-hour window closed. Instagram won't deliver this until the person messages you again.")}
        </p>
      )}
      {draft.contact.takeover.active && (
        <p className="mt-2 rounded-lg bg-surface-hover px-3 py-2 text-xs text-muted">
          {t("You took over this conversation. You can still send this draft yourself.")}
        </p>
      )}
      {error && <p className="mt-2 text-xs text-error">{t(error)}</p>}

      <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
        {edited && (
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy !== null || tooLong}
            className="rounded-lg px-3 py-1.5 text-sm font-semibold text-accent hover:text-accent-hover disabled:opacity-50"
          >
            {busy === "save" ? t("Saving…") : t("Save edit")}
          </button>
        )}
        {saved && <span className="text-xs text-success">{t("Saved")}</span>}
        <button
          type="button"
          onClick={() => void reject()}
          disabled={busy !== null}
          className="rounded-lg bg-surface-hover px-4 py-1.5 text-sm font-semibold text-foreground hover:bg-border disabled:opacity-50"
        >
          {busy === "reject" ? t("Discarding…") : t("Discard")}
        </button>
        <button
          type="button"
          onClick={() => void approve()}
          disabled={busy !== null || !text.trim() || tooLong || !windowOpen}
          title={!windowOpen ? t("24h window closed") : undefined}
          className="rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {busy === "approve" ? t("Sending…") : t("Approve and send")}
        </button>
      </div>
    </div>
  );
}
