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
import { CollapsibleSection, openAndScroll, useSections } from "@/components/ui/collapsible-section";
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
export function TrainPanel({
  onDraft,
  disabled,
  defaultOpen = true,
}: {
  onDraft: (draft: RascunhoTreino, file: File) => void;
  disabled?: boolean;
  /** Fechado quando o número já tem o Comando base (treinar de novo é raro). */
  defaultOpen?: boolean;
}) {
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
    <CollapsibleSection
      id="treinar"
      title={t("Train with a document")}
      className="border-accent/30"
      defaultOpen={defaultOpen}
      attention={Boolean(error) || busy}
      summary={t("Send the briefing (PDF or Word) and the AI fills in the fields as a draft.")}
      badge={busy ? { text: t("Reading the document…"), tone: "accent" } : error ? { text: t("Error"), tone: "error" } : null}
      actions={
        <label className={`${btnPrimary} cursor-pointer px-3 py-1.5 text-xs sm:px-4 sm:py-2 sm:text-sm ${busy || disabled ? "pointer-events-none opacity-50" : ""}`}>
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
      }
    >
      <p className="text-sm text-muted">
        {t("Send the briefing the company filled in (PDF or Word, up to 8 MB). The AI fills in every field below as a draft. Nothing is saved and no agent turns on until you check and click Save.")}
      </p>
      {busy && <p className="text-xs text-muted" role="status">{t("The AI is reading the whole document. This can take up to 2 minutes. Keep this page open.")}</p>}
      {error && <p className="text-sm text-error" role="alert">{error}</p>}
    </CollapsibleSection>
  );
}

function Group({
  id,
  title,
  hint,
  children,
  tone = "default",
  count,
}: {
  id: string;
  title: string;
  hint?: string;
  children: React.ReactNode;
  tone?: "default" | "warning";
  count: number;
}) {
  const t = useT();
  const alert = tone === "warning" && count > 0;
  return (
    <CollapsibleSection
      id={id}
      title={t(title)}
      variant="group"
      hideFromIndex
      defaultOpen={alert}
      attention={alert}
      badge={{ text: String(count), tone: alert ? "warning" : "default" }}
      summary={count === 0 ? t("Nothing here.") : hint ? t(hint) : undefined}
      description={hint ? t(hint) : undefined}
    >
      {count === 0 ? <p className="text-xs text-muted">{t("Nothing here.")}</p> : children}
    </CollapsibleSection>
  );
}

/** Um grupo da página que o documento preencheu (link no resumo do topo). */
export type ReviewLink = { id: string; title: string; summary: string };

