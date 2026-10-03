"use client";

/**
 * Pieces shared by the flow list and the flow builder: the status chip, the
 * "turn on" confirmation (a flow sends DMs by itself, so the owner sees which
 * active campaigns win over it before it goes live) and the API helper.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useT } from "@/components/lang-provider";

export type FlowConflict = { id: string; name: string; trigger: string };

export type FlowSummary = {
  id: string;
  name: string;
  isActive: boolean;
  instagramAccountId: string;
  account: { username: string; status: string } | null;
  trigger: { type: string; label: string; keywords: string[] } | null;
  published: boolean;
  publishedVersion: number;
  publishedAt: string | null;
  hasUnpublishedChanges: boolean;
  sourceAutomationId: string | null;
  nodeCount: number;
  stats: { entered: number; completed: number; open: number };
  createdAt: string;
  updatedAt: string;
};

export type ApiResult<T> = { success: true; data: T } | { success: false; error?: string; details?: { code?: string; errors?: unknown[] } & Record<string, unknown> };

export async function flowApi<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      cache: "no-store",
      ...init,
      ...(init?.json !== undefined
        ? { body: JSON.stringify(init.json), headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } }
        : {}),
    });
    const payload = (await res.json().catch(() => null)) as ApiResult<T> | null;
    return payload ?? { success: false, error: `HTTP ${res.status}` };
  } catch {
    return { success: false, error: "network" };
  }
}

/** Server error code -> sentence for the owner. */
export function flowErrorText(t: (k: string, v?: Record<string, string | number>) => string, result: ApiResult<unknown>): string {
  if (result.success) return "";
  switch (result.details?.code) {
    case "human_only":
      return t("Only a signed-in person can do this, in the Lead Engine.");
    case "not_published":
      return t("Publish the flow before turning it on.");
    case "invalid_flow":
      return t("Fix the flow before publishing.");
    case "active":
      return t("Turn the flow off before deleting it.");
    case "link_not_found":
      return t("The conversation link was not found on this account.");
    case "no_account":
      return t("Connect an Instagram account first.");
    case "draft_only":
      return t("Publish and turn flows on or off with their own buttons.");
    case "published":
      return t("A published flow stays on its account.");
  }
  return result.error === "network" ? t("No connection. Try again.") : t("Something went wrong: {error}", { error: result.error ?? "?" });
}

export function FlowStatusChip({ isActive, published, unpublished }: { isActive: boolean; published: boolean; unpublished?: boolean }) {
  const t = useT();
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span
        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
          isActive ? "bg-success/15 text-[#3a8a12]" : "bg-surface-hover text-muted"
        }`}
      >
        {isActive ? t("Switched on") : t("Switched off")}
      </span>
      {!published ? (
        <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted">{t("Draft")}</span>
      ) : unpublished ? (
        <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-semibold text-[#8a560c]">{t("Unpublished changes")}</span>
      ) : null}
    </span>
  );
}

/**
 * "Turn on" confirmation. Loads the flow to show the active campaigns that
 * take the same events (they always answer first; the flow never sends a
 * second reply) and whether the draft has changes not yet published.
 */
export function ActivateFlowDialog({
  flowId,
  flowName,
  onClose,
  onDone,
}: {
  flowId: string;
  flowName: string;
  onClose: () => void;
  onDone: (summary: FlowSummary & { conflicts?: FlowConflict[] }) => void;
}) {
  const t = useT();
  const [info, setInfo] = useState<{ conflicts: FlowConflict[]; unpublished: boolean; channel: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void flowApi<FlowSummary & { conflicts: FlowConflict[] }>(`/api/flows/${encodeURIComponent(flowId)}`).then((r) => {
      if (!alive) return;
      if (r.success) {
        setInfo({ conflicts: r.data.conflicts ?? [], unpublished: r.data.hasUnpublishedChanges, channel: r.data.account?.status ?? null });
      } else {
        setInfo({ conflicts: [], unpublished: false, channel: null });
      }
    });
    return () => {
      alive = false;
    };
  }, [flowId]);

  async function confirm() {
    setBusy(true);
    setError(null);
    const r = await flowApi<FlowSummary & { conflicts?: FlowConflict[] }>(`/api/flows/${encodeURIComponent(flowId)}/active`, {
      method: "POST",
      json: { isActive: true },
    });
    setBusy(false);
    if (r.success) onDone(r.data);
    else setError(flowErrorText(t, r));
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md space-y-4 rounded-t-2xl bg-background p-5 sm:rounded-2xl">
        <h3 className="text-base font-semibold">{t("Turn on “{name}”?", { name: flowName })}</h3>
        <p className="text-sm text-muted">
          {t("From now on the flow sends DMs by itself to whoever fires the trigger, within Instagram's rules (24 h window, hourly limit, takeover).")}
        </p>
        {info === null ? (
          <p className="text-sm text-muted">{t("Checking campaigns…")}</p>
        ) : (
          <>
            {info.channel && info.channel !== "ACTIVE" && (
              <p className="rounded-lg bg-error/10 px-3 py-2 text-xs text-error">
                {t("The channel is not active: nothing goes out until it is connected again.")}
              </p>
            )}
            {info.unpublished && (
              <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-[#8a560c]">
                {t("The draft has changes that are not published. What runs is the last published version.")}
              </p>
            )}
            {info.conflicts.length > 0 ? (
              <div className="space-y-2 rounded-lg bg-surface-hover px-3 py-2">
                <p className="text-xs font-semibold">
                  {t("These active campaigns take the same events and answer first. The flow only gets what they do not take:")}
                </p>
                <ul className="space-y-1 text-xs">
                  {info.conflicts.map((c) => (
                    <li key={c.id}>
                      <Link href={`/campaigns/${c.id}`} className="font-semibold text-accent" target="_blank">
                        {c.name}
                      </Link>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted">{t("Nobody ever gets both. To move these people to the flow, turn the campaign off first.")}</p>
              </div>
            ) : (
              <p className="text-xs text-muted">{t("No active campaign takes the same events.")}</p>
            )}
          </>
        )}
        {error && <p className="text-sm text-error">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-semibold hover:bg-surface-hover">
            {t("Cancel")}
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={busy || info === null}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {busy ? t("Turning on…") : t("Turn on")}
          </button>
        </div>
      </div>
    </div>
  );
}
