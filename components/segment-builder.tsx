"use client";

/**
 * Segment builder (Etapa 5, 2026-10-08): combinable filters over the CRM and
 * the live count. Used by /segments and by the broadcast editor.
 *
 * The count always shows Instagram's rule next to the total: only people who
 * wrote to the account in the last 24 hours can get a broadcast, so the screen
 * says "X contacts in the segment, Y with the conversation open now (only
 * those receive)".
 */

import { useEffect, useMemo, useState } from "react";
import { TagChip } from "@/components/contact-ui";
import { useT } from "@/components/lang-provider";
import { flowApi, type ApiResult } from "@/components/flows/flow-shared";
import { EMPTY_FILTERS, SEGMENT_SOURCES, type SegmentFilters, type SegmentSource } from "@/lib/segments/schema";

export type SegmentCount = {
  total: number;
  windowOpen: number;
  optedOut: number;
  takeover: number;
  busy: number;
  eligible: number;
};

export type CampaignOption = { id: string; name: string; instagramAccountId: string };
export type TagOption = { name: string; count: number };

export const OPT_OUT_TAG = "saiu:disparos";

const SOURCE_LABEL: Record<SegmentSource, string> = {
  comment: "Comment",
  dm: "DM",
  story: "Story",
  link: "Link",
};

/** Error of the Etapa 5 routes -> sentence for the owner. */
export function apiErrorText(t: (k: string, v?: Record<string, string | number>) => string, r: ApiResult<unknown>): string {
  if (r.success) return "";
  switch (r.details?.code) {
    case "human_only":
      return t("Only a signed-in person can do this, in the Lead Engine. An API key only creates drafts.");
    case "not_draft":
      return t("This broadcast already left the draft stage.");
    case "channel_off":
      return t("The Instagram channel is off. Turn it on in Channels first.");
    case "flow_off":
      return t("A button points to a flow that is not published and on.");
    case "flow_not_found":
      return t("The flow of a button was not found on this account.");
    case "too_far":
      return t("Schedule at most 30 days ahead.");
    case "segment_account":
      return t("The segment belongs to another account.");
    case "no_account":
      return t("Connect an Instagram account first.");
    case "changed":
      return t("The draft changed since you opened it. Reload and read it again before sending.");
    case "finished":
      return t("This broadcast already finished.");
    case "weights":
    case "variants":
      return t("The split must add up to 100%, with 2 or 3 variants.");
    case "no_change":
      return t("At least one variant must change a text.");
    case "no_variant":
      return t("That variant does not exist.");
  }
  if (r.error === "network") return t("No connection. Try again.");
  if (r.error === "Only owners and admins can change this") return t("Only owners and admins can change this.");
  return t("Something went wrong: {error}", { error: r.error ?? "?" });
}

const DAY_CHOICES = [1, 3, 7, 14, 30, 60, 90];

/** True when the filters are the empty "everyone" filter. */
export function isEmptyFilters(f: SegmentFilters): boolean {
  return JSON.stringify({ ...EMPTY_FILTERS, ...f }) === JSON.stringify(EMPTY_FILTERS);
}

/** Short description of the filters in the current language. */
export function useDescribeFilters() {
  const t = useT();
  return (f: SegmentFilters, campaigns: CampaignOption[] = []): string[] => {
    const names = (ids: string[]) => ids.map((id) => campaigns.find((c) => c.id === id)?.name ?? t("(deleted)")).join(", ");
    const out: string[] = [];
    if (f.hasTags.length) out.push(t("has all: {tags}", { tags: f.hasTags.join(", ") }));
    if (f.anyTags.length) out.push(t("has any: {tags}", { tags: f.anyTags.join(", ") }));
    if (f.notTags.length) out.push(t("does not have: {tags}", { tags: f.notTags.join(", ") }));
    if (f.commentedCampaignIds.length) out.push(t("commented on: {names}", { names: names(f.commentedCampaignIds) }));
    if (f.receivedCampaignIds.length) out.push(t("got the DM of: {names}", { names: names(f.receivedCampaignIds) }));
    if (f.clicked === "yes") out.push(t("clicked a link"));
    if (f.clicked === "none") out.push(t("never clicked"));
    if (f.clickedCampaignIds.length) out.push(t("clicked the link of: {names}", { names: names(f.clickedCampaignIds) }));
    if (f.follows === "yes") out.push(t("follows you"));
    if (f.follows === "no") out.push(t("does not follow you"));
    if (f.follows === "unknown") out.push(t("follow not checked yet"));
    if (f.lastInteractionDays) out.push(t("interacted in the last {n} days", { n: f.lastInteractionDays }));
    if (f.sources.length) out.push(t("came from: {list}", { list: f.sources.map((s) => t(SOURCE_LABEL[s])).join(", ") }));
    return out.length ? out : [t("All contacts")];
  };
}

