"use client";

/**
 * Broadcasts (Etapa 5, 2026-10-08): the editor, the Direct preview, the
 * send / schedule step and the history.
 *
 * Rules the screen makes visible:
 * - Instagram only lets a promotional DM reach people who wrote to the
 *   account in the last 24 hours, so only those receive. The count says so.
 * - Creating is always a draft. Sending or scheduling is a separate step that
 *   only a signed-in owner/admin can take (an API key gets "human_only").
 * - The pace is controlled: batches with a pause, inside the hourly limit.
 * - Whoever wrote PARAR / SAIR / STOP is out of every future broadcast.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AccountSelect, { type AccountOption } from "@/components/account-select";
import { ContactName, useDateTime, useTimeAgo } from "@/components/contact-ui";
import { useT } from "@/components/lang-provider";
import { flowApi, type FlowSummary } from "@/components/flows/flow-shared";
import {
  AudienceCount,
  apiErrorText,
  SegmentFiltersEditor,
  useDescribeFilters,
  useLiveCount,
  useSegmentOptions,
  type SegmentCount,
} from "@/components/segment-builder";
import { ConfirmBox, evenWeights, VariantBadge, VariantResults, WeightSplit, type VariantResult } from "@/components/ab-test";
import { renderFlowText } from "@/lib/flows/render";
import { EMPTY_FILTERS, type SegmentFilters } from "@/lib/segments/schema";
import {
  BATCH_SIZE,
  MAX_BROADCAST_BUTTONS,
  MAX_BROADCAST_TEXT,
  MAX_BUTTON_LABEL,
  PAUSE_SECONDS,
  type BroadcastButton,
  type BroadcastVariant,
} from "@/lib/broadcasts/schema";
import { VARIANT_KEYS, validateWeights, type VariantKey } from "@/lib/ab/keys";

export type BroadcastStatus = "DRAFT" | "SCHEDULED" | "SENDING" | "DONE" | "CANCELED" | "FAILED";

export type Broadcast = {
  id: string;
  name: string;
  status: BroadcastStatus;
  stopReason: string | null;
  instagramAccountId: string;
  account: { username: string; status: string } | null;
  segmentId: string | null;
  segmentName: string | null;
  filters: SegmentFilters;
  text: string;
  buttons: BroadcastButton[];
  variants: BroadcastVariant[];
  abWinnerKey: string | null;
  skipBusy: boolean;
  scheduledAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  canceledAt: string | null;
  createdVia: string;
  batchSize: number;
  pauseSeconds: number;
  counts: { segment: number | null; eligible: number | null; sent: number; failed: number; skipped: number };
  createdAt: string;
  updatedAt: string;
};

export type BroadcastStats = {
  totals: { sent: number; failed: number; skipped: number; clicked: number; replied: number; clicks: number; pending: number; maybeSent: number; ctr: number };
  byStatus: Record<string, number>;
  variants: (VariantResult & { skipped: number })[];
  replyWindowHours: number;
};

export type BroadcastDetail = Broadcast & { stats: BroadcastStats; audience: SegmentCount | null };

type SegmentOption = { id: string; name: string; instagramAccountId: string | null; filters: SegmentFilters };

const SAMPLE = { username: "maria.silva", name: "Maria Silva" };

const STATUS_LABEL: Record<BroadcastStatus, string> = {
  DRAFT: "Draft",
  SCHEDULED: "Scheduled",
  SENDING: "Sending",
  DONE: "Completed",
  CANCELED: "Canceled",
  FAILED: "Stopped",
};

const STATUS_STYLE: Record<BroadcastStatus, string> = {
  DRAFT: "border border-border text-muted",
  SCHEDULED: "bg-accent/10 text-accent",
  SENDING: "bg-warning/15 text-[#8a560c]",
  DONE: "bg-success/15 text-[#3a8a12]",
  CANCELED: "bg-surface-hover text-muted",
  FAILED: "bg-error/10 text-error",
};

const STOP_REASON: Record<string, string> = {
  no_open_window: "Nobody had the conversation open when it started.",
  monthly_limit: "The monthly DM limit ran out; the rest were skipped.",
  channel_off: "The Instagram channel was off.",
  token: "The Instagram connection needs to be renewed in Channels.",
};

export const RECIPIENT_STATUS_LABEL: Record<string, string> = {
  PENDING: "Waiting",
  SENDING: "Sending",
  SENT: "Sent",
  FAILED: "Failed",
  MAYBE_SENT: "Unclear (not resent)",
  SKIPPED_WINDOW: "Skipped: conversation closed",
  SKIPPED_TAKEOVER: "Skipped: you took over",
  SKIPPED_OPTOUT: "Skipped: opted out",
  SKIPPED_CHANNEL: "Skipped: channel off",
  SKIPPED_LIMIT: "Skipped: limit reached",
  SKIPPED_BUSY: "Skipped: in a flow",
  SKIPPED_CANCELED: "Skipped: canceled",
};

export function BroadcastStatusChip({ status }: { status: BroadcastStatus }) {
  const t = useT();
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[status]}`}>{t(STATUS_LABEL[status])}</span>;
}

/** Instagram Direct look of the broadcast (nothing is sent). */
export function BroadcastPreview({
  text,
  buttons,
  username,
  flows,
}: {
  text: string;
  buttons: BroadcastButton[];
  username: string | null;
  flows: FlowSummary[];
}) {
  const t = useT();
  const rendered = renderFlowText(text, SAMPLE);
  return (
    <div className="mx-auto w-full max-w-[340px] overflow-hidden rounded-[28px] border-[6px] border-zinc-900 bg-black text-white">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2.5">
        <span className="ig-gradient grid h-7 w-7 place-items-center rounded-full text-[11px] font-bold">
          {(username ?? "?").slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{username ?? t("your account")}</p>
          <p className="text-[11px] text-zinc-400">{t("Preview · nothing is sent")}</p>
        </div>
      </div>
      <div className="min-h-[300px] space-y-2.5 px-3 py-4">
        <div className="flex flex-col items-end gap-1">
          <p className="text-[10px] text-zinc-500">{t("@{username} wrote to you less than 24 h ago", { username: SAMPLE.username })}</p>
          <div className="max-w-[80%] rounded-2xl rounded-br-md bg-accent px-3 py-2 text-sm">{t("hi! 👋")}</div>
        </div>
        <p className="py-1 text-center text-[11px] text-zinc-500">{t("Broadcast")}</p>
        <div className="flex items-end gap-2">
          <span className="ig-gradient h-6 w-6 shrink-0 rounded-full" />
          <div className="max-w-[80%] overflow-hidden rounded-2xl rounded-bl-md bg-zinc-800">
            <p className="whitespace-pre-wrap px-3 py-2 text-sm">{rendered || t("(no text yet)")}</p>
            {buttons.map((b) => (
              <span key={b.id} className="mx-1.5 mb-1.5 block rounded-xl bg-zinc-700 px-4 py-1.5 text-center text-sm font-medium">
                {b.label || "…"}
                {b.kind === "link" ? " ↗" : ""}
              </span>
            ))}
          </div>
        </div>
        {buttons.some((b) => b.kind === "flow") && (
          <p className="pt-2 text-center text-[11px] text-zinc-500">
            {t("Tapping {label} starts the flow “{flow}”.", {
              label: buttons.find((b) => b.kind === "flow")?.label ?? "",
              flow: (() => {
                const b = buttons.find((x) => x.kind === "flow");
                return b && b.kind === "flow" ? flows.find((f) => f.id === b.flowId)?.name ?? "?" : "";
              })(),
            })}
          </p>
        )}
      </div>
      <div className="border-t border-zinc-800 px-3 py-3 text-center text-[11px] text-zinc-400">
        {t("Shown with a sample person: @{username}", { username: SAMPLE.username })}
      </div>
    </div>
  );
}

type Draft = {
  name: string;
  accountId: string;
  audience: "segment" | "filters";
  segmentId: string;
  filters: SegmentFilters;
  text: string;
  buttons: BroadcastButton[];
  abOn: boolean;
  variants: { key: VariantKey; weight: number; text: string }[];
  skipBusy: boolean;
  batchSize: number;
  pauseSeconds: number;
};

function newButtonId(i: number) {
  return `b${Date.now().toString(36)}${i}`;
}

function fromBroadcast(b: Broadcast): Draft {
  return {
    name: b.name,
    accountId: b.instagramAccountId,
    audience: b.segmentId ? "segment" : "filters",
    segmentId: b.segmentId ?? "",
    filters: b.filters ?? EMPTY_FILTERS,
    text: b.text,
    buttons: b.buttons,
    abOn: b.variants.length >= 2,
    variants: b.variants.length >= 2 ? b.variants.map((v) => ({ key: v.key, weight: v.weight, text: v.text })) : [],
    skipBusy: b.skipBusy,
    batchSize: b.batchSize,
    pauseSeconds: b.pauseSeconds,
  };
}

function TextVars({ onInsert }: { onInsert: (v: string) => void }) {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
      <span>{t("Personalize:")}</span>
      {["{first_name}", "{username}"].map((v) => (
        <button key={v} type="button" onClick={() => onInsert(v)} className="rounded-full border border-border px-2 py-0.5 font-mono hover:bg-surface-hover">
          {v}
        </button>
      ))}
    </div>
  );
}

