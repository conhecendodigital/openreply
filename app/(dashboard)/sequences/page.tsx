"use client";

/**
 * Sequences (2026-10-04, Etapa 2)
 *
 * Follow-up messages tied to a campaign, sent after the campaign delivered its
 * link: each step is a message plus a wait. They only go out inside the
 * person's 24-hour window (Meta's rule: nothing promotional outside it), never
 * while you took over the conversation, and stop as soon as the person replies.
 * A sequence starts off; you turn it on here.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AccountSelect, { type AccountOption } from "@/components/account-select";
import { Switch } from "@/components/contact-ui";
import { useT } from "@/components/lang-provider";

interface CampaignRow {
  id: string;
  name: string;
  isActive: boolean;
  instagramAccountId: string;
  instagramAccount: { username: string };
}

interface Step {
  message: string;
  delayMinutes: number;
}

interface Limits {
  maxSteps: number;
  minDelayMinutes: number;
  maxDelayMinutes: number;
  maxTotalMinutes: number;
  maxMessage: number;
}

interface SequencePayload {
  isActive: boolean;
  steps: Step[];
  stats: Record<string, number> | null;
  limits: Limits;
}

const DEFAULT_LIMITS: Limits = {
  maxSteps: 5,
  minDelayMinutes: 1,
  maxDelayMinutes: 1380,
  maxTotalMinutes: 1380,
  maxMessage: 1000,
};

const STAT_LABELS: Record<string, string> = {
  ACTIVE: "In progress",
  DONE: "Finished",
  STOPPED_REPLY: "Stopped: replied",
  STOPPED_WINDOW: "Stopped: window closed",
  STOPPED_TAKEOVER: "Stopped: you took over",
  STOPPED_OFF: "Stopped: turned off",
};

type Unit = "min" | "h";

function splitDelay(minutes: number): { value: number; unit: Unit } {
  return minutes >= 60 && minutes % 60 === 0 ? { value: minutes / 60, unit: "h" } : { value: minutes, unit: "min" };
}

function formatWait(minutes: number, t: (s: string, v?: Record<string, string | number>) => string) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return t("{h} h {m} min", { h, m });
  if (h) return t("{h} h", { h });
  return t("{m} min", { m });
}

function StepEditor({
  index,
  step,
  limits,
  onChange,
  onRemove,
  onMove,
  canUp,
  canDown,
}: {
  index: number;
  step: Step;
  limits: Limits;
  onChange: (next: Step) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  canUp: boolean;
  canDown: boolean;
}) {
  const t = useT();
  const [unit, setUnit] = useState<Unit>(() => splitDelay(step.delayMinutes).unit);
  const shown = unit === "h" ? step.delayMinutes / 60 : step.delayMinutes;
  const badDelay =
    !Number.isInteger(step.delayMinutes) ||
    step.delayMinutes < limits.minDelayMinutes ||
    step.delayMinutes > limits.maxDelayMinutes;

  return (
    <li className="relative pl-10">
      <span className="absolute left-0 top-0 grid h-7 w-7 place-items-center rounded-full bg-foreground text-xs font-semibold text-background">
        {index + 1}
      </span>
      <div className="panel space-y-3 rounded-2xl p-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">{index === 0 ? t("Wait after the link") : t("Wait after the previous step")}</span>
          <input
            type="number"
            min={unit === "h" ? 1 : limits.minDelayMinutes}
            max={unit === "h" ? Math.floor(limits.maxDelayMinutes / 60) : limits.maxDelayMinutes}
            step={unit === "h" ? 0.5 : 1}
            value={Number.isFinite(shown) ? shown : ""}
            onChange={(e) => {
              const raw = Number(e.target.value);
              onChange({ ...step, delayMinutes: Math.round(unit === "h" ? raw * 60 : raw) });
            }}
            aria-label={t("Wait")}
            className={`w-20 rounded-lg border bg-surface-hover px-2 py-1 text-sm outline-none ${
              badDelay ? "border-error" : "border-border focus:border-border-hover"
            }`}
          />
          <select
            value={unit}
            onChange={(e) => setUnit(e.target.value as Unit)}
            aria-label={t("Unit")}
            className="rounded-lg border border-border bg-surface-hover px-2 py-1 text-sm outline-none"
          >
            <option value="min">{t("minutes")}</option>
            <option value="h">{t("hours")}</option>
          </select>
          <span className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => onMove(-1)}
              disabled={!canUp}
              aria-label={t("Move up")}
              className="rounded px-2 py-1 text-muted hover:text-foreground disabled:opacity-30"
            >
              ↑
            </button>
            <button
              type="button"
              onClick={() => onMove(1)}
              disabled={!canDown}
              aria-label={t("Move down")}
              className="rounded px-2 py-1 text-muted hover:text-foreground disabled:opacity-30"
            >
              ↓
            </button>
            <button
              type="button"
              onClick={onRemove}
              className="rounded px-2 py-1 text-xs font-semibold text-error hover:opacity-80"
            >
              {t("Remove")}
            </button>
          </span>
        </div>
        <textarea
          value={step.message}
          onChange={(e) => onChange({ ...step, message: e.target.value })}
          rows={3}
          maxLength={limits.maxMessage}
          placeholder={t("Message, e.g. Did the link work? Any questions, just reply here.")}
          className="w-full resize-y rounded-xl border border-border bg-surface-hover px-3 py-2 text-sm outline-none focus:border-border-hover"
        />
        <p className="text-right text-[11px] text-muted">
          {step.message.length}/{limits.maxMessage}
        </p>
      </div>
    </li>
  );
}

export default function SequencesPage() {
  const t = useT();
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [accountId, setAccountId] = useState("all");
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [seq, setSeq] = useState<SequencePayload | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [isActive, setIsActive] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [loadingSeq, setLoadingSeq] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("campaign");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read the deep link once
    if (wanted) setSelectedId(wanted);
    fetch("/api/instagram/accounts")
      .then((r) => r.json())
      .then((payload) => {
        if (payload.success) setAccounts(payload.data.instagramAccounts ?? []);
      })
      .catch(() => setAccounts([]));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (accountId !== "all") params.set("instagramAccountId", accountId);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading state for the new filter
    setCampaignsLoading(true);
    fetch(`/api/automations${params.size ? `?${params}` : ""}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((payload) => {
        if (payload.success) setCampaigns(payload.data as CampaignRow[]);
      })
      .catch(() => setCampaigns([]))
      .finally(() => setCampaignsLoading(false));
  }, [accountId]);

  const loadSequence = useCallback(async (id: string) => {
    setLoadingSeq(true);
    setErrors([]);
    try {
      const res = await fetch(`/api/automations/${encodeURIComponent(id)}/sequence`, { cache: "no-store" });
      const payload = await res.json();
      if (payload.success) {
        const data = payload.data as SequencePayload;
        setSeq(data);
        setSteps(data.steps.map((s) => ({ message: s.message, delayMinutes: s.delayMinutes })));
        setIsActive(data.isActive);
        setDirty(false);
      } else {
        setSeq(null);
        setErrors([payload.error ?? "Failed to load the sequence"]);
      }
    } catch {
      setErrors(["Failed to load the sequence"]);
    } finally {
      setLoadingSeq(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    const timer = window.setTimeout(() => void loadSequence(selectedId), 0);
    return () => window.clearTimeout(timer);
  }, [selectedId, loadSequence]);

  const limits = seq?.limits ?? DEFAULT_LIMITS;
  const totalMinutes = useMemo(() => steps.reduce((sum, s) => sum + (Number(s.delayMinutes) || 0), 0), [steps]);
  const overTotal = totalMinutes >= limits.maxTotalMinutes;
  const selected = campaigns.find((c) => c.id === selectedId) ?? null;

  function update(next: Step[]) {
    setSteps(next);
    setDirty(true);
    setSaved(false);
  }

  async function save(nextActive = isActive) {
    if (!selectedId || saving) return;
    setSaving(true);
    setErrors([]);
    try {
      const res = await fetch(`/api/automations/${encodeURIComponent(selectedId)}/sequence`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ steps: steps.map((s) => ({ message: s.message, delayMinutes: s.delayMinutes })), isActive: nextActive }),
      });
      const payload = await res.json();
      if (payload.success) {
        const data = payload.data as SequencePayload;
        setSeq(data);
        setSteps(data.steps);
        setIsActive(data.isActive);
        setDirty(false);
        setSaved(true);
      } else {
        // The switch flipped optimistically: put it back.
        setIsActive(seq?.isActive ?? false);
        const details = Array.isArray(payload.details) ? payload.details : [];
        setErrors(
          details.length
            ? details.map((d: unknown) => (typeof d === "string" ? d : ((d as { message?: string }).message ?? String(d))))
            : [payload.error ?? "Could not save"]
        );
      }
    } catch {
      setIsActive(seq?.isActive ?? false);
      setErrors(["Could not save"]);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold">{t("Sequences")}</h2>
          <p className="text-sm text-muted">{t("Follow-up messages after a campaign delivers its link.")}</p>
        </div>
        {accounts.length > 1 && <AccountSelect accounts={accounts} value={accountId} onChange={setAccountId} />}
      </div>

      {/* The 24-hour rule, in plain words */}
      <section className="panel space-y-2 rounded-2xl p-4 text-sm">
        <h3 className="font-semibold">{t("How the 24-hour rule works")}</h3>
        <ul className="list-disc space-y-1 pl-5 text-muted">
          <li>{t("Instagram only lets you message someone within 24 hours of their last message. Outside that, nothing goes out.")}</li>
          <li>{t("Each step only goes out if the window is still open, and the whole sequence must fit in under 23 hours.")}</li>
          <li>{t("It stops as soon as the person replies, when the window closes, or when you take over the conversation.")}</li>
          <li>{t("If the link went as a private reply to a comment, the sequence waits for the person's first reply, which is what opens the window.")}</li>
        </ul>
      </section>

      <div className="grid gap-6 md:grid-cols-[260px_1fr]">
        {/* Campaign picker */}
        <aside className="panel h-fit overflow-hidden rounded-2xl">
          <p className="border-b border-border px-4 py-3 text-sm font-semibold">{t("Campaigns")}</p>
          {campaignsLoading ? (
            <p className="px-4 py-6 text-sm text-muted">{t("Loading…")}</p>
          ) : campaigns.length === 0 ? (
            <div className="space-y-2 px-4 py-6 text-sm text-muted">
              <p>{t("No campaigns yet.")}</p>
              <Link href="/campaigns/new" className="font-semibold text-accent">
                {t("New campaign")}
              </Link>
            </div>
          ) : (
            <ul className="max-h-[60dvh] overflow-y-auto">
              {campaigns.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (dirty && !window.confirm(t("Discard the changes you didn't save?"))) return;
                      setSelectedId(c.id);
                      setSaved(false);
                    }}
                    aria-current={c.id === selectedId ? "true" : undefined}
                    className={`block w-full border-b border-border px-4 py-3 text-left last:border-b-0 ${
                      c.id === selectedId ? "bg-surface-hover" : "hover:bg-surface-hover"
                    }`}
                  >
                    <span className="block truncate text-sm font-medium">{c.name}</span>
                    <span className="text-xs text-muted">
                      @{c.instagramAccount.username} · {c.isActive ? t("Campaign on") : t("Campaign off")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        {/* Editor */}
        <section className="min-w-0 space-y-4">
          {!selectedId ? (
            <p className="panel rounded-2xl px-4 py-12 text-center text-sm text-muted">
              {t("Pick a campaign to create or edit its sequence.")}
            </p>
          ) : loadingSeq && !seq ? (
            <div className="panel h-48 animate-pulse rounded-2xl" />
          ) : (
            <>
              <div className="panel flex flex-wrap items-center gap-3 rounded-2xl p-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{selected?.name ?? t("Campaign")}</p>
                  <p className="text-xs text-muted">
                    {steps.length === 0
                      ? t("No steps yet")
                      : t("{n} step(s) · {total} in total", { n: steps.length, total: formatWait(totalMinutes, t) })}
                  </p>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span className={isActive ? "font-semibold" : "text-muted"}>{isActive ? t("On") : t("Off")}</span>
                  <Switch
                    checked={isActive}
                    disabled={saving || steps.length === 0}
                    label={t("Turn the sequence on or off")}
                    onChange={(next) => {
                      setIsActive(next);
                      void save(next);
                    }}
                  />
                </div>
              </div>
              {selected && !selected.isActive && isActive && (
                <p className="rounded-xl bg-warning/10 px-4 py-2 text-xs">
                  {t("The campaign itself is off, so nobody new enters the sequence until you turn it on.")}
                </p>
              )}

              {seq?.stats && Object.keys(seq.stats).length > 0 && (
                <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
                  {Object.entries(seq.stats).map(([k, v]) => (
                    <li key={k}>
                      <span className="font-semibold">{v.toLocaleString()}</span> {t(STAT_LABELS[k] ?? k)}
                    </li>
                  ))}
                </ul>
              )}

              {steps.length > 0 && (
                <ol className="space-y-3">
                  {steps.map((s, i) => (
                    <StepEditor
                      key={`${selectedId}-${i}`}
                      index={i}
                      step={s}
                      limits={limits}
                      canUp={i > 0}
                      canDown={i < steps.length - 1}
                      onChange={(next) => update(steps.map((x, j) => (j === i ? next : x)))}
                      onRemove={() => update(steps.filter((_, j) => j !== i))}
                      onMove={(dir) => {
                        const next = [...steps];
                        const [item] = next.splice(i, 1);
                        next.splice(i + dir, 0, item);
                        update(next);
                      }}
                    />
                  ))}
                </ol>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => update([...steps, { message: "", delayMinutes: steps.length === 0 ? 30 : 120 }])}
                  disabled={steps.length >= limits.maxSteps}
                  className="rounded-lg bg-surface-hover px-4 py-1.5 text-sm font-semibold hover:bg-border disabled:opacity-40"
                >
                  {t("Add step")}
                </button>
                <span className="text-xs text-muted">
                  {t("Up to {n} steps, under 23 h in total.", { n: limits.maxSteps })}
                </span>
                <span className="ml-auto flex items-center gap-3">
                  {saved && !dirty && <span className="text-xs text-success">{t("Saved")}</span>}
                  <button
                    type="button"
                    onClick={() => void save()}
                    disabled={!dirty || saving || overTotal}
                    className="rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-40"
                  >
                    {saving ? t("Saving…") : t("Save")}
                  </button>
                </span>
              </div>

              {overTotal && (
                <p className="text-xs text-error">
                  {t("Total wait must stay under 23 hours (Instagram's 24-hour window)")}
                </p>
              )}
              {errors.length > 0 && (
                <ul className="space-y-0.5 text-xs text-error">
                  {errors.map((e) => (
                    <li key={e}>{t(e)}</li>
                  ))}
                </ul>
              )}
              {!isActive && steps.length > 0 && !dirty && (
                <p className="text-xs text-muted">{t("Sequences start off. Turn it on when the messages are ready.")}</p>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
