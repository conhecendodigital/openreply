"use client";

/**
 * "Treinar com um documento" na tela WhatsApp > Agentes: o botão de enviar o
 * briefing, o selo "Veio do documento" nos campos e o painel "Confira antes de
 * salvar" (pendências, regras que são só instrução, contradições, números que
 * não estão no documento, mensagens aprovadas e casos de teste).
 * Nada aqui salva: quem salva é o botão Salvar da tela.
 */

import { useRef, useState } from "react";
import { useT } from "@/components/lang-provider";
import { btnPrimary } from "@/components/whatsapp/ui";
import type { AgenteTreino, CampoTreino, RascunhoTreino } from "@/lib/whatsapp/treinar/esquema";

export const TRAIN_ACCEPT = ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_BYTES = 8 * 1024 * 1024;

export const AGENT_NAMES: Record<AgenteTreino, string> = {
  qualificacao: "Qualification",
  atendimento: "Customer service",
  suporte: "Support",
};

const FIELD_NAMES: Record<string, string> = {
  baseCommand: "Base Comando",
  facts: "Prices, deadlines and links",
  quietHours: "Quiet hours",
  delay: "Human rhythm",
  maxAutoPerDay: "Automatic answers per day",
  "agent:qualificacao": "Qualification instructions",
  "agent:atendimento": "Customer service instructions",
  "agent:suporte": "Support instructions",
  message: "Approved message",
  rules: "Business rules",
  example: "Example of how the company talks",
};

const WHERE_NAMES: Record<string, string> = {
  comando_base: "Base Comando",
  qualificacao: "Qualification instructions",
  atendimento: "Customer service instructions",
  suporte: "Support instructions",
};

const MESSAGE_NAMES: Record<string, string> = {
  boas_vindas: "Welcome",
  encaminhamento: "Handing over to the team",
  fora_do_horario: "Outside business hours",
  encerramento: "Closing",
  outra: "Other",
};

/** Selo ao lado do título de um campo que o documento preencheu. */
export function FromDocBadge({ field, fields }: { field: CampoTreino; fields: Set<CampoTreino> }) {
  const t = useT();
  if (!fields.has(field)) return null;
  return <span className="ml-2 inline-flex rounded-full bg-accent/10 px-2 py-0.5 align-middle text-[11px] font-semibold text-accent">{t("From the document")}</span>;
}

/** Envia o documento e devolve o rascunho. Não salva nada. */
export function TrainPanel({ onDraft, disabled }: { onDraft: (draft: RascunhoTreino, file: File) => void; disabled?: boolean }) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(file: File) {
    setError(null);
    if (file.size > MAX_BYTES) {
      setError(t("The file is bigger than 8 MB."));
      return;
    }
    setBusy(true);
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch("/api/whatsapp/agents/treinar", { method: "POST", body: form });
      const payload = await res.json().catch(() => null);
      if (!payload?.success) setError(t(payload?.error ?? "Could not read the document."));
      else onDraft(payload.data.rascunho as RascunhoTreino, file);
    } catch {
      setError(t("Could not reach the server. Try again."));
    }
    setBusy(false);
    if (input.current) input.current.value = "";
  }

  return (
    <section className="panel space-y-3 rounded-xl border border-accent/30 p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{t("Train with a document")}</h2>
          <p className="mt-1 text-sm text-muted">
            {t("Send the briefing the company filled in (PDF or Word, up to 8 MB). The AI fills in every field below as a draft. Nothing is saved and no agent turns on until you check and click Save.")}
          </p>
        </div>
        <label className={`${btnPrimary} shrink-0 cursor-pointer ${busy || disabled ? "pointer-events-none opacity-50" : ""}`}>
          {busy ? t("Reading the document…") : t("Train with a document")}
          <input
            ref={input}
            type="file"
            accept={TRAIN_ACCEPT}
            className="sr-only"
            disabled={busy || disabled}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void send(f);
            }}
          />
        </label>
      </div>
      {busy && <p className="text-xs text-muted" role="status">{t("The AI is reading the whole document. This can take up to 2 minutes. Keep this page open.")}</p>}
      {error && <p className="text-sm text-error" role="alert">{error}</p>}
    </section>
  );
}

function Group({ title, hint, children, tone = "default", count }: { title: string; hint?: string; children: React.ReactNode; tone?: "default" | "warning"; count: number }) {
  const t = useT();
  return (
    <div className={`rounded-lg border p-3 ${tone === "warning" && count > 0 ? "border-warning/40 bg-warning/5" : "border-border"}`}>
      <p className="text-sm font-semibold">
        {t(title)} <span className="font-normal text-muted">({count})</span>
      </p>
      {hint && <p className="mt-0.5 text-xs text-muted">{t(hint)}</p>}
      {count === 0 ? <p className="mt-2 text-xs text-muted">{t("Nothing here.")}</p> : <div className="mt-2">{children}</div>}
    </div>
  );
}

