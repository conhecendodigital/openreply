"use client";

/**
 * A/B test pieces (Etapa 5, 2026-10-08), for campaigns and broadcasts.
 *
 * - Up to 3 variants (A, B, C) with a % split that adds up to 100.
 * - The same person always falls in the same variant (the server draws it
 *   from the person's id, nothing random on each send).
 * - "Declare winner" makes that variant the only one.
 *
 * A campaign's test starts off and is optional: with it off (or with no
 * variants) the campaign sends exactly what it always sent. Saving variants
 * never turns the test on; only the switch does, and only a signed-in person.
 */

import { useCallback, useEffect, useState } from "react";
import { Switch } from "@/components/contact-ui";
import { useT } from "@/components/lang-provider";
import { flowApi } from "@/components/flows/flow-shared";
import { apiErrorText } from "@/components/segment-builder";
import { VARIANT_KEYS, validateWeights, type VariantKey } from "@/lib/ab/keys";

export type VariantResult = {
  key: string | null;
  sent: number;
  clicked: number;
  replied: number;
  ctr: number;
  failed?: number;
};

/** Even split for n variants that adds up to exactly 100 (34/33/33). */
export function evenWeights(n: number): number[] {
  const base = Math.floor(100 / n);
  return Array.from({ length: n }, (_, i) => base + (i < 100 - base * n ? 1 : 0));
}

const VARIANT_COLOR: Record<string, string> = { A: "#0095f6", B: "#d62976", C: "#f2a33a" };

export function VariantBadge({ k }: { k: string }) {
  return (
    <span
      className="inline-grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold text-white"
      style={{ background: VARIANT_COLOR[k] ?? "#737373" }}
    >
      {k}
    </span>
  );
}

