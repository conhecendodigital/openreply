"use client";

/**
 * Moderation (2026-10-03)
 *
 * Keeps spam, scams, suspicious links and (optionally) politics off the posts.
 * Mode: Off / Observe only (default, just records what it would hide) / Hide.
 * Built-in categories with on/off, the owner's blocked and allowed words, an
 * optional Jev check (only when TYPESAFE_API_KEY exists), a dry-run box and
 * the list of recent decisions with Restore (unhide) and Hide.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AccountSelect, { type AccountOption } from "@/components/account-select";
import { Switch, useDateTime, useTimeAgo } from "@/components/contact-ui";
import { useT } from "@/components/lang-provider";

type Mode = "OFF" | "OBSERVE" | "HIDE";

interface Settings {
  mode: Mode;
  categories: string[];
  blockedTerms: string[];
  allowedTerms: string[];
  useJev: boolean;
  jevMinConfidence: number;
  maxHidesPerHour?: number;
  jevAvailable: boolean;
  availableCategories: string[];
  limits: { maxTerms: number; maxTermLength: number };
  account: { id: string; username: string };
}

interface LogRow {
  id: string;
  commentId: string;
  commenterIgId: string;
  commenterUsername: string | null;
  commentText: string;
  verdict: string;
  reason: string | null;
  matchedRule: string | null;
  action: string;
  protectedReason: string | null;
  mode: Mode;
  error: string | null;
  createdAt: string;
  instagramAccount: { username: string };
}

interface TestResult {
  verdict: string;
  reason: string | null;
  flagged: boolean;
  allowedTerm: string | null;
  wouldDo: "nothing" | "protected" | "hide" | "record";
}

const MODES: { value: Mode; label: string; help: string }[] = [
  { value: "OFF", label: "Off", help: "Nothing is checked or recorded." },
  {
    value: "OBSERVE",
    label: "Observe only",
    help: "Checks every new comment and records what it would hide, but hides nothing. Good to test the rules first.",
  },
  {
    value: "HIDE",
    label: "Hide",
    help: "Hides the comment on Instagram (the person still sees it, others don't). You can restore it any time.",
  },
];

const CATEGORY_INFO: Record<string, { label: string; help: string }> = {
  spam_link: { label: "Spam and links", help: "Links, link shorteners, phone numbers and \"check my profile\"." },
  scam: { label: "Scams and easy money", help: "\"Pix falling in\", \"I recover accounts\", fake investments." },
  politics: { label: "Politics", help: "Parties, candidates and election fights. Off by default." },
  offense: { label: "Offenses", help: "Insults and swearing aimed at people." },
};

const ACTIONS: { value: string; label: string; tone: string }[] = [
  { value: "WOULD_HIDE", label: "Would hide", tone: "text-warning" },
  { value: "HIDDEN", label: "Hidden", tone: "text-error" },
  { value: "RESTORED", label: "Restored", tone: "text-foreground" },
  { value: "SKIPPED_PROTECTED", label: "Protected", tone: "text-success" },
  { value: "FAILED", label: "Failed", tone: "text-error" },
  { value: "NONE", label: "Clean", tone: "text-muted" },
];

const VERDICTS: Record<string, string> = {
  spam_link: "Spam and links",
  scam: "Scams and easy money",
  politics: "Politics",
  offense: "Offenses",
  blocked_term: "Blocked word",
  jev: "Jev",
  ok: "Clean",
};

const PROTECTED: Record<string, string> = {
  own_account: "your own account",
  campaign_keyword: "campaign keyword",
  allowed_term: "allowed word",
};

const WOULD_DO: Record<TestResult["wouldDo"], string> = {
  nothing: "Nothing would happen.",
  protected: "Protected by an allowed word. It would not be hidden.",
  hide: "This comment would be hidden.",
  record: "This comment would be recorded as \"would hide\".",
};

const PAGE_SIZE = 20;

function splitTerms(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function ModerationPage() {
  const t = useT();
  const timeAgo = useTimeAgo();
  const dateTime = useDateTime();

  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [accountId, setAccountId] = useState("");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [blockedText, setBlockedText] = useState("");
  const [allowedText, setAllowedText] = useState("");
  const [termsDirty, setTermsDirty] = useState(false);

  const [testText, setTestText] = useState("");
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);

  const [logs, setLogs] = useState<LogRow[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [logsLoading, setLogsLoading] = useState(true);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  useEffect(() => {
    fetch("/api/instagram/accounts")
      .then((r) => r.json())
      .then((p) => {
        if (!p.success) return;
        const list: AccountOption[] = p.data.instagramAccounts ?? [];
        setAccounts(list);
        setAccountId(p.data.selectedInstagramAccountId || list[0]?.id || "");
      })
      .catch(() => setAccounts([]));
  }, []);

  const applySettings = useCallback((s: Settings) => {
    setSettings(s);
    setBlockedText(s.blockedTerms.join("\n"));
    setAllowedText(s.allowedTerms.join("\n"));
    setTermsDirty(false);
  }, []);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    fetch(`/api/moderation/settings?instagramAccountId=${encodeURIComponent(accountId)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((p) => {
        if (cancelled) return;
        if (p.success) {
          applySettings(p.data);
          setSettingsError(null);
        } else {
          setSettingsError(p.error ?? "Failed to load settings");
        }
      })
      .catch(() => !cancelled && setSettingsError("Failed to load settings"));
    return () => {
      cancelled = true;
    };
  }, [accountId, applySettings]);

  const loadLogs = useCallback(async () => {
    if (!accountId) return;
    const params = new URLSearchParams({
      page: String(page),
      limit: String(PAGE_SIZE),
      instagramAccountId: accountId,
    });
    if (filter) params.set("action", filter);
    try {
      const res = await fetch(`/api/moderation/log?${params}`, { cache: "no-store" });
      const p = await res.json();
      if (p.success) {
        setLogs(p.data.logs);
        setCounts(p.data.counts ?? {});
        setTotalPages(Math.max(1, p.data.pagination.totalPages));
      }
    } finally {
      setLogsLoading(false);
    }
  }, [accountId, filter, page]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadLogs(), 0);
    return () => window.clearTimeout(timer);
  }, [loadLogs]);

  async function save(patch: Partial<Pick<Settings, "mode" | "categories" | "blockedTerms" | "allowedTerms" | "useJev" | "maxHidesPerHour">>) {
    if (!settings) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/moderation/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instagramAccountId: settings.account.id, ...patch }),
      });
      const p = await res.json();
      if (p.success) applySettings(p.data);
      else setSaveError(res.status === 403 ? "Only owners and admins can change this" : p.error ?? "Could not save");
    } catch {
      setSaveError("Could not save");
    } finally {
      setSaving(false);
    }
  }

  function chooseMode(mode: Mode) {
    if (!settings || mode === settings.mode) return;
    if (mode === "HIDE" && !window.confirm(t("Turn on hiding? New comments that match the rules will be hidden on Instagram right away."))) {
      return;
    }
    void save({ mode });
  }

  function toggleCategory(category: string, on: boolean) {
    if (!settings) return;
    const next = on
      ? [...new Set([...settings.categories, category])]
      : settings.categories.filter((c) => c !== category);
    void save({ categories: next });
  }

  async function runTest(e: React.FormEvent) {
    e.preventDefault();
    if (!testText.trim() || testing) return;
    setTesting(true);
    try {
      const res = await fetch("/api/moderation/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: testText, instagramAccountId: accountId || null }),
      });
      const p = await res.json();
      setTestResult(p.success ? p.data : null);
    } finally {
      setTesting(false);
    }
  }

  async function changeHidden(row: LogRow, hidden: boolean) {
    if (hidden && !window.confirm(t("Hide this comment on Instagram?"))) return;
    setRowBusy(row.id);
    setRowError(null);
    try {
      const res = await fetch(`/api/moderation/log/${encodeURIComponent(row.id)}/${hidden ? "hide" : "restore"}`, {
        method: "POST",
      });
      const p = await res.json();
      if (p.success) {
        await loadLogs();
      } else {
        setRowError({
          id: row.id,
          message: res.status === 403 ? "Only owners and admins can change this" : p.error ?? "Could not change the comment",
        });
      }
    } catch {
      setRowError({ id: row.id, message: "Could not change the comment" });
    } finally {
      setRowBusy(null);
    }
  }

  function chooseFilter(next: string) {
    setLogsLoading(true);
    setFilter(next);
    setPage(1);
  }

  const totalCount = Object.values(counts).reduce((a, b) => a + b, 0);
  const modeHelp = MODES.find((m) => m.value === settings?.mode)?.help;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {accounts.length > 1 && (
        <AccountSelect
          accounts={accounts}
          value={accountId}
          includeAll={false}
          onChange={(v) => {
            setLogsLoading(true);
            setAccountId(v);
            setPage(1);
          }}
        />
      )}

      {settingsError && <p className="panel px-4 py-6 text-sm text-error">{t(settingsError)}</p>}

      {settings && (
        <>
          {/* Mode */}
          <section className="panel space-y-4 p-4 sm:p-5">
            <div>
              <h2 className="text-base font-semibold">{t("Comment moderation")}</h2>
              <p className="mt-1 text-sm text-muted">
                {t("Keeps spam, scams and suspicious links off your posts so they don't pull a bad audience to your profile.")}
              </p>
            </div>
            <div role="radiogroup" aria-label={t("Mode")} className="grid grid-cols-3 rounded-lg bg-surface-hover p-1">
              {MODES.map((m) => {
                const active = settings.mode === m.value;
                return (
                  <button
                    key={m.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={saving}
                    onClick={() => chooseMode(m.value)}
                    className={`rounded-md px-2 py-2 text-sm font-semibold transition-colors ${
                      active
                        ? m.value === "HIDE"
                          ? "bg-foreground text-background shadow-sm"
                          : "bg-background text-foreground shadow-sm"
                        : "text-muted hover:text-foreground"
                    }`}
                  >
                    {t(m.label)}
                  </button>
                );
              })}
            </div>
            {modeHelp && <p className="text-sm">{t(modeHelp)}</p>}
            <p className="text-xs text-muted">
              {t("Never hidden: your own comments and comments with a keyword of an active campaign on that post.")}
            </p>
            {saveError && <p className="text-sm text-error">{t(saveError)}</p>}
          </section>

          {/* Categories */}
          <section className="panel overflow-hidden">
            <h3 className="border-b border-border px-4 py-3 text-sm font-semibold sm:px-5">{t("Categories")}</h3>
            <ul className="divide-y divide-border">
              {settings.availableCategories.map((c) => {
                const info = CATEGORY_INFO[c];
                const on = settings.categories.includes(c);
                return (
                  <li key={c} className="flex items-center justify-between gap-4 px-4 py-3 sm:px-5">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{info ? t(info.label) : c}</p>
                      {info && <p className="text-xs text-muted">{t(info.help)}</p>}
                    </div>
                    <Switch
                      checked={on}
                      disabled={saving}
                      label={info ? t(info.label) : c}
                      onChange={(next) => toggleCategory(c, next)}
                    />
                  </li>
                );
              })}
              <li className="flex items-center justify-between gap-4 px-4 py-3 sm:px-5">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{t("Ask Jev when the rules find nothing")}</p>
                  <p className="text-xs text-muted">
                    {settings.jevAvailable
                      ? t("AI check (TypeSafe) for longer comments. Low confidence only records, never hides.")
                      : t("Unavailable: TYPESAFE_API_KEY is not set on the server.")}
                  </p>
                </div>
                <Switch
                  checked={settings.useJev && settings.jevAvailable}
                  disabled={saving || !settings.jevAvailable}
                  label={t("Ask Jev when the rules find nothing")}
                  onChange={(next) => void save({ useJev: next })}
                />
              </li>
              <li className="flex items-center justify-between gap-4 px-4 py-3 sm:px-5">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{t("Hide at most per hour")}</p>
                  <p className="text-xs text-muted">
                    {t("Above this, comments are only recorded as \"would hide\" (rule: cap). Hiding by hand doesn't count.")}
                  </p>
                </div>
                <input
                  key={`${settings.account.id}-${settings.maxHidesPerHour ?? 30}`}
                  type="number"
                  min={1}
                  max={500}
                  defaultValue={settings.maxHidesPerHour ?? 30}
                  disabled={saving}
                  aria-label={t("Hide at most per hour")}
                  onBlur={(e) => {
                    const n = Math.round(Number(e.target.value));
                    if (!Number.isFinite(n) || n < 1 || n > 500 || n === (settings.maxHidesPerHour ?? 30)) {
                      e.target.value = String(settings.maxHidesPerHour ?? 30);
                      return;
                    }
                    void save({ maxHidesPerHour: n });
                  }}
                  className="w-20 shrink-0 rounded-lg border border-border bg-surface-hover px-2 py-1 text-right text-sm outline-none focus:border-border-hover"
                />
              </li>
            </ul>
          </section>

          {/* Words */}
          <section className="panel space-y-4 p-4 sm:p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="text-sm font-semibold">{t("Blocked words")}</span>
                <span className="block text-xs text-muted">{t("One per line. A comment with any of these is flagged.")}</span>
                <textarea
                  value={blockedText}
                  onChange={(e) => {
                    setBlockedText(e.target.value);
                    setTermsDirty(true);
                  }}
                  rows={6}
                  placeholder={t("e.g. follow back\nsee my profile")}
                  className="w-full resize-y rounded-lg border border-border bg-surface-hover px-3 py-2 text-sm outline-none focus:border-border-hover"
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-semibold">{t("Allowed words")}</span>
                <span className="block text-xs text-muted">{t("A comment with any of these is never hidden.")}</span>
                <textarea
                  value={allowedText}
                  onChange={(e) => {
                    setAllowedText(e.target.value);
                    setTermsDirty(true);
                  }}
                  rows={6}
                  placeholder={t("e.g. pix\nprice")}
                  className="w-full resize-y rounded-lg border border-border bg-surface-hover px-3 py-2 text-sm outline-none focus:border-border-hover"
                />
              </label>
            </div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted">
                {t("Up to {n} words, {len} characters each. Accents and capitals don't matter.", {
                  n: settings.limits.maxTerms,
                  len: settings.limits.maxTermLength,
                })}
              </p>
              <button
                type="button"
                disabled={!termsDirty || saving}
                onClick={() =>
                  void save({
                    blockedTerms: splitTerms(blockedText).slice(0, settings.limits.maxTerms),
                    allowedTerms: splitTerms(allowedText).slice(0, settings.limits.maxTerms),
                  })
                }
                className="shrink-0 rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-40"
              >
                {saving ? t("Saving...") : t("Save")}
              </button>
            </div>
          </section>

          {/* Test */}
          <section className="panel space-y-3 p-4 sm:p-5">
            <h3 className="text-sm font-semibold">{t("Test a comment")}</h3>
            <form onSubmit={runTest} className="flex gap-2">
              <input
                value={testText}
                onChange={(e) => {
                  setTestText(e.target.value);
                  setTestResult(null);
                }}
                maxLength={2200}
                placeholder={t("Paste a comment to see what would happen")}
                className="min-w-0 flex-1 rounded-lg border border-border bg-surface-hover px-3 py-1.5 text-sm outline-none focus:border-border-hover"
              />
              <button
                type="submit"
                disabled={!testText.trim() || testing}
                className="rounded-lg border border-border px-4 py-1.5 text-sm font-semibold disabled:opacity-40"
              >
                {testing ? t("Testing...") : t("Test")}
              </button>
            </form>
            {testResult && (
              <p className={`text-sm ${testResult.flagged && testResult.wouldDo !== "protected" ? "text-error" : "text-success"}`}>
                {testResult.flagged
                  ? `${t(VERDICTS[testResult.verdict] ?? testResult.verdict)}${testResult.reason ? ` (${testResult.reason})` : ""}. `
                  : `${t("Looks fine.")} `}
                <span className="text-foreground">{t(WOULD_DO[testResult.wouldDo])}</span>
              </p>
            )}
            <p className="text-xs text-muted">{t("The test never touches Instagram and saves nothing.")}</p>
          </section>
        </>
      )}

      {/* Recent decisions */}
      <section className="panel overflow-hidden">
        <div className="space-y-3 border-b border-border px-4 py-3 sm:px-5">
          <h3 className="text-sm font-semibold">{t("Recent decisions")}</h3>
          <div className="flex flex-wrap gap-2">
            {[{ value: "", label: "All", tone: "" }, ...ACTIONS.filter((a) => a.value !== "NONE")].map((a) => {
              const active = filter === a.value;
              const n = a.value ? counts[a.value] ?? 0 : totalCount;
              return (
                <button
                  key={a.value || "all"}
                  type="button"
                  onClick={() => chooseFilter(a.value)}
                  aria-pressed={active}
                  className={`rounded-full border px-3 py-1 text-xs font-medium ${
                    active ? "border-foreground bg-foreground text-background" : "border-border hover:border-border-hover"
                  }`}
                >
                  {t(a.label)} <span className={active ? "opacity-70" : "text-muted"}>{n}</span>
                </button>
              );
            })}
          </div>
        </div>

        {logsLoading && logs.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">{t("Loading...")}</p>
        ) : logs.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="text-sm font-semibold">{t("No decisions yet")}</p>
            <p className="mt-1 text-sm text-muted">{t("New comments on your posts show up here after they are checked.")}</p>
          </div>
        ) : (
          <ul className={`divide-y divide-border ${logsLoading ? "opacity-60" : ""}`}>
            {logs.map((row) => {
              const action = ACTIONS.find((a) => a.value === row.action);
              const canRestore = row.action === "HIDDEN";
              const canHide = ["WOULD_HIDE", "FAILED", "RESTORED"].includes(row.action);
              return (
                <li key={row.id} className="space-y-2 px-4 py-3 sm:px-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 text-sm">
                      <p className="break-words">
                        <span className="font-semibold">
                          {row.commenterUsername ? `@${row.commenterUsername}` : t("Unknown user")}
                        </span>{" "}
                        {row.commentText}
                      </p>
                      <p className="mt-0.5 text-xs text-muted">
                        {row.verdict !== "ok" && t(VERDICTS[row.verdict] ?? row.verdict)}
                        {row.reason && ` · ${row.reason}`}
                        {row.protectedReason &&
                          ` · ${t("protected: {why}", { why: t(PROTECTED[row.protectedReason] ?? row.protectedReason) })}`}
                      </p>
                      {row.error && <p className="mt-0.5 text-xs text-error">{row.error}</p>}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className={`text-xs font-semibold ${action?.tone ?? "text-muted"}`}>
                        {t(action?.label ?? row.action)}
                      </p>
                      <time className="text-xs text-muted" title={dateTime(row.createdAt)} dateTime={row.createdAt}>
                        {timeAgo(row.createdAt)}
                      </time>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                      {canRestore && (
                        <button
                          type="button"
                          disabled={rowBusy === row.id}
                          onClick={() => void changeHidden(row, false)}
                          className="rounded-lg bg-accent px-3 py-1 text-xs font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
                        >
                          {t("Restore")}
                        </button>
                      )}
                      {canHide && (
                        <button
                          type="button"
                          disabled={rowBusy === row.id}
                          onClick={() => void changeHidden(row, true)}
                          className="rounded-lg border border-border px-3 py-1 text-xs font-semibold hover:bg-surface-hover disabled:opacity-50"
                        >
                          {t("Hide")}
                        </button>
                      )}
                      <Link
                        href={`/contacts?q=${encodeURIComponent(row.commenterUsername ?? row.commenterIgId)}`}
                        className="text-xs font-semibold text-accent"
                      >
                        {t("View contact")}
                      </Link>
                      {rowError?.id === row.id && <span className="text-xs text-error">{t(rowError.message)}</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-border px-4 py-3 sm:px-5">
            <button
              type="button"
              disabled={page <= 1 || logsLoading}
              onClick={() => {
                setLogsLoading(true);
                setPage((p) => Math.max(1, p - 1));
              }}
              className="rounded-lg border border-border px-3 py-1.5 text-sm font-semibold disabled:opacity-40"
            >
              {t("Previous")}
            </button>
            <span className="text-xs text-muted">{t("Page {page} of {total}", { page, total: totalPages })}</span>
            <button
              type="button"
              disabled={page >= totalPages || logsLoading}
              onClick={() => {
                setLogsLoading(true);
                setPage((p) => p + 1);
              }}
              className="rounded-lg border border-border px-3 py-1.5 text-sm font-semibold disabled:opacity-40"
            >
              {t("Next")}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
