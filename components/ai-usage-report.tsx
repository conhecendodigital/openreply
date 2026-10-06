"use client";

/**
 * Gastos de IA (06/10/2026). O mesmo painel em dois lugares:
 * - /admin (scope "admin"): todo mundo, com ranking, filtro por usuário e
 *   workspace e alerta de quem passou de 80% do teto do dia;
 * - Configurações (scope "me"): só o gasto da própria pessoa.
 * Valores em US$, com R$ ao lado quando o admin cadastrou a cotação.
 */
import { useEffect, useMemo, useState } from "react";
import { useT } from "@/components/lang-provider";

type Row = { key: string; label: string | null; costMicroUsd: number; calls: number; tokensIn: number; tokensOut: number };
type CapUse = { id: string; label: string | null; spentMicroUsd: number; capUsd: number; ratio: number };
type Report = {
  period: string;
  from: string;
  to: string;
  totals: {
    costMicroUsd: number;
    calls: number;
    blockedCalls: number;
    tokensIn: number;
    tokensOut: number;
    cacheRead: number;
    cacheWrite: number;
    conversations: number;
    responses: number;
    avgPerConversationMicroUsd: number | null;
    avgPerResponseMicroUsd: number | null;
  };
  byDay: { day: string; costMicroUsd: number; calls: number }[];
  byUser: Row[];
  byWorkspace: Row[];
  byModel: (Row & { provider: string; model: string })[];
  byAgent: Row[];
  today: { users: CapUse[]; workspaces: CapUse[] };
  alerts: (CapUse & { kind: "user" | "workspace" })[];
  caps: { dailyCapUserUsd: number; dailyCapWorkspaceUsd: number };
  usdToBrl: number | null;
};

const INPUT = "h-9 rounded-md border border-border bg-[#fafafa] px-2 text-sm focus:border-accent focus:bg-white";
const PERIODS = ["today", "7d", "30d", "month", "custom"] as const;

function usd(micro: number): string {
  const v = micro / 1_000_000;
  return `US$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: v > 0 && v < 0.01 ? 6 : 2 })}`;
}

function brl(micro: number, rate: number | null): string | null {
  if (!rate) return null;
  const v = (micro / 1_000_000) * rate;
  return `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: v > 0 && v < 0.01 ? 4 : 2 })}`;
}

function num(n: number): string {
  return n.toLocaleString("pt-BR");
}

function pct(ratio: number): string {
  return Number.isFinite(ratio) ? `${Math.round(ratio * 100)}%` : "100%+";
}

async function fetchReport(url: string): Promise<{ ok: true; report: Report } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    const payload = await res.json().catch(() => null);
    if (!payload?.success) return { ok: false, error: payload?.error ?? "Could not load the spending report." };
    return { ok: true, report: payload.data as Report };
  } catch {
    return { ok: false, error: "Could not load the spending report." };
  }
}