/** Painel "Confira antes de salvar": resumo no topo com contagem por grupo e link pra cada grupo. */
export function ReviewPanel({
  draft,
  saved,
  notice,
  onClose,
  links = [],
}: {
  draft: RascunhoTreino;
  saved: boolean;
  /** Resultado do envio do documento pro cérebro, depois do Salvar. */
  notice?: { ok: boolean; text: string } | null;
  onClose: () => void;
  /** Grupos da tela (Empresa e objetivo, Onde atende, Serviços...) com o resumo de uma linha. */
  links?: ReviewLink[];
}) {
  const t = useT();
  const sections = useSections();
  const r = draft.revisar;
  const toCheck = r.pendencias.length + r.naoAchei.length + r.contradicoes.length;
  const problems: Array<{ id: string; title: string; count: number; warn: boolean }> = [
    { id: "conferir-pendencias", title: "Pending (A definir)", count: r.pendencias.length, warn: true },
    { id: "conferir-nao-achei", title: "Not found in the document", count: r.naoAchei.length, warn: true },
    { id: "conferir-contradicoes", title: "Possible contradictions", count: r.contradicoes.length, warn: true },
    { id: "conferir-so-instrucao", title: "Rules the system does not run by itself yet", count: r.soInstrucao.length, warn: false },
    { id: "conferir-mensagens", title: "Approved messages", count: draft.mensagensAprovadas.length, warn: false },
    { id: "conferir-casos", title: "Test cases from the document", count: draft.casosDeTeste.length, warn: false },
  ];

  return (
    <CollapsibleSection
      id="conferir"
      title={saved ? t("What came from the document") : t("Check before saving")}
      indexLabel={t("Check before saving")}
      className="border-warning/40"
      attention={!saved}
      badge={
        saved
          ? { text: t("Saved"), tone: "success" }
          : toCheck > 0
            ? { text: toCheck === 1 ? t("1 to check") : t("{n} to check", { n: toCheck }), tone: "warning" }
            : { text: t("Draft"), tone: "accent" }
      }
      summary={problems
        .filter((p) => p.warn)
        .map((p) => `${t(p.title)}: ${p.count}`)
        .join(" · ")}
      actions={
        <button type="button" onClick={onClose} className="text-xs text-muted hover:underline">
          {saved ? t("Close") : t("Discard draft")}
        </button>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-muted">
          {saved
            ? t("Saved. The agents are still turned off. Use the test cases below before turning them on.")
            : t("Draft from {file}. Nothing was saved yet. The fields marked From the document were filled in by the AI: read them, fix what is wrong and click Save.", { file: draft.arquivo.nome })}
        </p>
        {notice && <p className={`text-sm ${notice.ok ? "text-success" : "text-error"}`}>{notice.text}</p>}

        {r.avisos.length > 0 && (
          <ul className="space-y-1 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm">
            {r.avisos.map((a, i) => (
              <li key={i}>{t(a.texto, a.agente ? { agent: t(AGENT_NAMES[a.agente]) } : undefined)}</li>
            ))}
          </ul>
        )}

        <div className="space-y-2 rounded-lg border border-border p-3" data-resumo-conferir="">
          <p className="text-sm font-semibold">{t("Summary by group")}</p>
          <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {problems.map((p) => (
              <li key={p.id} className="min-w-0">
                <a
                  href={`#${p.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    openAndScroll(sections, p.id);
                  }}
                  className={`flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-sm hover:bg-surface-hover ${
                    p.warn && p.count > 0 ? "border-warning/50 bg-warning/5 font-semibold" : "border-border"
                  }`}
                >
                  <span className="min-w-0 truncate">{t(p.title)}</span>
                  <span className="shrink-0 text-xs text-muted">{p.count}</span>
                </a>
              </li>
            ))}
          </ul>
          {links.length > 0 && (
            <>
              <p className="pt-1 text-xs font-semibold text-muted">{t("What the document filled in")}</p>
              <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {links.map((l) => (
                  <li key={l.id} className="min-w-0">
                    <a
                      href={`#${l.id}`}
                      onClick={(e) => {
                        e.preventDefault();
                        openAndScroll(sections, l.id);
                      }}
                      className="block rounded-md border border-border px-2.5 py-1.5 hover:bg-surface-hover"
                    >
                      <span className="block truncate text-sm font-medium">{l.title}</span>
                      <span className="block truncate text-xs text-muted">{l.summary}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="space-y-2">
          <Group id="conferir-pendencias" title="Pending (A definir)" hint="The document has no answer for these yet. They did not become rules." tone="warning" count={r.pendencias.length}>
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
            id="conferir-nao-achei"
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

          <Group id="conferir-contradicoes" title="Possible contradictions" hint="The AI did not pick a side. Decide and fix the field." tone="warning" count={r.contradicoes.length}>
            <ul className="list-inside list-disc space-y-1 text-sm">
              {r.contradicoes.map((c, i) => (
                <li key={i}>{c.descricao}</li>
              ))}
            </ul>
          </Group>

          <Group
            id="conferir-so-instrucao"
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

          <Group id="conferir-mensagens" title="Approved messages" hint="They went in word for word. The agent uses the exact text." count={draft.mensagensAprovadas.length}>
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

          <Group
            id="conferir-casos"
            title="Test cases from the document"
            hint="Send these situations from another phone, with the number on drafts, and see if the agent decides like this."
            count={draft.casosDeTeste.length}
          >
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
        </div>
      </div>
    </CollapsibleSection>
  );
}
