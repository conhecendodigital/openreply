"use client";

/**
 * Flows (Etapa 3): ManyChat-style flows, a new and optional layer next to the
 * campaigns. Each flow shows its status, what starts it and how many people
 * entered and finished. Flows are born off; turning one on asks first.
 * Campaigns keep running as they are: when both match the same event, the
 * active campaign answers and the flow does not.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AccountSelect, { type AccountOption } from "@/components/account-select";
import { Switch, useTimeAgo } from "@/components/contact-ui";
import { useT } from "@/components/lang-provider";
import { ActivateFlowDialog, FlowStatusChip, flowApi, flowErrorText, type FlowSummary } from "@/components/flows/flow-shared";
import { TRIGGER_TYPE_LABEL } from "@/components/flows/flow-labels";
import type { FlowTriggerType } from "@/lib/flows/schema";

export default function FlowsPage() {
  const t = useT();
  const timeAgo = useTimeAgo();
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [accountId, setAccountId] = useState("all");
  const [flows, setFlows] = useState<FlowSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activating, setActivating] = useState<FlowSummary | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    void flowApi<{ instagramAccounts: AccountOption[] }>("/api/instagram/accounts").then((r) => {
      if (r.success) setAccounts(r.data.instagramAccounts ?? []);
    });
  }, []);

  const load = useCallback(async () => {
    const r = await flowApi<FlowSummary[]>(`/api/flows?instagramAccountId=${encodeURIComponent(accountId)}`);
    if (r.success) {
      setFlows(r.data);
      setError(null);
    } else {
      setFlows([]);
      setError(flowErrorText(t, r));
    }
  }, [accountId, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function turnOff(flow: FlowSummary) {
    setBusyId(flow.id);
    const r = await flowApi<FlowSummary>(`/api/flows/${encodeURIComponent(flow.id)}/active`, { method: "POST", json: { isActive: false } });
    setBusyId(null);
    if (r.success) setFlows((list) => list?.map((f) => (f.id === flow.id ? { ...f, isActive: false } : f)) ?? list);
    else setError(flowErrorText(t, r));
  }

  const triggerText = (f: FlowSummary) => {
    if (!f.trigger) return t("No trigger yet");
    const base = t(TRIGGER_TYPE_LABEL[f.trigger.type as FlowTriggerType] ?? f.trigger.label);
    const words = f.trigger.keywords.filter(Boolean);
    return words.length ? `${base} · ${words.join(", ")}` : base;
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold">{t("Flows")}</h2>
          <p className="max-w-2xl text-sm text-muted">
            {t("Build a conversation step by step: messages with buttons, conditions, tags and waits. Your campaigns keep working as they are; when a campaign and a flow match the same event, the campaign answers.")}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {accounts.length > 1 && <AccountSelect accounts={accounts} value={accountId} onChange={setAccountId} />}
          <Link href="/flows/new" className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover">
            {t("New flow")}
          </Link>
        </div>
      </div>

      {error && <p className="rounded-xl bg-error/10 px-4 py-2.5 text-sm text-error">{error}</p>}

      {flows === null ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="panel h-20 animate-pulse rounded-2xl" />
          ))}
        </div>
      ) : flows.length === 0 ? (
        <div className="panel space-y-3 rounded-2xl p-8 text-center">
          <p className="text-sm font-semibold">{t("No flows yet")}</p>
          <p className="mx-auto max-w-md text-sm text-muted">
            {t("Start from scratch, or open a campaign and tap “Open as flow” to copy it into a new flow (the campaign stays on).")}
          </p>
          <div className="flex justify-center gap-2">
            <Link href="/flows/new" className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover">
              {t("New flow")}
            </Link>
            <Link href="/campaigns" className="rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-surface-hover">
              {t("Campaigns")}
            </Link>
          </div>
        </div>
      ) : (
        <ul className="space-y-2">
          {flows.map((f) => (
            <li key={f.id} className="panel flex flex-col gap-3 rounded-2xl p-4 sm:flex-row sm:items-center">
              <Link href={`/flows/${f.id}`} className="min-w-0 flex-1 space-y-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-semibold">{f.name}</span>
                  <FlowStatusChip isActive={f.isActive} published={f.published} unpublished={f.published && f.hasUnpublishedChanges} />
                </span>
                <span className="block truncate text-xs text-muted">{triggerText(f)}</span>
                <span className="block text-xs text-muted">
                  {f.account ? `@${f.account.username} · ` : ""}
                  {t("{n} steps", { n: f.nodeCount })} · {t("edited {when}", { when: timeAgo(f.updatedAt) })}
                  {f.sourceAutomationId ? ` · ${t("from a campaign")}` : ""}
                </span>
              </Link>
              <div className="flex items-center gap-4">
                <div className="grid grid-cols-3 gap-3 text-center">
                  <Count label={t("Entered")} value={f.stats.entered} />
                  <Count label={t("Completed")} value={f.stats.completed} />
                  <Count label={t("Inside")} value={f.stats.open} />
                </div>
                <span title={!f.published && !f.isActive ? t("Publish the flow before turning it on.") : undefined}>
                  <Switch
                    checked={f.isActive}
                    disabled={busyId === f.id || (!f.isActive && !f.published)}
                    label={f.isActive ? t("Turn off") : t("Turn on")}
                    onChange={(next) => (next ? setActivating(f) : void turnOff(f))}
                  />
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {activating && (
        <ActivateFlowDialog
          flowId={activating.id}
          flowName={activating.name}
          onClose={() => setActivating(null)}
          onDone={(summary) => {
            setActivating(null);
            setFlows((list) => list?.map((f) => (f.id === summary.id ? { ...f, isActive: summary.isActive } : f)) ?? list);
          }}
        />
      )}
    </div>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-12">
      <p className="text-base font-semibold">{value}</p>
      <p className="text-[11px] text-muted">{label}</p>
    </div>
  );
}