/** New broadcast or a draft being edited. Saving always keeps it a draft. */
export function BroadcastEditor({
  broadcast,
  initialSegmentId,
  onSaved,
  onDirty,
  footer,
}: {
  broadcast: Broadcast | null;
  initialSegmentId?: string | null;
  onSaved?: () => void;
  onDirty?: (dirty: boolean) => void;
  footer?: React.ReactNode;
}) {
  const t = useT();
  const router = useRouter();
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [segments, setSegments] = useState<SegmentOption[]>([]);
  const [flows, setFlows] = useState<FlowSummary[]>([]);
  const [draft, setDraft] = useState<Draft>(() =>
    broadcast
      ? fromBroadcast(broadcast)
      : {
          name: "",
          accountId: "",
          audience: initialSegmentId ? "segment" : "filters",
          segmentId: initialSegmentId ?? "",
          filters: EMPTY_FILTERS,
          text: "",
          buttons: [],
          abOn: false,
          variants: [],
          skipBusy: true,
          batchSize: BATCH_SIZE.default,
          pauseSeconds: PAUSE_SECONDS.default,
        }
  );
  const [previewKey, setPreviewKey] = useState<VariantKey>("A");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const [savedJson, setSavedJson] = useState(() => (broadcast ? JSON.stringify(fromBroadcast(broadcast)) : ""));
  const dirty = broadcast ? JSON.stringify(draft) !== savedJson : false;
  useEffect(() => {
    onDirty?.(dirty);
  }, [dirty, onDirty]);

  useEffect(() => {
    void flowApi<{ instagramAccounts: AccountOption[] }>("/api/instagram/accounts").then((r) => {
      if (!r.success) return;
      const list = r.data.instagramAccounts ?? [];
      setAccounts(list);
      setDraft((d) => (d.accountId || !list[0] ? d : { ...d, accountId: list[0].id }));
    });
    void flowApi<SegmentOption[]>("/api/segments").then((r) => {
      if (r.success && Array.isArray(r.data)) setSegments(r.data);
    });
  }, []);

  useEffect(() => {
    if (!draft.accountId) return;
    let alive = true;
    void flowApi<FlowSummary[]>(`/api/flows?instagramAccountId=${encodeURIComponent(draft.accountId)}`).then((r) => {
      if (alive && r.success && Array.isArray(r.data)) setFlows(r.data);
    });
    return () => {
      alive = false;
    };
  }, [draft.accountId]);

  const { tags, campaigns } = useSegmentOptions(draft.accountId || "all");
  const describe = useDescribeFilters();

  const segment = segments.find((s) => s.id === draft.segmentId) ?? null;
  const usableSegments = segments.filter((s) => !s.instagramAccountId || s.instagramAccountId === draft.accountId);
  const audienceFilters = draft.audience === "segment" ? segment?.filters ?? EMPTY_FILTERS : draft.filters;
  const live = useLiveCount(audienceFilters, draft.accountId || "all", draft.skipBusy);

  const account = accounts.find((a) => a.id === draft.accountId) ?? null;
  const previewText = draft.abOn ? draft.variants.find((v) => v.key === previewKey)?.text ?? draft.text : draft.text;
  const perHour = Math.round((draft.batchSize * 3600) / Math.max(1, draft.pauseSeconds));

  function toggleAb(on: boolean) {
    if (on) {
      const w = evenWeights(2);
      setDraft((d) => ({
        ...d,
        abOn: true,
        variants: d.variants.length >= 2 ? d.variants : [
          { key: "A", weight: w[0], text: d.text },
          { key: "B", weight: w[1], text: "" },
        ],
      }));
      setPreviewKey("A");
    } else {
      setDraft((d) => ({ ...d, abOn: false, text: d.variants[0]?.text || d.text }));
    }
  }

  function validate(): string | null {
    if (!draft.name.trim()) return t("Give the broadcast a name.");
    if (draft.audience === "segment" && !draft.segmentId) return t("Pick a segment, or use filters.");
    if (draft.abOn) {
      if (draft.variants.some((v) => !v.text.trim())) return t("Every variant needs a text.");
      if (validateWeights(draft.variants)) return t("The split must add up to 100%, with 2 or 3 variants.");
    } else if (!draft.text.trim()) {
      return t("Write the message.");
    }
    for (const b of draft.buttons) {
      if (!b.label.trim()) return t("Every button needs a label.");
      if (b.kind === "link" && !/^https?:\/\/\S+\.\S+/i.test(b.url.trim())) return t("A link button needs a full link (https://…).");
      if (b.kind === "flow" && !b.flowId) return t("Pick the flow of the button.");
    }
    return null;
  }

  async function save() {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    const text = draft.abOn ? draft.variants[0].text : draft.text;
    const body = {
      name: draft.name.trim(),
      ...(broadcast ? {} : { instagramAccountId: draft.accountId || null }),
      segmentId: draft.audience === "segment" ? draft.segmentId : null,
      ...(draft.audience === "filters" ? { filters: draft.filters } : {}),
      text: text.trim(),
      buttons: draft.buttons.map((b) => (b.kind === "link" ? { ...b, label: b.label.trim(), url: b.url.trim() } : { ...b, label: b.label.trim() })),
      variants: draft.abOn ? draft.variants.map((v) => ({ key: v.key, weight: v.weight, text: v.text.trim() })) : null,
      skipBusy: draft.skipBusy,
      batchSize: draft.batchSize,
      pauseSeconds: draft.pauseSeconds,
    };
    const r = broadcast
      ? await flowApi<Broadcast>(`/api/broadcasts/${encodeURIComponent(broadcast.id)}`, { method: "PATCH", json: body })
      : await flowApi<Broadcast>("/api/broadcasts", { method: "POST", json: body });
    setSaving(false);
    if (!r.success) {
      setError(apiErrorText(t, r));
      return;
    }
    setError(null);
    setSavedAt(Date.now());
    setSavedJson(JSON.stringify(draft));
    if (!broadcast) router.replace(`/broadcasts/${r.data.id}`);
    else onSaved?.();
  }

  const inputClass = "w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent/40";

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-6">
        {error && <p className="rounded-xl bg-error/10 px-4 py-2.5 text-sm text-error">{error}</p>}

        <section className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex min-w-0 flex-1 flex-col gap-2 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{t("Broadcast name")}</span>
              <input
                value={draft.name}
                maxLength={80}
                onChange={(e) => set("name", e.target.value)}
                placeholder={t("e.g. Live tonight reminder")}
                className={inputClass}
              />
            </label>
            {accounts.length > 1 && !broadcast && (
              <AccountSelect accounts={accounts} value={draft.accountId} includeAll={false} onChange={(id) => setDraft((d) => ({ ...d, accountId: id, buttons: d.buttons.filter((b) => b.kind === "link") }))} />
            )}
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">{t("1. Who")}</h3>
          <div role="radiogroup" aria-label={t("Who")} className="inline-flex gap-1 rounded-xl bg-surface-hover p-1">
            {(["segment", "filters"] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={draft.audience === k}
                onClick={() => set("audience", k)}
                className={`rounded-lg px-3 py-1.5 text-sm ${draft.audience === k ? "bg-background font-semibold shadow-sm" : "text-muted"}`}
              >
                {k === "segment" ? t("Saved segment") : t("Filters just for this one")}
              </button>
            ))}
          </div>
          {draft.audience === "segment" ? (
            <div className="space-y-2">
              <select value={draft.segmentId} onChange={(e) => set("segmentId", e.target.value)} aria-label={t("Segment")} className={inputClass}>
                <option value="">{t("Pick a segment")}</option>
                {usableSegments.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              {segment && <p className="text-xs text-muted">{describe(segment.filters, campaigns).join(" · ")}</p>}
              <Link href="/segments" className="inline-block text-xs font-semibold text-accent">
                {t("Manage segments")}
              </Link>
            </div>
          ) : (
            <SegmentFiltersEditor filters={draft.filters} onChange={(f) => set("filters", f)} tags={tags} campaigns={campaigns} />
          )}
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={draft.skipBusy} onChange={(e) => set("skipBusy", e.target.checked)} className="mt-0.5" />
            <span>
              {t("Skip people in the middle of a flow or sequence")}
              <span className="block text-xs text-muted">{t("Recommended: they are already getting messages.")}</span>
            </span>
          </label>
          {draft.audience === "segment" && !segment ? (
            <p className="panel rounded-2xl p-4 text-sm text-muted">{t("Pick a segment to see who receives.")}</p>
          ) : (
            <AudienceCount count={live.count} loading={live.loading} error={live.error} />
          )}
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">{t("2. Message")}</h3>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={draft.abOn} onChange={(e) => toggleAb(e.target.checked)} />
              {t("A/B test")}
            </label>
          </div>
          {!draft.abOn ? (
            <div className="space-y-2">
              <textarea
                value={draft.text}
                rows={5}
                maxLength={MAX_BROADCAST_TEXT}
                onChange={(e) => set("text", e.target.value)}
                placeholder={t("Hi {first_name}! …")}
                className={`${inputClass} resize-y`}
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <TextVars onInsert={(v) => set("text", `${draft.text}${draft.text && !draft.text.endsWith(" ") ? " " : ""}${v}`)} />
                <span className="text-xs text-muted tabular-nums">
                  {draft.text.length}/{MAX_BROADCAST_TEXT}
                </span>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-muted">
                {t("Each person gets one variant, always the same one. Same buttons for all.")}
              </p>
              {draft.variants.map((v, i) => (
                <div key={v.key} className="space-y-2 rounded-xl border border-border p-3">
                  <div className="flex items-center gap-2">
                    <VariantBadge k={v.key} />
                    <span className="text-sm font-semibold">{t("Variant {key}", { key: v.key })}</span>
                    <button type="button" onClick={() => setPreviewKey(v.key)} className="ml-auto text-xs font-semibold text-accent">
                      {previewKey === v.key ? t("In the preview") : t("Preview")}
                    </button>
                    {draft.variants.length > 2 && (
                      <button
                        type="button"
                        onClick={() => {
                          const next = draft.variants.filter((_, j) => j !== i).map((x, j) => ({ ...x, key: VARIANT_KEYS[j] }));
                          const w = evenWeights(next.length);
                          set("variants", next.map((x, j) => ({ ...x, weight: w[j] })));
                          setPreviewKey("A");
                        }}
                        className="text-xs text-muted hover:text-error"
                      >
                        {t("Remove")}
                      </button>
                    )}
                  </div>
                  <textarea
                    value={v.text}
                    rows={4}
                    maxLength={MAX_BROADCAST_TEXT}
                    onFocus={() => setPreviewKey(v.key)}
                    onChange={(e) => set("variants", draft.variants.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
                    className={`${inputClass} resize-y`}
                  />
                </div>
              ))}
              {draft.variants.length < VARIANT_KEYS.length && (
                <button
                  type="button"
                  onClick={() => {
                    const next = [...draft.variants, { key: VARIANT_KEYS[draft.variants.length], weight: 0, text: "" }];
                    const w = evenWeights(next.length);
                    set("variants", next.map((x, j) => ({ ...x, weight: w[j] })));
                  }}
                  className="w-full rounded-lg border border-dashed border-border py-2 text-sm text-muted hover:text-foreground"
                >
                  {t("+ Add variant C")}
                </button>
              )}
              <WeightSplit
                keys={draft.variants.map((v) => v.key)}
                weights={draft.variants.map((v) => v.weight)}
                onChange={(w) => set("variants", draft.variants.map((x, j) => ({ ...x, weight: w[j] })))}
              />
            </div>
          )}

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{t("Buttons (up to 3)")}</p>
            {draft.buttons.map((b, i) => (
              <div key={b.id} className="space-y-2 rounded-xl border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={b.label}
                    maxLength={MAX_BUTTON_LABEL}
                    onChange={(e) => set("buttons", draft.buttons.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                    placeholder={t("Button label")}
                    aria-label={t("Button label")}
                    className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none"
                  />
                  <select
                    value={b.kind}
                    aria-label={t("What the button does")}
                    onChange={(e) =>
                      set(
                        "buttons",
                        draft.buttons.map((x, j) =>
                          j !== i ? x : e.target.value === "link" ? { id: x.id, label: x.label, kind: "link", url: "" } : { id: x.id, label: x.label, kind: "flow", flowId: "" }
                        )
                      )
                    }
                    className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none"
                  >
                    <option value="link">{t("Opens a link")}</option>
                    <option value="flow">{t("Starts a flow")}</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => set("buttons", draft.buttons.filter((_, j) => j !== i))}
                    aria-label={t("Remove button")}
                    className="rounded px-2 py-1 text-muted hover:text-error"
                  >
                    ×
                  </button>
                </div>
                {b.kind === "link" ? (
                  <div className="space-y-1">
                    <input
                      value={b.url}
                      onChange={(e) => set("buttons", draft.buttons.map((x, j) => (j === i && x.kind === "link" ? { ...x, url: e.target.value } : x)))}
                      placeholder="https://"
                      aria-label={t("Link")}
                      className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none"
                    />
                    <p className="text-[11px] text-muted">{t("Tracked: each click counts for the person and the variant.")}</p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <select
                      value={b.flowId}
                      onChange={(e) => set("buttons", draft.buttons.map((x, j) => (j === i && x.kind === "flow" ? { ...x, flowId: e.target.value } : x)))}
                      aria-label={t("Flow")}
                      className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none"
                    >
                      <option value="">{t("Pick a flow")}</option>
                      {flows.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                          {!(f.published && f.isActive) ? ` (${t("not published and on")})` : ""}
                        </option>
                      ))}
                    </select>
                    <p className="text-[11px] text-muted">{t("The flow must be published and on when you send.")}</p>
                  </div>
                )}
              </div>
            ))}
            {draft.buttons.length < MAX_BROADCAST_BUTTONS && (
              <button
                type="button"
                onClick={() => set("buttons", [...draft.buttons, { id: newButtonId(draft.buttons.length), label: "", kind: "link", url: "" }])}
                className="w-full rounded-lg border border-border py-2 text-sm text-muted hover:text-foreground"
              >
                {t("+ Add button")}
              </button>
            )}
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">{t("3. Pace")}</h3>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>{t("Send")}</span>
            <input
              type="number"
              min={BATCH_SIZE.min}
              max={BATCH_SIZE.max}
              value={draft.batchSize}
              onChange={(e) => set("batchSize", Math.max(BATCH_SIZE.min, Math.min(BATCH_SIZE.max, Math.round(Number(e.target.value) || 1))))}
              aria-label={t("People per batch")}
              className="w-16 rounded-lg border border-border bg-surface px-2 py-1 text-sm outline-none"
            />
            <span>{t("people, then wait")}</span>
            <input
              type="number"
              min={PAUSE_SECONDS.min}
              max={PAUSE_SECONDS.max}
              value={draft.pauseSeconds}
              onChange={(e) => set("pauseSeconds", Math.max(PAUSE_SECONDS.min, Math.min(PAUSE_SECONDS.max, Math.round(Number(e.target.value) || PAUSE_SECONDS.min))))}
              aria-label={t("Pause in seconds")}
              className="w-20 rounded-lg border border-border bg-surface px-2 py-1 text-sm outline-none"
            />
            <span>{t("seconds")}</span>
          </div>
          <p className="text-xs text-muted">
            {t("Up to about {n} per hour at this pace. The account's hourly limit and monthly quota always win: if the limit is reached the queue waits, nobody is skipped.", { n: perHour })}
          </p>
        </section>

        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {saving ? t("Saving…") : t("Save draft")}
          </button>
          {savedAt && !dirty && <span className="text-xs text-muted">{t("Draft saved.")}</span>}
          {dirty && <span className="text-xs font-semibold text-[#8a560c]">{t("Unsaved changes")}</span>}
          <span className="text-xs text-muted">{t("Saving never sends. You send or schedule in the next step.")}</span>
        </div>
        {footer}
      </div>

      <div className="min-w-0 space-y-3 lg:sticky lg:top-4 lg:self-start">
        <p className="text-sm text-muted">
          {t("Preview")}
          {draft.abOn ? ` · ${t("Variant {key}", { key: previewKey })}` : ""}
        </p>
        <BroadcastPreview text={previewText} buttons={draft.buttons} username={account?.username ?? broadcast?.account?.username ?? null} flows={flows} />
      </div>
    </div>
  );
}

