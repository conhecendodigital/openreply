"use client";

/**
 * Peças do lead (CRM do WhatsApp): selo do estágio e o painel "Ficha do lead"
 * da conversa (campos que o cliente já disse, estágio, histórico). Usadas em
 * WhatsApp > Leads e em Conversas. Quem classifica é o agente, pelas regras do
 * número; a mudança da equipe vence e fica marcada como manual.
 */

import { useState } from "react";
import { useT } from "@/components/lang-provider";
import { api, btnPrimary, btnSecondary, INPUT, shortTime } from "@/components/whatsapp/ui";
import { NOME_ESTAGIO, type Estagio } from "@/lib/whatsapp/regras/estagio";

export type LeadStage = Estagio;

export type LeadView = {
  stage: LeadStage;
  stageReason: string | null;
  stageManual: boolean;
  stageAt: string | null;
  stages: Array<{ key: LeadStage; name: string; hidden: boolean }>;
  fields: Array<{
    key: string;
    label: string;
    required: boolean;
    value: string | null;
    origin: "confirmado" | "inferido" | "dono" | null;
    note: string | null;
    messageId: string | null;
  }>;
  history: Array<{ from: string | null; to: string; reason: string | null; manual: boolean; byUser: boolean; at: string }>;
};

export const STAGE_KEYS: LeadStage[] = ["novo", "qualificando", "qualificado", "analisar", "fora_do_perfil", "cliente", "sem_resposta"];

const STAGE_TONE: Record<LeadStage, string> = {
  novo: "bg-zinc-200 text-zinc-700",
  qualificando: "bg-accent/10 text-accent",
  qualificado: "bg-success/15 text-success",
  analisar: "bg-warning/15 text-warning",
  fora_do_perfil: "bg-error/10 text-error",
  cliente: "bg-[#25d366]/15 text-[#0a7c3b]",
  sem_resposta: "bg-surface-hover text-muted",
};

const ORIGIN_LABEL: Record<string, string> = {
  confirmado: "The customer said it",
  inferido: "Inferred",
  dono: "Confirmed by the team",
};

/** Nome do estágio: o que o dono escolheu pro número, senão o padrão traduzido. */
export function useStageName() {
  const t = useT();
  // The server sends the default English name when the owner did not rename the
  // stage; only a real custom name skips the translation.
  return (key: string, custom?: string | null) => {
    const padrao = NOME_ESTAGIO[key as LeadStage] ?? key;
    return custom && custom.trim() && custom !== padrao ? custom : t(padrao);
  };
}