/** Live count of the filters (debounced). null while loading the first time. */
export function useLiveCount(filters: SegmentFilters, accountId: string, skipBusy = true) {
  const [count, setCount] = useState<SegmentCount | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const key = JSON.stringify({ filters, accountId, skipBusy });
  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      const body = JSON.parse(key) as { filters: SegmentFilters; accountId: string; skipBusy: boolean };
      void flowApi<SegmentCount>("/api/segments/count", {
        method: "POST",
        json: {
          filters: body.filters,
          instagramAccountId: body.accountId && body.accountId !== "all" ? body.accountId : null,
          skipBusy: body.skipBusy,
        },
      }).then((r) => {
        if (!alive) return;
        setLoading(false);
        if (r.success) {
          setCount(r.data);
          setError(false);
        } else {
          setError(true);
        }
      });
    }, 350);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [key]);
  return { count, loading, error };
}

/** "X contacts in the segment, Y with the conversation open now (only those receive)". */
export function AudienceCount({
  count,
  loading = false,
  error = false,
  title,
  compact = false,
}: {
  count: SegmentCount | null;
  loading?: boolean;
  error?: boolean;
  title?: string;
  compact?: boolean;
}) {
  const t = useT();
  if (error && !count) {
    return <p className="rounded-xl bg-error/10 px-4 py-2.5 text-sm text-error">{t("Could not count the contacts. Try again.")}</p>;
  }
  const c = count ?? { total: 0, windowOpen: 0, optedOut: 0, takeover: 0, busy: 0, eligible: 0 };
  const pct = c.total > 0 ? Math.round((c.eligible / c.total) * 100) : 0;
  return (
    <div className={`panel space-y-3 rounded-2xl p-4 ${loading ? "opacity-70" : ""}`} aria-live="polite">
      {title && <p className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</p>}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-2xl font-semibold tabular-nums">{count ? c.total : "…"}</p>
          <p className="text-xs text-muted">{t("contacts in the segment")}</p>
        </div>
        <div>
          <p className="text-2xl font-semibold tabular-nums text-[#3a8a12]">{count ? c.eligible : "…"}</p>
          <p className="text-xs text-muted">{t("with the conversation open now")}</p>
        </div>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-hover" aria-hidden>
        <div className="h-full rounded-full bg-success transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-sm">
        <span className="font-semibold">
          {t("{total} contacts in the segment, {eligible} with the conversation open now (only those receive).", {
            total: c.total,
            eligible: c.eligible,
          })}
        </span>
      </p>
      {!compact && (
        <>
          <p className="text-xs text-muted">
            {t("Instagram only allows a promotional message to people who wrote to your account in the last 24 hours. Everyone else in the segment is left out, and nobody is sent with a special tag to get around it.")}
          </p>
          {(c.optedOut > 0 || c.takeover > 0 || c.busy > 0) && (
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
              {c.optedOut > 0 && <li>{t("{n} opted out (PARAR / SAIR)", { n: c.optedOut })}</li>}
              {c.takeover > 0 && <li>{t("{n} in a conversation you took over", { n: c.takeover })}</li>}
              {c.busy > 0 && <li>{t("{n} in the middle of a flow or sequence", { n: c.busy })}</li>}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/** Tags, campaigns and accounts the filters pick from. */
export function useSegmentOptions(accountId: string) {
  const [tags, setTags] = useState<TagOption[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
  useEffect(() => {
    const qs = accountId && accountId !== "all" ? `?instagramAccountId=${encodeURIComponent(accountId)}` : "";
    let alive = true;
    void flowApi<TagOption[]>(`/api/contacts/tags${qs}`).then((r) => {
      if (alive && r.success) setTags(Array.isArray(r.data) ? r.data : []);
    });
    void flowApi<CampaignOption[]>(`/api/automations${qs}`).then((r) => {
      if (alive && r.success && Array.isArray(r.data)) {
        setCampaigns(r.data.map((c) => ({ id: c.id, name: c.name, instagramAccountId: c.instagramAccountId })));
      }
    });
    return () => {
      alive = false;
    };
  }, [accountId]);
  return { tags, campaigns };
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <div>
        <p className="text-sm font-semibold">{label}</p>
        {hint && <p className="text-xs text-muted">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-xl bg-surface-hover p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
            o.value === value ? "bg-background font-semibold shadow-sm" : "text-muted hover:text-foreground"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function TagPicker({
  value,
  onChange,
  tags,
  label,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  tags: TagOption[];
  label: string;
}) {
  const t = useT();
  const [draft, setDraft] = useState("");
  const listId = useMemo(() => `tags-${label.replace(/\W+/g, "-")}`, [label]);
  const add = (raw: string) => {
    const name = raw.trim().slice(0, 60);
    if (!name || value.includes(name) || value.length >= 20) return;
    onChange([...value, name]);
    setDraft("");
  };
  const suggestions = tags.filter((x) => !value.includes(x.name)).slice(0, 8);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {value.map((name) => (
          <TagChip key={name} name={name} onRemove={() => onChange(value.filter((x) => x !== name))} removeLabel={t("Remove {name}", { name })} />
        ))}
        <input
          value={draft}
          list={listId}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add(draft);
            }
          }}
          onBlur={() => draft.trim() && add(draft)}
          placeholder={value.length ? t("+ tag") : t("Type or pick a tag")}
          aria-label={label}
          className="min-w-32 flex-1 rounded-lg border border-border bg-surface px-2.5 py-1 text-sm outline-none focus:border-border-hover"
        />
        <datalist id={listId}>
          {tags.map((x) => (
            <option key={x.name} value={x.name} />
          ))}
        </datalist>
      </div>
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((x) => (
            <TagChip key={x.name} name={`+ ${x.name}`} count={x.count} onClick={() => add(x.name)} />
          ))}
        </div>
      )}
    </div>
  );
}

function CampaignPicker({
  value,
  onChange,
  campaigns,
  label,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  campaigns: CampaignOption[];
  label: string;
}) {
  const t = useT();
  const left = campaigns.filter((c) => !value.includes(c.id));
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map((id) => (
        <TagChip
          key={id}
          name={campaigns.find((c) => c.id === id)?.name ?? t("(deleted)")}
          onRemove={() => onChange(value.filter((x) => x !== id))}
          removeLabel={t("Remove")}
        />
      ))}
      {left.length > 0 && value.length < 20 && (
        <select
          value=""
          aria-label={label}
          onChange={(e) => e.target.value && onChange([...value, e.target.value])}
          className="max-w-full rounded-lg border border-border bg-surface px-2.5 py-1 text-sm outline-none"
        >
          <option value="">{value.length ? t("+ another campaign") : t("Pick a campaign")}</option>
          {left.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
      {campaigns.length === 0 && <span className="text-xs text-muted">{t("No campaigns yet")}</span>}
    </div>
  );
}

/** The filter form. Every filter is optional; together they all must match (AND). */
export function SegmentFiltersEditor({
  filters,
  onChange,
  tags,
  campaigns,
}: {
  filters: SegmentFilters;
  onChange: (next: SegmentFilters) => void;
  tags: TagOption[];
  campaigns: CampaignOption[];
}) {
  const t = useT();
  const set = <K extends keyof SegmentFilters>(k: K, v: SegmentFilters[K]) => onChange({ ...filters, [k]: v });
  const customDays = filters.lastInteractionDays !== null && !DAY_CHOICES.includes(filters.lastInteractionDays);

  return (
    <div className="panel space-y-4 rounded-2xl p-4">
      <p className="text-xs text-muted">{t("Every filter you set must match. Leave one empty to ignore it.")}</p>

      <Row label={t("Has all of these tags")}>
        <TagPicker value={filters.hasTags} onChange={(v) => set("hasTags", v)} tags={tags} label={t("Has all of these tags")} />
      </Row>
      <Row label={t("Has at least one of these tags")}>
        <TagPicker value={filters.anyTags} onChange={(v) => set("anyTags", v)} tags={tags} label={t("Has at least one of these tags")} />
      </Row>
      <Row label={t("Does not have these tags")} hint={t("Tip: people who opted out get the tag {tag} and never receive broadcasts anyway.", { tag: OPT_OUT_TAG })}>
        <TagPicker value={filters.notTags} onChange={(v) => set("notTags", v)} tags={tags} label={t("Does not have these tags")} />
      </Row>

      <Row label={t("Commented on the campaign")}>
        <CampaignPicker value={filters.commentedCampaignIds} onChange={(v) => set("commentedCampaignIds", v)} campaigns={campaigns} label={t("Commented on the campaign")} />
      </Row>
      <Row label={t("Got the DM of the campaign")}>
        <CampaignPicker value={filters.receivedCampaignIds} onChange={(v) => set("receivedCampaignIds", v)} campaigns={campaigns} label={t("Got the DM of the campaign")} />
      </Row>

      <Row label={t("Clicked a link")}>
        <Segmented
          label={t("Clicked a link")}
          value={filters.clicked}
          onChange={(v) => set("clicked", v)}
          options={[
            { value: "any", label: t("Doesn't matter") },
            { value: "yes", label: t("Clicked") },
            { value: "none", label: t("Never clicked") },
          ]}
        />
        <div className="pt-1">
          <p className="pb-1.5 text-xs text-muted">{t("Clicked the link of the campaign")}</p>
          <CampaignPicker value={filters.clickedCampaignIds} onChange={(v) => set("clickedCampaignIds", v)} campaigns={campaigns} label={t("Clicked the link of the campaign")} />
        </div>
      </Row>

      <Row label={t("Follows your account")} hint={t("Known only for people who went through a “follow first” step.")}>
        <Segmented
          label={t("Follows your account")}
          value={filters.follows}
          onChange={(v) => set("follows", v)}
          options={[
            { value: "any", label: t("Doesn't matter") },
            { value: "yes", label: t("Follows") },
            { value: "no", label: t("Doesn't follow") },
            { value: "unknown", label: t("Unknown") },
          ]}
        />
      </Row>

      <Row label={t("Last interaction")} hint={t("Comment, DM, button tap or link click.")}>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={filters.lastInteractionDays === null ? "" : customDays ? "custom" : String(filters.lastInteractionDays)}
            onChange={(e) => {
              const v = e.target.value;
              set("lastInteractionDays", v === "" ? null : v === "custom" ? 45 : Number(v));
            }}
            aria-label={t("Last interaction")}
            className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm outline-none"
          >
            <option value="">{t("Any time")}</option>
            {DAY_CHOICES.map((d) => (
              <option key={d} value={d}>
                {d === 1 ? t("In the last day") : t("In the last {n} days", { n: d })}
              </option>
            ))}
            <option value="custom">{t("Other…")}</option>
          </select>
          {customDays && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="number"
                min={1}
                max={365}
                value={filters.lastInteractionDays ?? ""}
                onChange={(e) => set("lastInteractionDays", Math.max(1, Math.min(365, Math.round(Number(e.target.value) || 1))))}
                className="w-20 rounded-lg border border-border bg-surface px-2 py-1 text-sm outline-none"
              />
              {t("days")}
            </label>
          )}
        </div>
      </Row>

      <Row label={t("Came from")}>
        <div className="flex flex-wrap gap-1.5">
          {SEGMENT_SOURCES.map((s) => (
            <TagChip
              key={s}
              name={t(SOURCE_LABEL[s])}
              active={filters.sources.includes(s)}
              onClick={() => set("sources", filters.sources.includes(s) ? filters.sources.filter((x) => x !== s) : [...filters.sources, s])}
            />
          ))}
        </div>
      </Row>

      {!isEmptyFilters(filters) && (
        <button type="button" onClick={() => onChange(EMPTY_FILTERS)} className="text-xs font-semibold text-muted hover:text-foreground">
          {t("Clear all filters")}
        </button>
      )}
    </div>
  );
}