/** datetime-local value 5 minutes from now (the earliest schedule). */
function localInputMin(): string {
  const d = new Date(Date.now() + 5 * 60_000);
  d.setSeconds(0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

/** Send now or schedule a saved draft (signed-in owner/admin only). */
export function SendPanel({ broadcast, onDone, blocked = null }: { broadcast: BroadcastDetail; onDone: () => void; blocked?: string | null }) {
  const t = useT();
  const dateTime = useDateTime();
  const [mode, setMode] = useState<"now" | "later">("now");
  const [when, setWhen] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eligible = broadcast.audience?.eligible ?? 0;
  const total = broadcast.audience?.total ?? 0;
  const channelOff = broadcast.account?.status !== "ACTIVE";

  // Earliest pick: 5 minutes from now (set when "Schedule" is chosen, not during render).
  const [minLocal, setMinLocal] = useState("");
  function chooseMode(m: "now" | "later") {
    setMode(m);
    if (m === "later") setMinLocal(localInputMin());
  }

  async function send() {
    setBusy(true);
    const scheduledAt = mode === "later" && when ? new Date(when).toISOString() : null;
    const r = await flowApi(`/api/broadcasts/${encodeURIComponent(broadcast.id)}/send`, {
      method: "POST",
      json: { scheduledAt, expectedUpdatedAt: broadcast.updatedAt },
    });
    setBusy(false);
    setConfirming(false);
    if (!r.success) setError(apiErrorText(t, r));
    else {
      setError(null);
      onDone();
    }
  }

  return (
    <div className="panel space-y-4 rounded-2xl p-4">
      <p className="text-sm font-semibold">{t("4. Send")}</p>
      {blocked && <p className="rounded-xl bg-warning/15 px-3 py-2 text-sm text-[#8a560c]">{blocked}</p>}
      {broadcast.createdVia === "mcp" && (
        <p className="rounded-xl bg-warning/15 px-3 py-2 text-sm text-[#8a560c]">{t("This draft was made by the AI. Read it before sending: only you can send it.")}</p>
      )}
      {channelOff && <p className="rounded-xl bg-error/10 px-3 py-2 text-sm text-error">{t("The Instagram channel is off. Turn it on in Channels first.")}</p>}
      {error && <p className="rounded-xl bg-error/10 px-3 py-2 text-sm text-error">{error}</p>}

      <div role="radiogroup" aria-label={t("When")} className="inline-flex gap-1 rounded-xl bg-surface-hover p-1">
        {(["now", "later"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            onClick={() => chooseMode(m)}
            className={`rounded-lg px-3 py-1.5 text-sm ${mode === m ? "bg-background font-semibold shadow-sm" : "text-muted"}`}
          >
            {m === "now" ? t("Send now") : t("Schedule")}
          </button>
        ))}
      </div>
      {mode === "later" && (
        <div className="space-y-1">
          <input
            type="datetime-local"
            value={when}
            min={minLocal || undefined}
            onChange={(e) => setWhen(e.target.value)}
            aria-label={t("Date and time")}
            className="rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none"
          />
          <p className="text-xs text-muted">
            {t("Who receives is decided when it starts: only people with the conversation open at that moment. A scheduled broadcast can reach few people, or nobody.")}
          </p>
        </div>
      )}

      {mode === "now" && (
        <p className="text-sm">
          {t("{eligible} of {total} people would get it right now.", { eligible, total })}
        </p>
      )}

      {confirming ? (
        <ConfirmBox
          text={
            mode === "now"
              ? t("Send “{name}” now to {n} people with the conversation open? It goes out in batches; you can cancel in the middle.", { name: broadcast.name, n: eligible })
              : t("Schedule “{name}” for {when}? It only reaches people with the conversation open then.", { name: broadcast.name, when: when ? dateTime(new Date(when).toISOString()) : "" })
          }
          confirmLabel={mode === "now" ? t("Send now") : t("Schedule")}
          busy={busy}
          onConfirm={() => void send()}
          onCancel={() => setConfirming(false)}
        />
      ) : (
        <button
          type="button"
          disabled={Boolean(blocked) || channelOff || (mode === "later" && !when) || (mode === "now" && eligible === 0)}
          onClick={() => setConfirming(true)}
          className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {mode === "now" ? t("Send now") : t("Schedule")}
        </button>
      )}
      {mode === "now" && eligible === 0 && !channelOff && (
        <p className="text-xs text-muted">{t("Nobody in this segment has the conversation open right now. Try later, or schedule it.")}</p>
      )}
      <p className="text-[11px] text-muted">{t("Only owners and admins signed in here can send. API keys and the AI only create drafts.")}</p>
    </div>
  );
}

type RecipientRow = {
  id: string;
  igUserId: string;
  variantKey: string | null;
  status: string;
  error: string | null;
  sentAt: string | null;
  updatedAt: string;
  contact: { id: string; username: string | null; name: string | null } | null;
};

const RECIPIENT_FILTERS = ["", "SENT", "FAILED", "MAYBE_SENT", "PENDING", "SKIPPED_WINDOW", "SKIPPED_OPTOUT", "SKIPPED_TAKEOVER", "SKIPPED_BUSY", "SKIPPED_LIMIT", "SKIPPED_CANCELED"];

function Recipients({ broadcastId, refreshKey }: { broadcastId: string; refreshKey: number }) {
  const t = useT();
  const timeAgo = useTimeAgo();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<RecipientRow[] | null>(null);
  useEffect(() => {
    let alive = true;
    const qs = new URLSearchParams({ page: String(page) });
    if (status) qs.set("status", status);
    void flowApi<RecipientRow[]>(`/api/broadcasts/${encodeURIComponent(broadcastId)}/recipients?${qs}`).then((r) => {
      if (alive) setRows(r.success && Array.isArray(r.data) ? r.data : []);
    });
    return () => {
      alive = false;
    };
  }, [broadcastId, status, page, refreshKey]);

  return (
    <div className="panel space-y-3 rounded-2xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">{t("People")}</p>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          aria-label={t("Status")}
          className="rounded-lg border border-border bg-surface px-2 py-1 text-sm outline-none"
        >
          {RECIPIENT_FILTERS.map((s) => (
            <option key={s} value={s}>
              {s ? t(RECIPIENT_STATUS_LABEL[s]) : t("Everyone")}
            </option>
          ))}
        </select>
      </div>
      {rows === null ? (
        <div className="h-16 animate-pulse rounded-xl bg-surface-hover" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted">{t("Nobody here.")}</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
              {r.variantKey && <VariantBadge k={r.variantKey} />}
              {r.contact ? (
                <Link href={`/contacts/${r.contact.id}`} className="min-w-0 truncate font-semibold hover:underline">
                  <ContactName username={r.contact.username} name={r.contact.name} igUserId={r.igUserId} />
                </Link>
              ) : (
                <span className="font-semibold">
                  <ContactName igUserId={r.igUserId} />
                </span>
              )}
              <span className={`text-xs ${r.status === "SENT" ? "text-[#3a8a12]" : r.status === "FAILED" ? "text-error" : "text-muted"}`}>
                {t(RECIPIENT_STATUS_LABEL[r.status] ?? r.status)}
              </span>
              <span className="ml-auto text-xs text-muted">{timeAgo(r.sentAt ?? r.updatedAt)}</span>
              {r.error && r.status !== "SENT" && <p className="w-full truncate text-xs text-muted" title={r.error}>{r.error}</p>}
            </li>
          ))}
        </ul>
      )}
      <div className="flex justify-between">
        <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="text-sm text-muted disabled:opacity-30">
          {t("← Previous")}
        </button>
        <button type="button" disabled={(rows?.length ?? 0) < 50} onClick={() => setPage((p) => p + 1)} className="text-sm text-muted disabled:opacity-30">
          {t("Next →")}
        </button>
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="panel rounded-2xl p-3">
      <p className={`text-xl font-semibold tabular-nums ${tone ?? ""}`}>{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}

/** History of a broadcast that left the draft stage. */
export function BroadcastHistory({ broadcast, onChange }: { broadcast: BroadcastDetail; onChange: () => void }) {
  const t = useT();
  const dateTime = useDateTime();
  const [confirm, setConfirm] = useState<{ kind: "cancel" } | { kind: "winner"; key: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const s = broadcast.stats.totals;
  const eligible = broadcast.counts.eligible ?? 0;
  const done = s.sent + s.failed + s.skipped;
  const pct = eligible > 0 ? Math.min(100, Math.round((done / eligible) * 100)) : 0;
  const running = broadcast.status === "SENDING" || broadcast.status === "SCHEDULED";

  async function cancel() {
    setBusy(true);
    const r = await flowApi(`/api/broadcasts/${encodeURIComponent(broadcast.id)}/cancel`, { method: "POST" });
    setBusy(false);
    setConfirm(null);
    if (!r.success) setError(apiErrorText(t, r));
    else onChange();
  }

  async function declare(key: string) {
    setBusy(true);
    const r = await flowApi(`/api/broadcasts/${encodeURIComponent(broadcast.id)}/winner`, { method: "POST", json: { key } });
    setBusy(false);
    setConfirm(null);
    if (!r.success) setError(apiErrorText(t, r));
    else onChange();
  }

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setRefreshKey((k) => k + 1), 15_000);
    return () => window.clearInterval(timer);
  }, [running]);

  return (
    <div className="space-y-4">
      {error && <p className="rounded-xl bg-error/10 px-4 py-2.5 text-sm text-error">{error}</p>}

      <div className="panel space-y-3 rounded-2xl p-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          {broadcast.scheduledAt && <span>{t("Scheduled for {when}", { when: dateTime(broadcast.scheduledAt) })}</span>}
          {broadcast.startedAt && <span className="text-muted">{t("Started {when}", { when: dateTime(broadcast.startedAt) })}</span>}
          {broadcast.finishedAt && <span className="text-muted">{t("Finished {when}", { when: dateTime(broadcast.finishedAt) })}</span>}
          {broadcast.canceledAt && <span className="text-muted">{t("Canceled {when}", { when: dateTime(broadcast.canceledAt) })}</span>}
        </div>
        {broadcast.stopReason && STOP_REASON[broadcast.stopReason] && <p className="text-sm text-muted">{t(STOP_REASON[broadcast.stopReason])}</p>}
        {broadcast.counts.segment !== null && (
          <p className="text-sm">
            {t("{total} contacts in the segment when it started, {eligible} with the conversation open (only those receive).", {
              total: broadcast.counts.segment ?? 0,
              eligible,
            })}
          </p>
        )}
        {broadcast.status === "SCHEDULED" && broadcast.audience && (
          <p className="text-sm text-muted">
            {t("Right now {eligible} of {total} would get it. The list is made when it starts.", {
              eligible: broadcast.audience.eligible,
              total: broadcast.audience.total,
            })}
          </p>
        )}
        {(broadcast.status === "SENDING" || done > 0) && eligible > 0 && (
          <div className="space-y-1">
            <div className="h-2 overflow-hidden rounded-full bg-surface-hover" aria-hidden>
              <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
            </div>
            <p className="text-xs text-muted">{t("{done} of {n} handled ({pct}%)", { done, n: eligible, pct })}</p>
          </div>
        )}
        {running &&
          (confirm?.kind === "cancel" ? (
            <ConfirmBox
              text={t("Stop this broadcast? Whoever has not received it yet will not. The one message going out right now, if any, still finishes.")}
              confirmLabel={t("Stop the broadcast")}
              danger
              busy={busy}
              onConfirm={() => void cancel()}
              onCancel={() => setConfirm(null)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setConfirm({ kind: "cancel" })}
              className="rounded-lg border border-error/30 px-4 py-2 text-sm font-semibold text-error hover:bg-error/10"
            >
              {broadcast.status === "SCHEDULED" ? t("Cancel the schedule") : t("Stop the broadcast")}
            </button>
          ))}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Metric label={t("Sent")} value={s.sent} tone="text-[#3a8a12]" />
        <Metric label={t("Failed")} value={s.failed} tone={s.failed ? "text-error" : ""} />
        <Metric label={t("Skipped")} value={s.skipped} />
        <Metric label={t("Clicked")} value={s.clicked} />
        <Metric label={t("Replied")} value={s.replied} />
        <Metric label="CTR" value={`${s.ctr}%`} />
      </div>
      <p className="text-xs text-muted">
        {t("Clicked = people who tapped a link. Replied = people who wrote back within {h} hours.", { h: broadcast.stats.replyWindowHours })}
        {s.pending > 0 ? ` ${t("{n} still waiting in the queue.", { n: s.pending })}` : ""}
        {s.maybeSent > 0 ? ` ${t("{n} unclear (Instagram did not confirm; never resent).", { n: s.maybeSent })}` : ""}
      </p>

      {broadcast.variants.length >= 2 && (
        <div className="panel space-y-3 rounded-2xl p-4">
          <p className="text-sm font-semibold">{t("A/B test")}</p>
          {confirm?.kind === "winner" && (
            <ConfirmBox
              text={t("Variant {key} becomes the only text of this broadcast. Whoever is still waiting gets it.", { key: confirm.key })}
              confirmLabel={t("Declare winner")}
              busy={busy}
              onConfirm={() => void declare(confirm.key)}
              onCancel={() => setConfirm(null)}
            />
          )}
          <VariantResults
            rows={broadcast.stats.variants}
            winnerKey={broadcast.abWinnerKey}
            busyKey={busy && confirm?.kind === "winner" ? confirm.key : null}
            onDeclare={(key) => setConfirm({ kind: "winner", key })}
          />
          <ul className="space-y-1.5">
            {broadcast.variants.map((v) => (
              <li key={v.key} className="flex items-start gap-2 text-sm">
                <VariantBadge k={v.key} />
                <span className="min-w-0 flex-1">
                  <span className="font-semibold">{v.weight}%</span>
                  <span className="block whitespace-pre-wrap text-xs text-muted">{v.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Recipients broadcastId={broadcast.id} refreshKey={refreshKey} />
    </div>
  );
}

/** Loads a broadcast by id: editor + send for drafts, history for the rest. */
export function BroadcastScreen({ id }: { id: string }) {
  const t = useT();
  const router = useRouter();
  const [data, setData] = useState<BroadcastDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [version, setVersion] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await flowApi<BroadcastDetail>(`/api/broadcasts/${encodeURIComponent(id)}`);
    if (r.success) setData(r.data);
    else setMissing(true);
  }, [id]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load, version]);

  useEffect(() => {
    if (!data || (data.status !== "SENDING" && data.status !== "SCHEDULED")) return;
    const timer = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(timer);
  }, [data, load]);

  async function remove() {
    const r = await flowApi(`/api/broadcasts/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (r.success) router.push("/broadcasts");
    else setError(apiErrorText(t, r));
  }

  if (missing) {
    return (
      <div className="panel mx-auto max-w-md space-y-3 rounded-2xl p-8 text-center">
        <p className="text-sm text-muted">{t("Broadcast not found.")}</p>
        <Link href="/broadcasts" className="text-sm font-semibold text-accent">
          {t("← Broadcasts")}
        </Link>
      </div>
    );
  }
  if (!data) return <div className="panel h-64 animate-pulse rounded-2xl" />;

  const isDraft = data.status === "DRAFT";
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="space-y-2">
        <Link href="/broadcasts" className="text-sm text-muted hover:text-foreground">
          {t("← Broadcasts")}
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="min-w-0 truncate text-xl font-semibold">{data.name}</h2>
          <BroadcastStatusChip status={data.status} />
          {data.account && <span className="text-sm text-muted">@{data.account.username}</span>}
          {data.segmentName && <span className="text-sm text-muted">· {data.segmentName}</span>}
        </div>
      </div>
      {error && <p className="rounded-xl bg-error/10 px-4 py-2.5 text-sm text-error">{error}</p>}
      {isDraft ? (
        <BroadcastEditor
          key={data.updatedAt}
          broadcast={data}
          onSaved={() => setVersion((v) => v + 1)}
          onDirty={setDirty}
          footer={
            <div className="space-y-3">
              <SendPanel
                broadcast={data}
                blocked={dirty ? t("Save the draft first: unsaved changes are not sent.") : null}
                onDone={() => setVersion((v) => v + 1)}
              />
              {confirmDelete ? (
                <ConfirmBox
                  text={t("Delete this draft? Nothing was sent.")}
                  confirmLabel={t("Delete")}
                  danger
                  onConfirm={() => void remove()}
                  onCancel={() => setConfirmDelete(false)}
                />
              ) : (
                <button type="button" onClick={() => setConfirmDelete(true)} className="text-sm text-muted hover:text-error">
                  {t("Delete draft")}
                </button>
              )}
            </div>
          }
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0">
            <BroadcastHistory broadcast={data} onChange={() => setVersion((v) => v + 1)} />
          </div>
          <div className="min-w-0 space-y-3">
            <p className="text-sm text-muted">{t("What was sent")}</p>
            <BroadcastPreview text={data.text} buttons={data.buttons} username={data.account?.username ?? null} flows={[]} />
          </div>
        </div>
      )}
    </div>
  );
}