/** Painel "Confira antes de salvar". */
export function ReviewPanel({
  draft,
  saved,
  notice,
  onClose,
}: {
  draft: RascunhoTreino;
  saved: boolean;
  /** Resultado do envio do documento pro cérebro, depois do Salvar. */
  notice?: { ok: boolean; text: string } | null;
  onClose: () => void;
}) {
  const t = useT();
  const r = draft.revisar;
  return (
    <section className="panel space-y-3 rounded-xl border border-warning/40 p-4 sm:p-5" aria-label={t("Check before saving")}>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{saved ? t("What came from the document") : t("Check before saving")}</h2>
          <p className="mt-1 text-sm text-muted">
            {saved
              ? t("Saved. The agents are still turned off. Use the test cases below before turning them on.")
              : t("Draft from {file}. Nothing was saved yet. The fields marked From the document were filled in by the AI: read them, fix what is wrong and click Save.", { file: draft.arquivo.nome })}
          </p>
          {notice && <p className={`mt-1 text-sm ${notice.ok ? "text-success" : "text-error"}`}>{notice.text}</p>}
        </div>
        <button type="button" onClick={onClose} className="shrink-0 self-end text-xs text-muted hover:underline sm:self-auto">
          {saved ? t("Close") : t("Discard draft")}
        </button>
      </div>

      {r.avisos.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm">
          {r.avisos.map((a, i) => (
            <li key={i}>{t(a.texto, a.agente ? { agent: t(AGENT_NAMES[a.agente]) } : undefined)}</li>
          ))}
        </ul>
      )}

      <Group title="Pending (A definir)" hint="The document has no answer for these yet. They did not become rules." tone="warning" count={r.pendencias.length}>
        <ul className="space-y-2 text-sm">
          {r.pendencias.map((p, i) => (
            <li key={i}>
              <span className="block font-medium">{p.assunto}</span>
              {p.trecho && p.trecho !== p.assunto && <span className="block text-xs text-muted">{p.trecho}</span>}
            </li>
          ))}
        </ul>
      </Group>

      <Group
        title="Rules the system does not run by itself yet"
        hint="They went in as written instructions. The agent follows them in the conversation, but nothing happens automatically (no reminder is sent, no message goes to another number)."
        count={r.soInstrucao.length}
      >
        <ul className="space-y-2 text-sm">
          {r.soInstrucao.map((s, i) => (
            <li key={i}>
              <span className="block">{s.regra}</span>
              <span className="block text-xs text-muted">{t("Written in: {where}", { where: t(WHERE_NAMES[s.onde] ?? "Base Comando") })}</span>
            </li>
          ))}
        </ul>
      </Group>

      <Group title="Possible contradictions" hint="The AI did not pick a side. Decide and fix the field." tone="warning" count={r.contradicoes.length}>
        <ul className="list-inside list-disc space-y-1 text-sm">
          {r.contradicoes.map((c, i) => (
            <li key={i}>{c.descricao}</li>
          ))}
        </ul>
      </Group>

      <Group
        title="Not found in the document"
        hint="A number, price, deadline, time or text that is in a field but not in the document. Check if the AI made it up."
        tone="warning"
        count={r.naoAchei.length}
      >
        <ul className="space-y-1 text-sm">
          {r.naoAchei.map((n, i) => (
            <li key={i}>
              <span className="font-medium">{n.valor}</span> <span className="text-xs text-muted">({t(FIELD_NAMES[n.campo] ?? "Base Comando")})</span>
            </li>
          ))}
        </ul>
      </Group>

      <Group title="Approved messages" hint="They went in word for word. The agent uses the exact text." count={draft.mensagensAprovadas.length}>
        <ul className="space-y-2 text-sm">
          {draft.mensagensAprovadas.map((m, i) => (
            <li key={i}>
              <span className="block text-xs font-semibold text-muted">
                {t(MESSAGE_NAMES[m.tipo] ?? "Other")} · {m.quando}
                {!m.literal && <span className="ml-1 text-warning">{t("(not the same as in the document)")}</span>}
              </span>
              <span className="block whitespace-pre-wrap">{m.texto}</span>
            </li>
          ))}
        </ul>
      </Group>

      <Group title="Test cases from the document" hint="Send these situations from another phone, with the number on drafts, and see if the agent decides like this." count={draft.casosDeTeste.length}>
        <ol className="list-inside list-decimal space-y-2 text-sm">
          {draft.casosDeTeste.map((c, i) => (
            <li key={i}>
              <span>{c.situacao}</span>
              <span className="block pl-5 text-xs">
                <span className="font-semibold">{t("Expected:")}</span> {c.decisao}
              </span>
              {c.motivo && (
                <span className="block pl-5 text-xs text-muted">
                  {t("Why:")} {c.motivo}
                </span>
              )}
            </li>
          ))}
        </ol>
      </Group>
    </section>
  );
}