export function AiUsageReport({ scope }: { scope: "admin" | "me" }) {
  const t = useT();
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>("7d");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [userId, setUserId] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [agent, setAgent] = useState("");
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  const endpoint = scope === "admin" ? "/api/admin/ai/usage" : "/api/account/ai-usage";
  const query = useMemo(() => {
    const q = new URLSearchParams({ period });
    if (period === "custom") {
      if (from) q.set("from", from);
      if (to) q.set("to", to);
    }
    if (scope === "admin" && userId) q.set("userId", userId);
    if (scope === "admin" && workspaceId) q.set("workspaceId", workspaceId);
    if (agent) q.set("agent", agent);
    if (provider) q.set("provider", provider);
    if (model) q.set("model", model);
    return q.toString();
  }, [period, from, to, userId, workspaceId, agent, provider, model, scope]);

  const ready = period !== "custom" || Boolean(from && to);
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    fetchReport(`${endpoint}?${query}`).then((r) => {
      if (!alive) return;
      if (r.ok) {
        setError(null);
        setReport(r.report);
      } else setError(r.error);
    });
    return () => {
      alive = false;
    };
  }, [endpoint, query, ready]);

  const agentName: Record<string, string> = {
    qualificacao: t("Qualification"),
    atendimento: t("Customer service"),
    suporte: t("Support"),
    cerebro: t("Brain"),
    triagem: t("Triage"),
    midia: t("Customer audio, photos and PDFs"),
    treino: t("Training with a document"),
  };
  const periodName: Record<(typeof PERIODS)[number], string> = {
    today: t("Today"),
    "7d": t("Last 7 days"),
    "30d": t("Last 30 days"),
    month: t("This month"),
    custom: t("Custom"),
  };
  const rate = report?.usdToBrl ?? null;
  const money = (micro: number) => {
    const b = brl(micro, rate);
    return b ? `${usd(micro)} (${b})` : usd(micro);
  };
  const maxDay = Math.max(1, ...(report?.byDay.map((d) => d.costMicroUsd) ?? [1]));
  const modelOptions = [...new Set(report?.byModel.map((m) => m.model) ?? [])];
  const myCap = scope === "me" ? report?.today.users[0] : null;

  return (
    <div className="space-y-5">
      {report && report.alerts.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="alert">
          <p className="font-semibold">{t("Close to the daily cap")}</p>
          <ul className="mt-1 space-y-0.5">
            {report.alerts.map((a) => (
              <li key={`${a.kind}:${a.id}`}>
                {scope === "me"
                  ? t("You already used {pct} of today's AI cap ({spent} of US$ {cap}).", { pct: pct(a.ratio), spent: usd(a.spentMicroUsd), cap: a.capUsd })
                  : t(a.kind === "user" ? "User {name} used {pct} of today's cap ({spent} of US$ {cap})." : "Workspace {name} used {pct} of today's cap ({spent} of US$ {cap}).", {
                      name: a.label ?? a.id,
                      pct: pct(a.ratio),
                      spent: usd(a.spentMicroUsd),
                      cap: a.capUsd,
                    })}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <select aria-label={t("Period")} value={period} onChange={(e) => setPeriod(e.target.value as (typeof PERIODS)[number])} className={INPUT}>
          {PERIODS.map((p) => (
            <option key={p} value={p}>{periodName[p]}</option>
          ))}
        </select>
        {period === "custom" && (
          <>
            <input type="date" aria-label={t("From")} value={from} onChange={(e) => setFrom(e.target.value)} className={INPUT} />
            <input type="date" aria-label={t("To")} value={to} onChange={(e) => setTo(e.target.value)} className={INPUT} />
          </>
        )}
        {scope === "admin" && (
          <>
            <select aria-label={t("User")} value={userId} onChange={(e) => setUserId(e.target.value)} className={INPUT}>
              <option value="">{t("All users")}</option>
              {report?.byUser.map((u) => (
                <option key={u.key} value={u.key}>{u.label ?? u.key}</option>
              ))}
            </select>
            <select aria-label={t("Workspace")} value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)} className={INPUT}>
              <option value="">{t("All workspaces")}</option>
              {report?.byWorkspace.map((w) => (
                <option key={w.key} value={w.key}>{w.label ?? w.key}</option>
              ))}
            </select>
          </>
        )}
        <select aria-label={t("Agent")} value={agent} onChange={(e) => setAgent(e.target.value)} className={INPUT}>
          <option value="">{t("All agents")}</option>
          {Object.entries(agentName).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select aria-label={t("Provider")} value={provider} onChange={(e) => setProvider(e.target.value)} className={INPUT}>
          <option value="">{t("All providers")}</option>
          <option value="anthropic">Anthropic</option>
          <option value="openai">OpenAI</option>
          <option value="typesafe">TypeSafe</option>
        </select>
        <select aria-label={t("Model")} value={model} onChange={(e) => setModel(e.target.value)} className={INPUT}>
          <option value="">{t("All models")}</option>
          {modelOptions.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
          {model && !modelOptions.includes(model) && <option value={model}>{model}</option>}
        </select>
        <a href={`${endpoint}?${query}&format=csv`} className="text-sm font-semibold text-accent hover:underline">
          {t("Export CSV")}
        </a>
      </div>

      {error && <p className="text-sm text-red-600">{t(error)}</p>}
      {!report && !error && <p className="text-sm text-muted">{ready ? t("Loading...") : t("Choose the start and end dates.")}</p>}

      {report && (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted">{t("Total spent")}</p>
              <p className="text-lg font-semibold">{usd(report.totals.costMicroUsd)}</p>
              {rate && <p className="text-xs text-muted">{brl(report.totals.costMicroUsd, rate)}</p>}
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted">{t("Calls")}</p>
              <p className="text-lg font-semibold">{num(report.totals.calls)}</p>
              {report.totals.blockedCalls > 0 && (
                <p className="text-xs text-muted">{t("{n} blocked by the cap", { n: num(report.totals.blockedCalls) })}</p>
              )}
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted">{t("Tokens (input / output)")}</p>
              <p className="text-lg font-semibold">{num(report.totals.tokensIn)} / {num(report.totals.tokensOut)}</p>
              <p className="text-xs text-muted">{t("cache: {read} read, {write} written", { read: num(report.totals.cacheRead), write: num(report.totals.cacheWrite) })}</p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted">{t("Average cost")}</p>
              <p className="text-sm">
                {t("per conversation: {v}", { v: report.totals.avgPerConversationMicroUsd === null ? "-" : money(report.totals.avgPerConversationMicroUsd) })}
              </p>
              <p className="text-sm">
                {t("per answer: {v}", { v: report.totals.avgPerResponseMicroUsd === null ? "-" : money(report.totals.avgPerResponseMicroUsd) })}
              </p>
            </div>
          </div>

          {myCap && (
            <p className="text-sm text-muted">
              {t("Today you used {pct} of your daily cap ({spent} of US$ {cap}).", { pct: pct(myCap.ratio), spent: usd(myCap.spentMicroUsd), cap: myCap.capUsd })}
            </p>
          )}

          <div>
            <h3 className="mb-2 text-sm font-semibold">{t("Spending per day")}</h3>
            {report.byDay.length === 0 ? (
              <p className="text-sm text-muted">{t("No AI spending in this period.")}</p>
            ) : (
              <div className="flex h-36 items-end gap-1 overflow-x-auto rounded-lg border border-border p-2" role="img" aria-label={t("Spending per day")}>
                {report.byDay.map((d) => (
                  <div key={d.day} className="flex min-w-[1.25rem] flex-1 flex-col items-center justify-end gap-1" title={`${d.day}: ${money(d.costMicroUsd)} · ${num(d.calls)}`}>
                    <div className="w-full rounded-t bg-accent" style={{ height: `${Math.max(2, Math.round((d.costMicroUsd / maxDay) * 100))}px` }} />
                    <span className="text-[10px] text-muted">{d.day.slice(8)}/{d.day.slice(5, 7)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            {scope === "admin" && (
              <UsageTable title={t("Who spends the most")} rows={report.byUser} money={money} label={(r) => r.label ?? r.key} />
            )}
            {scope === "admin" && (
              <UsageTable title={t("Workspaces")} rows={report.byWorkspace} money={money} label={(r) => r.label ?? r.key} />
            )}
            <UsageTable title={t("Per agent")} rows={report.byAgent} money={money} label={(r) => agentName[r.key] ?? r.key} />
            <UsageTable title={t("Per model")} rows={report.byModel} money={money} label={(r) => r.key.replace(":", " · ")} />
          </div>

          {scope === "admin" && (
            <div className="grid gap-5 sm:grid-cols-2">
              <CapTable title={t("Today's cap per user")} rows={report.today.users} />
              <CapTable title={t("Today's cap per workspace")} rows={report.today.workspaces} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function UsageTable({ title, rows, money, label }: { title: string; rows: Row[]; money: (m: number) => string; label: (r: Row) => string }) {
  const t = useT();
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{t("Nothing here yet.")}</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {rows.map((r) => (
            <li key={r.key} className="flex flex-wrap justify-between gap-2 px-3 py-2 text-sm">
              <span className="min-w-0 truncate">{label(r)}</span>
              <span className="text-muted">{money(r.costMicroUsd)} · {t("{n} calls", { n: r.calls.toLocaleString("pt-BR") })}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CapTable({ title, rows }: { title: string; rows: CapUse[] }) {
  const t = useT();
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{t("Nothing spent today.")}</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {rows.map((r) => (
            <li key={r.id} className="space-y-1 px-3 py-2 text-sm">
              <div className="flex justify-between gap-2">
                <span className="min-w-0 truncate">{r.label ?? r.id}</span>
                <span className={r.ratio >= 0.8 ? "font-semibold text-amber-700" : "text-muted"}>{pct(r.ratio)}</span>
              </div>
              <div className="h-1.5 rounded bg-border">
                <div className={`h-1.5 rounded ${r.ratio >= 0.8 ? "bg-amber-500" : "bg-accent"}`} style={{ width: `${Math.min(100, Math.round((Number.isFinite(r.ratio) ? r.ratio : 1) * 100))}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
