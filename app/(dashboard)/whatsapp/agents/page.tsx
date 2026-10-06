"use client";

/**
 * WhatsApp > Agentes (06/10/2026). Os 3 agentes de IA de cada número
 * (qualificação, atendimento, suporte):
 * - ligar e desligar cada um (nascem DESLIGADOS) e o modo do número
 *   (desligado ou rascunho: você aprova cada resposta no inbox);
 * - instruções de cada agente e o Comando base do negócio;
 * - PDFs do cérebro de cada agente (enviar, ver o status, apagar);
 * - atraso humano, horário de silêncio e limite de envios automáticos;
 * - "Treinar com um documento": o briefing da empresa (PDF ou Word) vira um
 *   RASCUNHO de todos os campos acima, com o painel "Confira antes de salvar".
 *   Só vira configuração no Salvar; depois de salvar, o documento vai pro
 *   cérebro do agente de qualificação. Nenhum agente liga sozinho.
 * IA e chave de API nunca ligam nada sozinhas. A chave é a do /admin.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useT } from "@/components/lang-provider";
import { FromDocBadge, ReviewPanel, TRAIN_ACCEPT, TrainPanel } from "@/components/whatsapp/treinar";
import { api, btnPrimary, btnSecondary, formatPhone, INPUT, ServerNotice, StatusPill, useServerStatus, WhatsAppTabs, type WaStatus } from "@/components/whatsapp/ui";
import { aplicarRascunho } from "@/lib/whatsapp/treinar/aplicar";
import type { CampoTreino, RascunhoTreino } from "@/lib/whatsapp/treinar/esquema";

type Agente = "qualificacao" | "atendimento" | "suporte";
type AgentsView = {
  sessions: Array<{ id: string; label: string; status: WaStatus }>;
  sessionId: string | null;
  numberMode: "OFF" | "DRAFT";
  profile: {
    baseCommand: string;
    quietStart: string;
    quietEnd: string;
    maxAutoPerDay: number;
    delayMinSeconds: number;
    delayMaxSeconds: number;
    facts: string[];
  };
  agents: Array<{ agente: Agente; ativo: boolean; instrucoes: string }>;
};
type Doc = {
  id: string;
  fileName: string;
  sizeBytes: number;
  pageCount: number | null;
  status: "queued" | "processing" | "ready" | "error";
  errorCode: string | null;
  chunkCount: number;
  createdAt: string;
};

const AGENT_INFO: Record<Agente, { name: string; what: string }> = {
  qualificacao: { name: "Qualification", what: "Talks to new people: finds out what they want and if your offer fits them." },
  atendimento: { name: "Customer service", what: "Follows orders, bookings, quotes and purchases that are already in progress." },
  suporte: { name: "Support", what: "Helps people who already bought and have a problem: access, delivery, exchange." },
};

const DOC_ERROR: Record<string, string> = {
  pdf_encrypted: "This PDF has a password. Send it without the password.",
  pdf_no_text: "This PDF has no text (only images). Send a PDF with selectable text.",
  too_many_pages: "This PDF has more than 200 pages.",
  no_embedding_key: "Missing the OpenAI key in /admin. Without it the agent cannot read PDFs.",
  embedding_failed: "The AI could not read this PDF now. Delete it and send it again.",
  queue_unavailable: "The server queue is off. Send it again in a minute.",
};

function sizeLabel(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default function WhatsAppAgentsPage() {
  const t = useT();
  const server = useServerStatus();
  const [view, setView] = useState<AgentsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ ok: boolean; text: string } | null>(null);
  const [factsText, setFactsText] = useState("");
  // Rascunho do "Treinar com um documento": só na tela até o Salvar.
  const [draft, setDraft] = useState<RascunhoTreino | null>(null);
  const [draftSaved, setDraftSaved] = useState(false);
  const [draftFile, setDraftFile] = useState<File | null>(null);
  const [fromDoc, setFromDoc] = useState<Set<CampoTreino>>(new Set());
  const [brainMsg, setBrainMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [docsRefresh, setDocsRefresh] = useState(0);

  const load = useCallback(
    async (sessionId?: string | null) => {
      const r = await api<AgentsView>(`/api/whatsapp/agents${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ""}`);
      if (r.ok) {
        setView(r.data);
        setFactsText(r.data.profile.facts.join("\n"));
        setError(null);
      } else setError(t(r.error));
    },
    [t]
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- primeira carga
    void load();
  }, [load]);

  function applyDraft(d: RascunhoTreino, file: File) {
    if (!view) return;
    const next = aplicarRascunho(view, d);
    setView(next);
    setFactsText(next.profile.facts.join("\n"));
    setDraft(d);
    setDraftSaved(false);
    setDraftFile(file);
    setFromDoc(new Set(d.doDocumento));
    setSaved(null);
    setBrainMsg(null);
  }

  function closeDraft() {
    const wasSaved = draftSaved;
    setDraft(null);
    setDraftFile(null);
    setFromDoc(new Set());
    setDraftSaved(false);
    // Descartar antes de salvar: volta pro que está salvo.
    if (!wasSaved) void load(view?.sessionId);
  }

  // Sair da página com rascunho não salvo pede confirmação.
  useEffect(() => {
    if (!draft || draftSaved) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [draft, draftSaved]);

  /** Depois de salvar: o documento vai pro cérebro do agente de qualificação (mesmo fluxo dos PDFs). */
  async function sendDraftToBrain(file: File) {
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch("/api/whatsapp/cerebro/qualificacao/documents", { method: "POST", body: form });
      const payload = await res.json().catch(() => null);
      if (!payload?.success) setBrainMsg({ ok: false, text: t(payload?.error ?? "Could not send the PDF.") });
      else setBrainMsg({ ok: true, text: t("The document also went to the Qualification agent knowledge base.") });
    } catch {
      setBrainMsg({ ok: false, text: t("Could not reach the server. Try again.") });
    }
    setDocsRefresh((n) => n + 1);
  }

  function patchProfile(p: Partial<AgentsView["profile"]>) {
    setView((cur) => (cur ? { ...cur, profile: { ...cur.profile, ...p } } : cur));
    setSaved(null);
  }
  function patchAgent(agente: Agente, p: Partial<AgentsView["agents"][number]>) {
    setView((cur) => (cur ? { ...cur, agents: cur.agents.map((a) => (a.agente === agente ? { ...a, ...p } : a)) } : cur));
    setSaved(null);
  }

  async function save() {
    if (!view?.sessionId) return;
    setSaving(true);
    setSaved(null);
    const r = await api<AgentsView>("/api/whatsapp/agents", {
      method: "PUT",
      body: JSON.stringify({
        sessionId: view.sessionId,
        numberMode: view.numberMode,
        profile: { ...view.profile, facts: factsText.split("\n").map((f) => f.trim()).filter(Boolean) },
        agents: view.agents,
      }),
    });
    setSaving(false);
    if (!r.ok) return setSaved({ ok: false, text: t(r.error) });
    setView(r.data);
    setFactsText(r.data.profile.facts.join("\n"));
    setSaved({ ok: true, text: t("Saved.") });
    if (draft && !draftSaved) {
      setDraftSaved(true);
      setFromDoc(new Set());
      if (draftFile) {
        const file = draftFile;
        setDraftFile(null);
        await sendDraftToBrain(file);
      }
    }
  }

  const noAiKey = server && !server.ai.anthropic && !server.ai.openai;
  const anyOn = Boolean(view?.agents.some((a) => a.ativo));

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-24">
      <div className="space-y-3">
        <h1 className="text-lg font-semibold text-foreground">{t("WhatsApp")}</h1>
        <WhatsAppTabs active="agents" />
      </div>
      <ServerNotice status={server} />

      <p className="text-sm text-muted">
        {t("Three AI agents can answer the people who write to your number. They start turned off, and while the number is in draft mode every answer waits for your approval in Conversations.")}
      </p>

      {noAiKey && (
        <div className="rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm">
          <p className="font-semibold">{t("No AI key yet")}</p>
          <p className="mt-0.5 text-muted">{t("The agents use the AI keys registered in /admin > AI keys. Without one they stay quiet, even when turned on.")}</p>
        </div>
      )}

      {error && <div className="rounded-xl border border-error/20 bg-error/10 p-4 text-sm text-error">{error}</div>}
      {!view && !error && <div className="panel h-56 animate-pulse rounded-xl" />}

      {view && view.sessions.length === 0 && (
        <div className="panel rounded-xl p-6 text-center">
          <p className="text-sm font-semibold">{t("Connect a number first")}</p>
          <p className="mt-1 text-sm text-muted">{t("The agents are set up for each connected number.")}</p>
          <Link href="/whatsapp/connections" className={`${btnPrimary} mt-4`}>
            {t("Go to Connections")}
          </Link>
        </div>
      )}

      {view && view.sessionId && (
        <>
          <section className="panel space-y-4 rounded-xl p-4 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <label className="block min-w-0 flex-1 space-y-1">
                <span className="text-sm font-medium">{t("Number")}</span>
                <select value={view.sessionId} onChange={(e) => void load(e.target.value)} className={`${INPUT} h-9 py-0`}>
                  {view.sessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label.startsWith("+") ? formatPhone(s.label) : s.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="shrink-0">
                <StatusPill status={view.sessions.find((s) => s.id === view.sessionId)?.status ?? "PENDING"} />
              </div>
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t("Agents on this number")}</legend>
              <label className="flex items-start gap-3 rounded-lg border border-border p-3">
                <input type="radio" name="mode" checked={view.numberMode === "OFF"} onChange={() => setView({ ...view, numberMode: "OFF" })} className="mt-0.5 h-4 w-4" />
                <span>
                  <span className="block text-sm font-semibold">{t("Turned off")}</span>
                  <span className="block text-xs text-muted">{t("No agent answers on this number. You answer everything in Conversations.")}</span>
                </span>
              </label>
              <label className="flex items-start gap-3 rounded-lg border border-border p-3">
                <input type="radio" name="mode" checked={view.numberMode === "DRAFT"} onChange={() => setView({ ...view, numberMode: "DRAFT" })} className="mt-0.5 h-4 w-4" />
                <span>
                  <span className="block text-sm font-semibold">{t("On, as drafts")}</span>
                  <span className="block text-xs text-muted">
                    {t("The agents you turn on below write the answer and it waits for you. You approve, edit or discard it in Conversations.")}
                  </span>
                </span>
              </label>
              {view.numberMode === "DRAFT" && !anyOn && <p className="text-xs text-warning">{t("Turn on at least one agent below, or nothing happens.")}</p>}
            </fieldset>
          </section>

          <TrainPanel onDraft={applyDraft} disabled={saving} />

          {draft && <ReviewPanel draft={draft} saved={draftSaved} onClose={closeDraft} />}
          {brainMsg && <p className={`text-sm ${brainMsg.ok ? "text-success" : "text-error"}`}>{brainMsg.text}</p>}

          <section className="panel space-y-3 rounded-xl p-4 sm:p-5">
            <h2 className="text-base font-semibold">{t("About your business")}</h2>
            <label className="block space-y-1">
              <span className="text-sm font-medium">
                {t("Base Comando: what you sell, how you talk, what the agent may promise")}
                <FromDocBadge field="baseCommand" fields={fromDoc} />
              </span>
              <textarea
                value={view.profile.baseCommand}
                onChange={(e) => patchProfile({ baseCommand: e.target.value })}
                rows={fromDoc.has("baseCommand") ? 18 : 6}
                maxLength={8000}
                placeholder={t("Example: We are a dental clinic in Itapecerica da Serra. We answer in a friendly and short way. We never give a price for a treatment before the evaluation.")}
                className={INPUT}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-medium">
                {t("Prices, deadlines and links the agent may quote (one per line)")}
                <FromDocBadge field="facts" fields={fromDoc} />
              </span>
              <textarea value={factsText} onChange={(e) => setFactsText(e.target.value)} rows={fromDoc.has("facts") ? 8 : 4} placeholder={t("Example: Evaluation costs R$ 80")} className={INPUT} />
              <span className="block text-xs text-muted">{t("The agent never quotes a price, deadline, percentage or link that is not here or in the PDFs. If it does, the answer stays as a draft with a warning.")}</span>
            </label>
          </section>

          {view.agents.map((a) => (
            <AgentCard key={a.agente} agent={a} onChange={(p) => patchAgent(a.agente, p)} fromDoc={fromDoc} docsRefresh={docsRefresh} />
          ))}

          <section className="panel space-y-4 rounded-xl p-4 sm:p-5">
            <div>
              <h2 className="text-base font-semibold">
                {t("Human rhythm")}
                <FromDocBadge field="delay" fields={fromDoc} />
                <FromDocBadge field="quietHours" fields={fromDoc} />
                <FromDocBadge field="maxAutoPerDay" fields={fromDoc} />
              </h2>
              <p className="mt-1 text-sm text-muted">{t("Only used when you let the agent send by itself in a conversation. Drafts you approve go out in a few seconds.")}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1">
                <span className="text-sm font-medium">{t("Wait before answering, from (seconds)")}</span>
                <input type="number" min={0} max={600} value={view.profile.delayMinSeconds} onChange={(e) => patchProfile({ delayMinSeconds: Number(e.target.value) })} className={INPUT} />
              </label>
              <label className="block space-y-1">
                <span className="text-sm font-medium">{t("Wait before answering, up to (seconds)")}</span>
                <input type="number" min={0} max={600} value={view.profile.delayMaxSeconds} onChange={(e) => patchProfile({ delayMaxSeconds: Number(e.target.value) })} className={INPUT} />
              </label>
              <label className="block space-y-1">
                <span className="text-sm font-medium">{t("Quiet hours start")}</span>
                <input type="time" value={view.profile.quietStart} onChange={(e) => patchProfile({ quietStart: e.target.value })} className={INPUT} />
              </label>
              <label className="block space-y-1">
                <span className="text-sm font-medium">{t("Quiet hours end")}</span>
                <input type="time" value={view.profile.quietEnd} onChange={(e) => patchProfile({ quietEnd: e.target.value })} className={INPUT} />
              </label>
              <label className="block space-y-1 sm:col-span-2">
                <span className="text-sm font-medium">{t("Automatic answers per day on this number, at most")}</span>
                <input type="number" min={0} max={1000} value={view.profile.maxAutoPerDay} onChange={(e) => patchProfile({ maxAutoPerDay: Number(e.target.value) })} className={INPUT} />
              </label>
            </div>
            <p className="text-xs text-muted">{t("During quiet hours and after the daily limit, answers stay as drafts. The daily AI spending cap is set in /admin.")}</p>
          </section>

          <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 px-4 py-3 backdrop-blur lg:left-64">
            <div className="mx-auto flex max-w-3xl items-center justify-end gap-3">
              {draft && !draftSaved && !saved && <p className="mr-auto text-xs text-accent">{t("Draft from the document. Nothing was saved yet.")}</p>}
              {saved && (
                <p className={`text-sm ${saved.ok ? "text-success" : "text-error"}`} role="status">
                  {saved.text}
                </p>
              )}
              <button type="button" onClick={() => void save()} disabled={saving} className={btnPrimary}>
                {saving ? t("Saving…") : t("Save")}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function AgentCard({
  agent,
  onChange,
  fromDoc,
  docsRefresh,
}: {
  agent: AgentsView["agents"][number];
  onChange: (p: Partial<AgentsView["agents"][number]>) => void;
  fromDoc: Set<CampoTreino>;
  docsRefresh: number;
}) {
  const t = useT();
  const info = AGENT_INFO[agent.agente];
  return (
    <section className="panel space-y-3 rounded-xl p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{t(info.name)}</h2>
          <p className="mt-0.5 text-sm text-muted">{t(info.what)}</p>
        </div>
        <label className="flex shrink-0 cursor-pointer items-center gap-2 text-sm font-medium">
          <span className={agent.ativo ? "text-success" : "text-muted"}>{agent.ativo ? t("Turned on") : t("Turned off")}</span>
          <input
            type="checkbox"
            role="switch"
            aria-checked={agent.ativo}
            aria-label={t("Turn on {agent}", { agent: t(info.name) })}
            checked={agent.ativo}
            onChange={(e) => onChange({ ativo: e.target.checked })}
            className="peer sr-only"
          />
          <span className="relative h-6 w-11 rounded-full bg-zinc-300 transition-colors peer-checked:bg-success peer-focus-visible:ring-2 peer-focus-visible:ring-accent after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-5" />
        </label>
      </div>
      <label className="block space-y-1">
        <span className="text-sm font-medium">
          {t("Instructions for this agent")}
          <FromDocBadge field={`agent:${agent.agente}`} fields={fromDoc} />
        </span>
        <textarea
          value={agent.instrucoes}
          onChange={(e) => onChange({ instrucoes: e.target.value })}
          rows={fromDoc.has(`agent:${agent.agente}`) ? 12 : 3}
          maxLength={4000}
          placeholder={t("Example: Ask the person's name and what they need before talking about price.")}
          className={INPUT}
        />
      </label>
      <KnowledgeDocs agente={agent.agente} refresh={docsRefresh} />
    </section>
  );
}

function KnowledgeDocs({ agente, refresh }: { agente: Agente; refresh: number }) {
  const t = useT();
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const r = await api<{ documents: Doc[] }>(`/api/whatsapp/cerebro/${agente}/documents`);
    if (r.ok) setDocs(r.data.documents);
  }, [agente]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga e atualização enquanto um PDF processa
    void load();
  }, [load, refresh]);
  const processing = Boolean(docs?.some((d) => d.status === "queued" || d.status === "processing"));
  useEffect(() => {
    if (!processing) return;
    const id = window.setInterval(() => void load(), 4_000);
    return () => window.clearInterval(id);
  }, [processing, load]);

  async function upload(file: File) {
    setBusy(true);
    setMsg(null);
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch(`/api/whatsapp/cerebro/${agente}/documents`, { method: "POST", body: form });
      const payload = await res.json().catch(() => null);
      if (!payload?.success) setMsg(t(payload?.error ?? "Could not send the PDF."));
      else if (payload.data.duplicate) setMsg(t("This PDF was already sent to this agent."));
    } catch {
      setMsg(t("Could not reach the server. Try again."));
    }
    setBusy(false);
    if (input.current) input.current.value = "";
    void load();
  }

  async function remove(doc: Doc) {
    setBusy(true);
    await api(`/api/whatsapp/cerebro/${agente}/documents/${doc.id}`, { method: "DELETE" });
    setBusy(false);
    void load();
  }

  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{t("Documents this agent can consult")}</p>
          <p className="text-xs text-muted">{t("Up to 30 PDFs or Word documents of 8 MB. They count for every number of this workspace.")}</p>
        </div>
        <label className={`${btnSecondary} shrink-0 cursor-pointer px-3 py-1.5 text-xs ${busy ? "pointer-events-none opacity-50" : ""}`}>
          {busy ? t("Sending…") : t("Send PDF or Word")}
          <input
            ref={input}
            type="file"
            accept={TRAIN_ACCEPT}
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
            }}
          />
        </label>
      </div>
      {msg && <p className="text-xs text-error">{msg}</p>}
      {docs && docs.length === 0 && <p className="text-xs text-muted">{t("No document yet.")}</p>}
      {docs && docs.length > 0 && (
        <ul className="divide-y divide-border">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center gap-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{d.fileName}</span>
                <span className="block text-xs text-muted">
                  {sizeLabel(d.sizeBytes)}
                  {d.pageCount ? ` · ${t("{n} pages", { n: d.pageCount })}` : ""}
                  {" · "}
                  {d.status === "ready"
                    ? t("Ready")
                    : d.status === "error"
                      ? t(DOC_ERROR[d.errorCode ?? ""] ?? "Could not read this PDF.")
                      : t("Reading the PDF…")}
                </span>
              </span>
              <button type="button" onClick={() => void remove(d)} disabled={busy} className="shrink-0 text-xs text-error hover:underline">
                {t("Delete")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