export function StageBadge({ stage, name, manual }: { stage: LeadStage; name?: string | null; manual?: boolean }) {
  const t = useT();
  const stageName = useStageName();
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-semibold ${STAGE_TONE[stage] ?? STAGE_TONE.novo}`}>
      {stageName(stage, name)}
      {manual && <span title={t("Changed by the team")}>· {t("manual")}</span>}
    </span>
  );
}

/** Painel "Ficha do lead" da conversa aberta (recolhível). */
export function LeadPanel({ conversationId, lead, onChange }: { conversationId: string; lead: LeadView; onChange: (lead: LeadView) => void }) {
  const t = useT();
  const stageName = useStageName();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [newStage, setNewStage] = useState<LeadStage | "">("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const missing = lead.fields.filter((f) => f.required && !f.value).length;
  const custom = (key: string) => lead.stages.find((s) => s.key === key)?.name ?? null;

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const r = await api<LeadView>(`/api/whatsapp/conversations/${conversationId}/lead`, { method: "POST", body: JSON.stringify(body) });
    setBusy(false);
    if (!r.ok) {
      setError(t(r.error));
      return false;
    }
    onChange(r.data);
    return true;
  }

  function startEdit() {
    setValues(Object.fromEntries(lead.fields.map((f) => [f.key, f.value ?? ""])));
    setEditing(true);
  }

  async function saveFicha() {
    const changed: Record<string, string> = {};
    for (const f of lead.fields) if ((values[f.key] ?? "") !== (f.value ?? "")) changed[f.key] = values[f.key] ?? "";
    if (!Object.keys(changed).length) return setEditing(false);
    if (await post({ action: "ficha", fields: changed })) setEditing(false);
  }

  async function changeStage() {
    if (!newStage) return;
    if (await post({ action: "stage", stage: newStage, reason: reason.trim() || undefined })) {
      setNewStage("");
      setReason("");
    }
  }

  return (
    <div className="shrink-0 border-b border-border bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-surface-hover"
      >
        <span className="font-semibold">{t("Lead record")}</span>
        <StageBadge stage={lead.stage} name={custom(lead.stage)} manual={lead.stageManual} />
        {missing > 0 && <span className="text-warning">{t("{n} missing", { n: missing })}</span>}
        <span className="ml-auto text-muted">{open ? t("Hide") : t("Show")}</span>
      </button>
      {open && (
        <div className="max-h-[45dvh] space-y-3 overflow-y-auto px-3 pb-3 text-sm">
          {lead.stageReason && <p className="text-xs text-muted">{t("Why: {reason}", { reason: lead.stageReason })}</p>}

          {lead.fields.length === 0 ? (
            <p className="text-xs text-muted">{t("This number has no business rules yet. Train the agents with a document to get a lead record.")}</p>
          ) : (
            <dl className="space-y-1.5">
              {lead.fields.map((f) => (
                <div key={f.key} className={`rounded-md px-2 py-1.5 ${f.required && !f.value ? "bg-warning/10" : "bg-surface-hover"}`}>
                  <dt className="flex items-center gap-1 text-[11px] font-semibold text-muted">
                    {f.label}
                    {f.required && <span title={t("Needed to qualify")}>*</span>}
                  </dt>
                  {editing ? (
                    <input
                      value={values[f.key] ?? ""}
                      onChange={(e) => setValues((cur) => ({ ...cur, [f.key]: e.target.value }))}
                      maxLength={160}
                      aria-label={f.label}
                      className={`${INPUT} mt-1 py-1`}
                    />
                  ) : (
                    <dd className="text-sm">
                      {f.value ?? <span className="text-xs text-warning">{f.required ? t("Missing") : t("Not said yet")}</span>}
                      {f.value && (
                        <span className="ml-1.5 text-[11px] text-muted">
                          {f.origin ? t(ORIGIN_LABEL[f.origin] ?? "Inferred") : ""}
                          {f.note ? ` · ${f.note}` : ""}
                        </span>
                      )}
                    </dd>
                  )}
                </div>
              ))}
            </dl>
          )}
          {lead.fields.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {editing ? (
                <>
                  <button type="button" className={`${btnPrimary} px-3 py-1.5 text-xs`} disabled={busy} onClick={() => void saveFicha()}>
                    {t("Save")}
                  </button>
                  <button type="button" className={`${btnSecondary} px-3 py-1.5 text-xs`} disabled={busy} onClick={() => setEditing(false)}>
                    {t("Cancel")}
                  </button>
                  <span className="text-[11px] text-muted">{t("What you write counts as confirmed and the agent does not change it.")}</span>
                </>
              ) : (
                <button type="button" className={`${btnSecondary} px-3 py-1.5 text-xs`} onClick={startEdit}>
                  {t("Edit record")}
                </button>
              )}
            </div>
          )}

          <div className="space-y-2 rounded-md border border-border p-2">
            <p className="text-xs font-semibold">{t("Stage")}</p>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={newStage}
                onChange={(e) => setNewStage(e.target.value as LeadStage | "")}
                aria-label={t("Change the stage")}
                className={`${INPUT} h-8 w-auto py-0 text-xs`}
              >
                <option value="">{t("Change the stage…")}</option>
                {lead.stages
                  .filter((s) => !s.hidden && s.key !== lead.stage)
                  .map((s) => (
                    <option key={s.key} value={s.key}>
                      {stageName(s.key, s.name)}
                    </option>
                  ))}
              </select>
              {newStage && (
                <>
                  <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    maxLength={300}
                    placeholder={t("Reason (optional)")}
                    aria-label={t("Reason (optional)")}
                    className={`${INPUT} h-8 min-w-0 flex-1 py-0 text-xs`}
                  />
                  <button type="button" className={`${btnPrimary} px-3 py-1.5 text-xs`} disabled={busy} onClick={() => void changeStage()}>
                    {t("Change")}
                  </button>
                </>
              )}
              {lead.stageManual && !newStage && (
                <button type="button" className={`${btnSecondary} px-3 py-1.5 text-xs`} disabled={busy} onClick={() => void post({ action: "release" })}>
                  {t("Give it back to the agent")}
                </button>
              )}
            </div>
            <p className="text-[11px] text-muted">{t("The agent sets the stage by the rules of this number. A change you make wins and stays marked as manual until a new fact comes in.")}</p>
          </div>

          {error && <p className="text-xs text-error">{error}</p>}

          {lead.history.length > 0 && (
            <div>
              <p className="text-xs font-semibold">{t("Stage history")}</p>
              <ul className="mt-1 space-y-1">
                {lead.history.map((h, i) => (
                  <li key={i} className="text-[11px] text-muted">
                    <span className="text-foreground">{shortTime(h.at)}</span> · {h.from ? `${stageName(h.from, custom(h.from))} → ` : ""}
                    {stageName(h.to, custom(h.to))} · {h.byUser ? t("by the team") : t("by the agent")}
                    {h.reason ? ` · ${h.reason}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
