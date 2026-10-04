"use client";

/**
 * Segments (Etapa 5, 2026-10-08): saved filters over the CRM, with the live
 * count. A segment only describes people; it sends nothing. Broadcasts use
 * it, and only people with the 24 h conversation open receive.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AccountSelect, { type AccountOption } from "@/components/account-select";
import { useT } from "@/components/lang-provider";
import { useTimeAgo } from "@/components/contact-ui";
import { flowApi } from "@/components/flows/flow-shared";
import {
  AudienceCount,
  apiErrorText as segmentErrorText,
  SegmentFiltersEditor,
  useDescribeFilters,
  useLiveCount,
  useSegmentOptions,
  type SegmentCount,
} from "@/components/segment-builder";
import { EMPTY_FILTERS, type SegmentFilters } from "@/lib/segments/schema";

type SegmentRow = {
  id: string;
  name: string;
  instagramAccountId: string | null;
  filters: SegmentFilters;
  createdVia: string;
  lastCount: number | null;
  updatedAt: string;
  count?: SegmentCount;
};

type Editing = { id: string | null; name: string; accountId: string; filters: SegmentFilters };

export default function SegmentsPage() {
  const t = useT();
  const timeAgo = useTimeAgo();
  const describe = useDescribeFilters();
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [segments, setSegments] = useState<SegmentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const { tags, campaigns } = useSegmentOptions(editing?.accountId ?? "all");
  const live = useLiveCount(editing?.filters ?? EMPTY_FILTERS, editing?.accountId ?? "all");

  useEffect(() => {
    void flowApi<{ instagramAccounts: AccountOption[] }>("/api/instagram/accounts").then((r) => {
      if (r.success) setAccounts(r.data.instagramAccounts ?? []);
    });
  }, []);

  const load = useCallback(async () => {
    const r = await flowApi<SegmentRow[]>("/api/segments?count=1");
    if (r.success) {
      setSegments(r.data);
      setError(null);
    } else {
      setSegments([]);
      setError(segmentErrorText(t, r));
    }
  }, [t]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  function startNew() {
    setEditing({ id: null, name: "", accountId: accounts.length === 1 ? accounts[0].id : "all", filters: EMPTY_FILTERS });
  }

  async function save() {
    if (!editing) return;
    const name = editing.name.trim();
    if (!name) {
      setError(t("Give the segment a name."));
      return;
    }
    setSaving(true);
    const body = {
      name,
      instagramAccountId: editing.accountId === "all" ? null : editing.accountId,
      filters: editing.filters,
    };
    const r = editing.id
      ? await flowApi<SegmentRow>(`/api/segments/${encodeURIComponent(editing.id)}`, { method: "PATCH", json: body })
      : await flowApi<SegmentRow>("/api/segments", { method: "POST", json: body });
    setSaving(false);
    if (!r.success) {
      setError(segmentErrorText(t, r));
      return;
    }
    setEditing(null);
    setError(null);
    await load();
  }

  async function remove(id: string) {
    const r = await flowApi(`/api/segments/${encodeURIComponent(id)}`, { method: "DELETE" });
    setConfirmDelete(null);
    if (!r.success) setError(segmentErrorText(t, r));
    else setSegments((list) => list?.filter((s) => s.id !== id) ?? list);
  }

  const accountName = (id: string | null) =>
    id ? `@${accounts.find((a) => a.id === id)?.username ?? "?"}` : t("All accounts");

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold">{t("Segments")}</h2>
          <p className="max-w-2xl text-sm text-muted">
            {t("Groups of contacts from your CRM, by tag, campaign, click and last interaction. A segment sends nothing by itself: use it in a broadcast.")}
          </p>
        </div>
        {!editing && (
          <button type="button" onClick={startNew} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover">
            {t("New segment")}
          </button>
        )}
      </div>

      {error && <p className="rounded-xl bg-error/10 px-4 py-2.5 text-sm text-error">{error}</p>}

      {editing && (
        <section className="space-y-4" aria-label={editing.id ? t("Edit segment") : t("New segment")}>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex min-w-0 flex-1 flex-col gap-2 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{t("Segment name")}</span>
              <input
                value={editing.name}
                maxLength={80}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder={t("e.g. Clicked but did not buy")}
                className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent/40"
              />
            </label>
            {accounts.length > 1 && (
              <AccountSelect accounts={accounts} value={editing.accountId} onChange={(id) => setEditing({ ...editing, accountId: id })} />
            )}
          </div>
          <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
            <div className="min-w-0">
              <SegmentFiltersEditor
                filters={editing.filters}
                onChange={(filters) => setEditing({ ...editing, filters })}
                tags={tags}
                campaigns={campaigns}
              />
            </div>
            <div className="min-w-0 space-y-3 lg:sticky lg:top-4 lg:self-start">
              <AudienceCount count={live.count} loading={live.loading} error={live.error} title={t("Live count")} />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={saving}
                  className="flex-1 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
                >
                  {saving ? t("Saving…") : t("Save segment")}
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-surface-hover"
                >
                  {t("Cancel")}
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {segments === null ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="panel h-20 animate-pulse rounded-2xl" />
          ))}
        </div>
      ) : segments.length === 0 && !editing ? (
        <div className="panel space-y-3 rounded-2xl p-8 text-center">
          <p className="text-sm font-semibold">{t("No segments yet")}</p>
          <p className="mx-auto max-w-md text-sm text-muted">
            {t("Start with something simple, like everyone with a tag who clicked a link in the last 30 days.")}
          </p>
          <button type="button" onClick={startNew} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover">
            {t("New segment")}
          </button>
        </div>
      ) : (
        <ul className="space-y-2">
          {segments.map((s) => (
            <li key={s.id} className="panel flex flex-col gap-3 rounded-2xl p-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1 space-y-1">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-semibold">{s.name}</span>
                  {s.createdVia === "mcp" && (
                    <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted">{t("made by the AI")}</span>
                  )}
                </p>
                <p className="line-clamp-2 text-xs text-muted">{describe(s.filters, campaigns).join(" · ")}</p>
                <p className="text-xs text-muted">
                  {accountName(s.instagramAccountId)} · {t("edited {when}", { when: timeAgo(s.updatedAt) })}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <div className="grid grid-cols-2 gap-3 text-center">
                  <div className="min-w-14">
                    <p className="text-base font-semibold tabular-nums">{s.count?.total ?? s.lastCount ?? "–"}</p>
                    <p className="text-[11px] text-muted">{t("Contacts")}</p>
                  </div>
                  <div className="min-w-14">
                    <p className="text-base font-semibold tabular-nums text-[#3a8a12]">{s.count?.eligible ?? "–"}</p>
                    <p className="text-[11px] text-muted">{t("Open now")}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link
                    href={`/broadcasts/new?segment=${encodeURIComponent(s.id)}`}
                    className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover"
                  >
                    {t("Broadcast")}
                  </Link>
                  <button
                    type="button"
                    onClick={() =>
                      setEditing({ id: s.id, name: s.name, accountId: s.instagramAccountId ?? "all", filters: s.filters })
                    }
                    className="rounded-lg border border-border px-3 py-1.5 text-sm font-semibold hover:bg-surface-hover"
                  >
                    {t("Edit")}
                  </button>
                  {confirmDelete === s.id ? (
                    <button
                      type="button"
                      onClick={() => void remove(s.id)}
                      className="rounded-lg bg-error px-3 py-1.5 text-sm font-semibold text-white"
                    >
                      {t("Confirm delete")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(s.id)}
                      title={t("Deleting a segment never deletes contacts.")}
                      className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted hover:text-error"
                    >
                      {t("Delete")}
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