/** Split editor: one % per variant, a bar showing it, and "even split". */
export function WeightSplit({
  keys,
  weights,
  onChange,
}: {
  keys: string[];
  weights: number[];
  onChange: (next: number[]) => void;
}) {
  const t = useT();
  const total = weights.reduce((s, w) => s + (Number.isFinite(w) ? w : 0), 0);
  return (
    <div className="space-y-2">
      <div className="flex h-3 overflow-hidden rounded-full bg-surface-hover" aria-hidden>
        {keys.map((k, i) => (
          <div key={k} style={{ width: `${Math.max(0, Math.min(100, weights[i] ?? 0))}%`, background: VARIANT_COLOR[k] }} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {keys.map((k, i) => (
          <label key={k} className="flex items-center gap-1.5 text-sm">
            <VariantBadge k={k} />
            <input
              type="number"
              min={1}
              max={99}
              value={Number.isFinite(weights[i]) ? weights[i] : ""}
              onChange={(e) => {
                const next = [...weights];
                next[i] = Math.round(Number(e.target.value));
                onChange(next);
              }}
              aria-label={t("Share of variant {key}", { key: k })}
              className="w-16 rounded-lg border border-border bg-surface px-2 py-1 text-sm outline-none"
            />
            %
          </label>
        ))}
        <button type="button" onClick={() => onChange(evenWeights(keys.length))} className="text-xs font-semibold text-accent">
          {t("Even split")}
        </button>
        <span className={`ml-auto text-xs ${total === 100 ? "text-muted" : "font-semibold text-error"}`}>
          {t("Total {n}%", { n: total })}
        </span>
      </div>
    </div>
  );
}

/** Per-variant numbers with a CTR bar and the "declare winner" button. */
export function VariantResults({
  rows,
  winnerKey,
  onDeclare,
  busyKey,
  showReplies = true,
}: {
  rows: VariantResult[];
  winnerKey?: string | null;
  onDeclare?: (key: string) => void;
  busyKey?: string | null;
  showReplies?: boolean;
}) {
  const t = useT();
  const list = rows.filter((r): r is VariantResult & { key: string } => Boolean(r.key));
  if (list.length === 0) return <p className="text-sm text-muted">{t("No sends in the test yet.")}</p>;
  const best = list.reduce((a, b) => (b.ctr > a.ctr ? b : a), list[0]);
  const maxCtr = Math.max(1, ...list.map((r) => r.ctr));
  const enough = list.every((r) => r.sent >= 30);
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="py-1.5 pr-2 font-medium">{t("Variant")}</th>
              <th className="px-2 py-1.5 text-right font-medium">{t("Sent")}</th>
              <th className="px-2 py-1.5 text-right font-medium">{t("Clicks")}</th>
              {showReplies && <th className="px-2 py-1.5 text-right font-medium">{t("Replies")}</th>}
              <th className="px-2 py-1.5 font-medium">CTR</th>
              {onDeclare && <th className="py-1.5 pl-2" />}
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.key} className="border-t border-border">
                <td className="py-2 pr-2">
                  <span className="flex items-center gap-2">
                    <VariantBadge k={r.key} />
                    {winnerKey === r.key && (
                      <span className="rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-semibold text-[#3a8a12]">{t("Winner")}</span>
                    )}
                    {!winnerKey && list.length > 1 && best.key === r.key && r.sent > 0 && (
                      <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-semibold text-accent">{t("Leading")}</span>
                    )}
                  </span>
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{r.sent}</td>
                <td className="px-2 py-2 text-right tabular-nums">{r.clicked}</td>
                {showReplies && <td className="px-2 py-2 text-right tabular-nums">{r.replied}</td>}
                <td className="px-2 py-2">
                  <span className="flex items-center gap-2">
                    <span className="h-2 w-20 overflow-hidden rounded-full bg-surface-hover" aria-hidden>
                      <span className="block h-full rounded-full" style={{ width: `${(r.ctr / maxCtr) * 100}%`, background: VARIANT_COLOR[r.key] }} />
                    </span>
                    <span className="tabular-nums">{r.ctr}%</span>
                  </span>
                </td>
                {onDeclare && (
                  <td className="py-2 pl-2 text-right">
                    {winnerKey !== r.key && (
                      <button
                        type="button"
                        disabled={Boolean(busyKey)}
                        onClick={() => onDeclare(r.key)}
                        className="whitespace-nowrap rounded-lg border border-border px-2.5 py-1 text-xs font-semibold hover:bg-surface-hover disabled:opacity-50"
                      >
                        {busyKey === r.key ? t("Saving…") : t("Declare winner")}
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!enough && !winnerKey && (
        <p className="text-xs text-muted">{t("Few sends so far: wait for at least 30 per variant before choosing.")}</p>
      )}
    </div>
  );
}

/** Small confirmation box (no browser dialogs: they look off on the phone). */
export function ConfirmBox({
  text,
  confirmLabel,
  onConfirm,
  onCancel,
  busy = false,
  danger = false,
}: {
  text: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  danger?: boolean;
}) {
  const t = useT();
  return (
    <div className="space-y-3 rounded-xl border border-border bg-surface-hover p-3">
      <p className="text-sm">{text}</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className={`rounded-lg px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50 ${danger ? "bg-error" : "bg-accent hover:bg-accent-hover"}`}
        >
          {busy ? t("Saving…") : confirmLabel}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-border px-3 py-1.5 text-sm font-semibold">
          {t("Cancel")}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Campaign

type CampaignVariant = { key: string; weight: number; openingDmMessage: string | null; dmMessage: string | null };

type CampaignAb = {
  abTestEnabled: boolean;
  abWinnerKey: string | null;
  base: { openingDmEnabled: boolean; openingDmMessage: string | null; dmMessage: string };
  variants: CampaignVariant[];
  stats: VariantResult[];
};

type DraftVariant = { key: VariantKey; weight: number; openingDmMessage: string; dmMessage: string };

/**
 * A/B of a saved campaign. Lives in its own box and saves through its own
 * route, so the campaign's "Save changes" never touches it.
 */
export function CampaignAbPanel({ campaignId, compact = false }: { campaignId: string; compact?: boolean }) {
  const t = useT();
  const [data, setData] = useState<CampaignAb | null>(null);
  const [draft, setDraft] = useState<DraftVariant[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [declaring, setDeclaring] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "on" } | { kind: "winner"; key: string } | null>(null);

  const load = useCallback(async () => {
    const r = await flowApi<CampaignAb>(`/api/automations/${encodeURIComponent(campaignId)}/ab`);
    if (r.success) setData(r.data);
    else setError(apiErrorText(t, r));
  }, [campaignId, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  if (!data) {
    return error ? <p className="text-sm text-error">{error}</p> : <div className="panel h-24 animate-pulse rounded-2xl" />;
  }

  const opening = data.base.openingDmEnabled;

  function startEditing() {
    if (!data) return;
    const existing = data.variants;
    if (existing.length >= 2) {
      setDraft(
        existing.map((v) => ({
          key: v.key as VariantKey,
          weight: v.weight,
          openingDmMessage: v.openingDmMessage ?? "",
          dmMessage: v.dmMessage ?? "",
        }))
      );
    } else {
      setDraft([
        { key: "A", weight: 50, openingDmMessage: "", dmMessage: "" },
        { key: "B", weight: 50, openingDmMessage: "", dmMessage: "" },
      ]);
    }
  }

  async function saveDraft() {
    if (!draft) return;
    const weightError = validateWeights(draft);
    if (weightError) {
      setError(t("The split must add up to 100%, with 2 or 3 variants."));
      return;
    }
    setBusy(true);
    const r = await flowApi(`/api/automations/${encodeURIComponent(campaignId)}/ab`, {
      method: "PUT",
      json: {
        variants: draft.map((v) => ({
          key: v.key,
          weight: v.weight,
          dmMessage: v.dmMessage.trim() || null,
          openingDmMessage: opening ? v.openingDmMessage.trim() || null : null,
        })),
      },
    });
    setBusy(false);
    if (!r.success) {
      setError(apiErrorText(t, r));
      return;
    }
    setError(null);
    setDraft(null);
    await load();
  }

  async function setActive(enabled: boolean) {
    setBusy(true);
    const r = await flowApi(`/api/automations/${encodeURIComponent(campaignId)}/ab/active`, { method: "POST", json: { enabled } });
    setBusy(false);
    setConfirm(null);
    if (!r.success) setError(apiErrorText(t, r));
    else {
      setError(null);
      await load();
    }
  }

  async function declare(key: string) {
    setDeclaring(key);
    const r = await flowApi(`/api/automations/${encodeURIComponent(campaignId)}/ab/winner`, { method: "POST", json: { key } });
    setDeclaring(null);
    setConfirm(null);
    if (!r.success) setError(apiErrorText(t, r));
    else {
      setError(null);
      await load();
    }
  }

  const hasVariants = data.variants.length >= 2;

  return (
    <div className="panel min-w-0 space-y-4 rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold">{t("A/B test")}</p>
          <p className="text-xs text-muted">
            {data.abTestEnabled
              ? t("Running: each person gets one variant, always the same one.")
              : t("Off. The campaign sends its own texts, exactly as today.")}
          </p>
        </div>
        {hasVariants && (
          <Switch
            checked={data.abTestEnabled}
            disabled={busy}
            label={data.abTestEnabled ? t("Turn the test off") : t("Turn the test on")}
            onChange={(next) => (next ? setConfirm({ kind: "on" }) : void setActive(false))}
          />
        )}
      </div>

      {error && <p className="rounded-xl bg-error/10 px-3 py-2 text-sm text-error">{error}</p>}

      {confirm?.kind === "on" && (
        <ConfirmBox
          text={t("From now on each new person gets one of the variants, by the split. Turning it off goes back to the campaign's own texts.")}
          confirmLabel={t("Turn the test on")}
          busy={busy}
          onConfirm={() => void setActive(true)}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm?.kind === "winner" && (
        <ConfirmBox
          text={t("Variant {key} becomes the campaign's only text and the test turns off. The other variants stay as history.", { key: confirm.key })}
          confirmLabel={t("Declare winner")}
          busy={declaring !== null}
          onConfirm={() => void declare(confirm.key)}
          onCancel={() => setConfirm(null)}
        />
      )}

      {data.abWinnerKey && !data.abTestEnabled && (
        <p className="rounded-xl bg-success/10 px-3 py-2 text-sm text-[#3a8a12]">
          {t("Variant {key} won and is now the campaign's text.", { key: data.abWinnerKey })}
        </p>
      )}

      {draft ? (
        <div className="space-y-3">
          {draft.map((v, i) => (
            <div key={v.key} className="space-y-2 rounded-xl border border-border p-3">
              <div className="flex items-center gap-2">
                <VariantBadge k={v.key} />
                <span className="text-sm font-semibold">{t("Variant {key}", { key: v.key })}</span>
                {draft.length > 2 && (
                  <button
                    type="button"
                    onClick={() => {
                      const next = draft.filter((_, j) => j !== i).map((x, j) => ({ ...x, key: VARIANT_KEYS[j] }));
                      const w = evenWeights(next.length);
                      setDraft(next.map((x, j) => ({ ...x, weight: w[j] })));
                    }}
                    className="ml-auto text-xs text-muted hover:text-error"
                  >
                    {t("Remove")}
                  </button>
                )}
              </div>
              {opening && (
                <label className="block space-y-1">
                  <span className="text-xs text-muted">{t("Opening DM")}</span>
                  <textarea
                    value={v.openingDmMessage}
                    rows={2}
                    maxLength={1000}
                    placeholder={data.base.openingDmMessage ?? ""}
                    onChange={(e) => setDraft(draft.map((x, j) => (j === i ? { ...x, openingDmMessage: e.target.value } : x)))}
                    className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent/40"
                  />
                </label>
              )}
              <label className="block space-y-1">
                <span className="text-xs text-muted">{t("Final message (with the link)")}</span>
                <textarea
                  value={v.dmMessage}
                  rows={3}
                  maxLength={1000}
                  placeholder={data.base.dmMessage}
                  onChange={(e) => setDraft(draft.map((x, j) => (j === i ? { ...x, dmMessage: e.target.value } : x)))}
                  className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent/40"
                />
              </label>
              <p className="text-[11px] text-muted">{t("Empty = uses the campaign's own text. {link} and {username} work here too.")}</p>
            </div>
          ))}
          {draft.length < VARIANT_KEYS.length && (
            <button
              type="button"
              onClick={() => {
                const next = [...draft, { key: VARIANT_KEYS[draft.length], weight: 0, openingDmMessage: "", dmMessage: "" }];
                const w = evenWeights(next.length);
                setDraft(next.map((x, j) => ({ ...x, weight: w[j] })));
              }}
              className="w-full rounded-lg border border-dashed border-border py-2 text-sm text-muted hover:text-foreground"
            >
              {t("+ Add variant C")}
            </button>
          )}
          <WeightSplit
            keys={draft.map((v) => v.key)}
            weights={draft.map((v) => v.weight)}
            onChange={(w) => setDraft(draft.map((x, j) => ({ ...x, weight: w[j] })))}
          />
          {data.abTestEnabled && (
            <p className="text-xs text-[#8a560c]">{t("The test is running: changing a text now mixes old and new results.")}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void saveDraft()}
              disabled={busy}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {busy ? t("Saving…") : t("Save variants")}
            </button>
            <button type="button" onClick={() => setDraft(null)} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold">
              {t("Cancel")}
            </button>
          </div>
          <p className="text-[11px] text-muted">{t("Saving the variants does not turn the test on.")}</p>
        </div>
      ) : hasVariants ? (
        <div className="space-y-3">
          <ul className="space-y-1.5">
            {data.variants.map((v) => (
              <li key={v.key} className="flex items-start gap-2 text-sm">
                <VariantBadge k={v.key} />
                <span className="min-w-0 flex-1">
                  <span className="font-semibold">{v.weight}%</span>
                  <span className="line-clamp-2 break-words text-xs text-muted">{v.dmMessage || t("(campaign's own text)")}</span>
                </span>
              </li>
            ))}
          </ul>
          <VariantResults
            rows={data.stats}
            winnerKey={data.abWinnerKey}
            busyKey={declaring}
            onDeclare={(key) => setConfirm({ kind: "winner", key })}
          />
          {!compact && (
            <button type="button" onClick={startEditing} className="text-sm font-semibold text-accent">
              {t("Edit variants")}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-muted">
            {t("Test up to 3 versions of the opening DM and the final message. You see sends, clicks, replies and CTR of each and keep the best one.")}
          </p>
          <button type="button" onClick={startEditing} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-surface-hover">
            {t("Set up variants")}
          </button>
        </div>
      )}
    </div>
  );
}
