"use client";

/**
 * Tela WhatsApp > Agentes: regras duras do negócio (uma por linha), estágios
 * do lead, aviso ao responsável, "O que o agente aprendeu" e "Testar o agente".
 * As regras e os estágios só são gravados no botão Salvar da tela. Sugestão
 * só vira regra quando você clica em Aceitar.
 */

import { useCallback, useEffect, useState } from "react";
import { useT } from "@/components/lang-provider";
import { FromDocBadge } from "@/components/whatsapp/treinar";
import { ChipListInput, CollapsibleSection } from "@/components/ui/collapsible-section";
import { api, btnPrimary, btnSecondary, INPUT } from "@/components/whatsapp/ui";
import { DECISOES, type Decisao, type RegrasNegocio } from "@/lib/whatsapp/regras/esquema";
import { ESTAGIOS, NOME_ESTAGIO, type ConfigEstagio, type Estagio } from "@/lib/whatsapp/regras/estagio";
import {
  cidadesDoTexto,
  cidadesParaTexto,
  infosDoTexto,
  infosParaTexto,
  itensDoTexto,
  itensParaTexto,
  regioesDoTexto,
  regioesParaTexto,
  textosDoTexto,
} from "@/lib/whatsapp/regras/texto";
import type { CampoTreino } from "@/lib/whatsapp/treinar/esquema";
import type { TFunction } from "@/lib/i18n";
import type { LearningReport } from "@/lib/whatsapp/regras/painel";
import type { ResultadoTeste } from "@/lib/whatsapp/regras/testar";

/* ------------------------------- texto das regras ------------------------------- */

export type RulesText = {
  cidadesAtendidas: string;
  cidadesNaoAtendidas: string;
  regioesCuidado: string;
  excecoesLocal: string;
  servicosAceitos: string;
  servicosRecusados: string;
  excecoesServico: string;
  infoMinima: string;
  resumoEquipe: string;
  horario: string;
  nuncaPrometer: string;
  mensagemForaDaArea: string;
  mensagemServicoRecusado: string;
};

export function rulesToText(r: RegrasNegocio): RulesText {
  return {
    cidadesAtendidas: cidadesParaTexto(r.cidadesAtendidas),
    cidadesNaoAtendidas: cidadesParaTexto(r.cidadesNaoAtendidas),
    regioesCuidado: regioesParaTexto(r.regioesCuidado),
    excecoesLocal: itensParaTexto(r.excecoesLocal),
    servicosAceitos: r.servicosAceitos.join("\n"),
    servicosRecusados: itensParaTexto(r.servicosRecusados),
    excecoesServico: itensParaTexto(r.excecoesServico),
    infoMinima: infosParaTexto(r.infoMinima),
    resumoEquipe: r.resumoEquipe.join("\n"),
    horario: r.horario,
    nuncaPrometer: r.nuncaPrometer.join("\n"),
    mensagemForaDaArea: r.mensagemForaDaArea,
    mensagemServicoRecusado: r.mensagemServicoRecusado,
  };
}

/** Texto da tela -> regras. O que não tem caixa de texto (casos de teste, mensagens, responsável) vem de `antes`. */
export function textToRules(t: RulesText, antes: RegrasNegocio): RegrasNegocio {
  return {
    ...antes,
    cidadesAtendidas: cidadesDoTexto(t.cidadesAtendidas),
    cidadesNaoAtendidas: cidadesDoTexto(t.cidadesNaoAtendidas),
    regioesCuidado: regioesDoTexto(t.regioesCuidado),
    excecoesLocal: itensDoTexto(t.excecoesLocal),
    servicosAceitos: textosDoTexto(t.servicosAceitos),
    servicosRecusados: itensDoTexto(t.servicosRecusados),
    excecoesServico: itensDoTexto(t.excecoesServico),
    infoMinima: infosDoTexto(t.infoMinima, antes.infoMinima),
    resumoEquipe: textosDoTexto(t.resumoEquipe),
    horario: t.horario.trim(),
    nuncaPrometer: textosDoTexto(t.nuncaPrometer),
    mensagemForaDaArea: t.mensagemForaDaArea.trim(),
    mensagemServicoRecusado: t.mensagemServicoRecusado.trim(),
  };
}

export const DECISION_NAMES: Record<string, string> = {
  qualificar: "Qualify",
  analisar: "Send for review",
  fora_da_area: "Outside the area (careful answer)",
  servico_recusado: "Service the company does not do",
  humano: "Hand over to a person",
  continuar: "Keep asking",
  erro_regra: "Broke a business rule",
  teto: "Stopped by the daily AI cap",
  erro: "AI error",
};

export const RULE_NAMES: Record<string, string> = {
  qualificado_sem_local: "Qualified without knowing where the service is",
  qualificado_fora_da_area: "Qualified outside the area",
  qualificado_servico_recusado: "Qualified a service the company does not do",
  qualificado_sem_info: "Qualified without the minimum information",
  confirmou_fora_da_area: "Said it serves a place outside the area",
  confirmou_sem_local: "Confirmed service before knowing the place",
  recusa_seca: "Refused in a dry way",
  confirmou_servico_recusado: "Said it does a service the company does not do",
  nao_perguntou_local: "Did not ask where the service is",
  perguntou_de_novo: "Asked again something the customer already said",
  promessa: "Promised something the company never promises",
  rascunho_com_regra: "Draft with a rule warning",
};

type TextField = { key: keyof RulesText; label: string; hint?: string; rows?: number; placeholder?: string };

/** Linhas preenchidas de uma caixa "uma por linha". */
export function countLines(s: string): number {
  return s.split("\n").filter((l) => l.trim()).length;
}

/** Grupos das regras (e a seção Sobre o seu negócio), na ordem da tela. */
export const RULE_GROUPS = [
  { id: "regras-onde", title: "Where you serve" },
  { id: "regras-servicos", title: "Services" },
  { id: "regras-qualificacao", title: "Qualification" },
  { id: "regras-horario", title: "Hours and what never to promise" },
  { id: "regras-quem", title: "Who takes over" },
  { id: "regras-mensagens", title: "Approved messages" },
  { id: "regras-casos", title: "Test cases" },
] as const;
export type RuleGroupId = (typeof RULE_GROUPS)[number]["id"];

/** Resumo de uma linha de cada grupo, com o que está na tela agora (antes do Salvar também). */
export function ruleGroupSummaries(t: TFunction, text: RulesText, rules: RegrasNegocio): Record<RuleGroupId, string> {
  const atendidas = countLines(text.cidadesAtendidas);
  const fora = countLines(text.cidadesNaoAtendidas);
  const cuidado = countLines(text.regioesCuidado);
  const excLocal = countLines(text.excecoesLocal);
  const aceitos = countLines(text.servicosAceitos);
  const recusados = countLines(text.servicosRecusados);
  const excServ = countLines(text.excecoesServico);
  const infos = countLines(text.infoMinima);
  const nunca = countLines(text.nuncaPrometer);
  const resumo = countLines(text.resumoEquipe);
  const msgs = rules.mensagensAprovadas.length;
  const casos = rules.casosTeste.length;
  return {
    "regras-onde": [
      atendidas === 1 ? t("1 city served") : t("{n} cities served", { n: atendidas }),
      t("{n} not served", { n: fora }),
      t("{n} with care", { n: cuidado }),
      excLocal === 1 ? t("1 exception") : t("{n} exceptions", { n: excLocal }),
    ].join(" · "),
    "regras-servicos": [
      aceitos === 1 ? t("1 service accepted") : t("{n} services accepted", { n: aceitos }),
      t("{n} refused", { n: recusados }),
      excServ === 1 ? t("1 exception") : t("{n} exceptions", { n: excServ }),
    ].join(" · "),
    "regras-qualificacao": infos === 1 ? t("1 minimum information") : t("{n} minimum informations", { n: infos }),
    "regras-horario": [
      text.horario.trim() ? t("Business hours filled in") : t("No business hours"),
      t("{n} never promise", { n: nunca }),
    ].join(" · "),
    "regras-quem": [
      rules.responsavel.nome ? t("In charge: {name}", { name: rules.responsavel.nome }) : t("Nobody in charge yet"),
      t("{n} in the team summary", { n: resumo }),
    ].join(" · "),
    "regras-mensagens": msgs === 1 ? t("1 approved message") : t("{n} approved messages", { n: msgs }),
    "regras-casos": casos === 1 ? t("1 test case") : t("{n} test cases", { n: casos }),
  };
}

const PLACE_FIELDS: TextField[] = [
  { key: "regioesCuidado", label: "Neighborhoods or regions that go for review", hint: "Format: name, City/UF | what to do", placeholder: "Campo Grande, Campinas/SP | send for review" },
  { key: "excecoesLocal", label: "Place exceptions that go for review", hint: "Format: description | words the customer would use", placeholder: "Big job outside the region | big job, building" },
  { key: "mensagemForaDaArea", label: "How to answer when the place is outside the area", rows: 2 },
];

const SERVICE_FIELDS: TextField[] = [
  { key: "servicosRecusados", label: "Services the company does not do", hint: "Format: description | words the customer would use", placeholder: "Small isolated repair | change faucet, leak" },
  { key: "excecoesServico", label: "Service exceptions (accepted anyway)", hint: "Format: description | words the customer would use", placeholder: "Stones | granite, marble" },
  { key: "mensagemServicoRecusado", label: "How to answer when the company does not do the service", rows: 2 },
];

const QUALIFY_FIELDS: TextField[] = [
  { key: "infoMinima", label: "Minimum information to qualify", hint: "Format: information | words that show it. Qualified only with all of them.", placeholder: "Keys situation | keys" },
];

const HOURS_FIELDS: TextField[] = [{ key: "horario", label: "Business hours", rows: 2 }];

export function RulesPanel({
  text,
  onText,
  rules,
  onRules,
  fromDoc,
}: {
  text: RulesText;
  onText: (t: RulesText) => void;
  rules: RegrasNegocio;
  onRules: (r: RegrasNegocio) => void;
  fromDoc: Set<CampoTreino>;
}) {
  const t = useT();
  const sums = ruleGroupSummaries(t, text, rules);
  const field = (f: TextField) => (
    <label key={f.key} className="block space-y-1">
      <span className="text-sm font-medium">{t(f.label)}</span>
      <textarea
        value={text[f.key]}
        onChange={(e) => onText({ ...text, [f.key]: e.target.value })}
        rows={f.rows ?? Math.min(6, Math.max(2, text[f.key].split("\n").length + 1))}
        placeholder={f.placeholder ? t("Example: {x}", { x: t(f.placeholder) }) : undefined}
        className={INPUT}
      />
      {f.hint && <span className="block text-xs text-muted">{t(f.hint)}</span>}
    </label>
  );
  const chips = (key: keyof RulesText, label: string, placeholder?: string, hint?: string) => (
    <ChipListInput
      id={`regra-${key}`}
      value={text[key]}
      onChange={(v) => onText({ ...text, [key]: v })}
      label={label}
      placeholder={placeholder}
      hint={hint}
    />
  );
  const group = (id: RuleGroupId, title: string, children: React.ReactNode, extra?: { description?: React.ReactNode }) => (
    <CollapsibleSection id={id} title={t(title)} summary={sums[id]} variant="group" hideFromIndex defaultOpen={false} description={extra?.description}>
      {children}
    </CollapsibleSection>
  );

  function toggle(i: number, d: Decisao) {
    const casos = rules.casosTeste.map((c, j) => {
      if (j !== i) return c;
      const tem = c.esperado.includes(d);
      const esperado = tem ? c.esperado.filter((x) => x !== d) : [...c.esperado, d];
      return { ...c, esperado: esperado.length ? esperado : c.esperado };
    });
    onRules({ ...rules, casosTeste: casos });
  }

  return (
    <CollapsibleSection
      id="regras"
      title={
        <>
          {t("Business rules")}
          <FromDocBadge field="rules" fields={fromDoc} />
        </>
      }
      indexLabel={t("Business rules")}
      summary={[sums["regras-onde"].split(" · ")[0], sums["regras-servicos"].split(" · ")[0], sums["regras-casos"]].join(" · ")}
      description={t("The system checks these rules by itself in every answer, before sending or marking a lead as qualified. They only change when you click Save or accept a suggestion.")}
    >
      <div className="space-y-2">
        {group(
          "regras-onde",
          "Where you serve",
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              {chips("cidadesAtendidas", t("Cities served"), t("Example: {x}", { x: "Paulínia/SP" }), t("Type City/UF and press Enter."))}
              {chips("cidadesNaoAtendidas", t("Cities not served"), t("Example: {x}", { x: "Hortolândia/SP" }), t("Type City/UF and press Enter."))}
            </div>
            {PLACE_FIELDS.map(field)}
          </>
        )}
        {group(
          "regras-servicos",
          "Services",
          <>
            {chips("servicosAceitos", t("Services accepted"))}
            <div className="grid gap-3 sm:grid-cols-2">{SERVICE_FIELDS.slice(0, 2).map(field)}</div>
            {SERVICE_FIELDS.slice(2).map(field)}
          </>
        )}
        {group("regras-qualificacao", "Qualification", <>{QUALIFY_FIELDS.map(field)}</>)}
        {group(
          "regras-horario",
          "Hours and what never to promise",
          <>
            {HOURS_FIELDS.map(field)}
            {chips("nuncaPrometer", t("Never promise"), t("Example: {x}", { x: t("price") }))}
          </>
        )}
        {group(
          "regras-quem",
          "Who takes over",
          <>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted">{t("Person in charge")}</dt>
                <dd>{rules.responsavel.nome || t("Not defined")}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">{t("Phone of the person in charge")}</dt>
                <dd>{rules.responsavel.telefone || t("Not defined")}</dd>
              </div>
            </dl>
            {chips("resumoEquipe", t("What goes in the summary for the team"))}
            <p className="text-xs text-muted">{t("The WhatsApp alert to the person in charge is in Lead stages.")}</p>
          </>
        )}
        {group(
          "regras-mensagens",
          "Approved messages",
          rules.mensagensAprovadas.length === 0 ? (
            <p className="text-xs text-muted">{t("No approved message yet. They come from the document.")}</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {rules.mensagensAprovadas.map((m, i) => (
                <li key={i} className="rounded-md bg-surface-hover/60 p-2">
                  {m.quando && <span className="block text-xs font-semibold text-muted">{m.quando}</span>}
                  <span className="block whitespace-pre-wrap">{m.texto}</span>
                </li>
              ))}
            </ul>
          ),
          { description: t("They went in word for word. The agent uses the exact text.") }
        )}
        {group(
          "regras-casos",
          "Test cases",
          rules.casosTeste.length === 0 ? (
            <p className="text-xs text-muted">{t("No test cases yet. They come from the decision examples of the document.")}</p>
          ) : (
            <ol className="space-y-3">
              {rules.casosTeste.map((c, i) => (
                <li key={i} className="space-y-1 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <span>
                      {i + 1}. {c.situacao}
                    </span>
                    <button
                      type="button"
                      onClick={() => onRules({ ...rules, casosTeste: rules.casosTeste.filter((_, j) => j !== i) })}
                      className="shrink-0 text-xs text-error hover:underline"
                    >
                      {t("Remove")}
                    </button>
                  </div>
                  {c.decisao && <span className="block text-xs text-muted">{c.decisao}</span>}
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {DECISOES.map((d) => (
                      <label key={d} className="flex items-center gap-1 text-xs">
                        <input type="checkbox" checked={c.esperado.includes(d)} onChange={() => toggle(i, d)} className="h-3.5 w-3.5" />
                        {t(DECISION_NAMES[d])}
                      </label>
                    ))}
                  </div>
                </li>
              ))}
            </ol>
          ),
          { description: t("Test cases and the expected decision") }
        )}
      </div>
    </CollapsibleSection>
  );
}

/* ------------------------------- estágios e aviso ------------------------------- */

export function StagesPanel({
  stages,
  onStages,
  notify,
  onNotify,
}: {
  stages: Record<Estagio, ConfigEstagio>;
  onStages: (s: Record<Estagio, ConfigEstagio>) => void;
  notify: { ligado: boolean; telefone: string };
  onNotify: (n: { ligado: boolean; telefone: string }) => void;
}) {
  const t = useT();
  const hidden = ESTAGIOS.filter((e) => stages[e]?.oculto).length;
  const renamed = ESTAGIOS.filter((e) => (stages[e]?.nome ?? "").trim()).length;
  return (
    <CollapsibleSection
      id="estagios"
      title={t("Lead stages")}
      defaultOpen={false}
      summary={[
        t("{n} stages", { n: ESTAGIOS.length }),
        t("{n} renamed", { n: renamed }),
        t("{n} hidden", { n: hidden }),
        notify.ligado ? t("Alert to the person in charge on") : t("Alert to the person in charge off"),
      ].join(" · ")}
      badge={notify.ligado ? { text: t("Alert on"), tone: "success" } : null}
      description={t("The agent moves each lead by itself, following the rules above. Leave the name empty to use the standard one.")}
    >
      <ul className="space-y-2">
        {ESTAGIOS.map((e) => (
          <li key={e} className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <span className="w-48 shrink-0 text-sm">{t(NOME_ESTAGIO[e])}</span>
            <input
              value={stages[e]?.nome ?? ""}
              onChange={(ev) => onStages({ ...stages, [e]: { ...stages[e], nome: ev.target.value.slice(0, 40) } })}
              placeholder={t(NOME_ESTAGIO[e])}
              aria-label={t("Name of the stage {stage}", { stage: t(NOME_ESTAGIO[e]) })}
              className={`${INPUT} sm:flex-1`}
            />
            <label className={`flex shrink-0 items-center gap-2 text-xs ${e === "novo" ? "opacity-50" : ""}`}>
              <input
                type="checkbox"
                disabled={e === "novo"}
                checked={Boolean(stages[e]?.oculto)}
                onChange={(ev) => onStages({ ...stages, [e]: { ...stages[e], oculto: ev.target.checked } })}
                className="h-4 w-4"
              />
              {t("Hide")}
            </label>
          </li>
        ))}
      </ul>
      <div className="space-y-2 rounded-lg border border-border p-3">
        <label className="flex items-start gap-3">
          <input type="checkbox" checked={notify.ligado} onChange={(e) => onNotify({ ...notify, ligado: e.target.checked })} className="mt-0.5 h-4 w-4" />
          <span>
            <span className="block text-sm font-semibold">{t("Send the qualified lead summary to the person in charge on WhatsApp")}</span>
            <span className="block text-xs text-muted">
              {t("The summary goes out from this same number, and only if the person in charge sent a message to this number in the last 24 hours. Off by default.")}
            </span>
          </span>
        </label>
        <input
          value={notify.telefone}
          onChange={(e) => onNotify({ ...notify, telefone: e.target.value.slice(0, 30) })}
          placeholder={t("WhatsApp of the person in charge, with area code")}
          inputMode="tel"
          className={INPUT}
        />
      </div>
    </CollapsibleSection>
  );
}

/* ------------------------------- o que o agente aprendeu ------------------------------- */

function day(iso: string) {
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return "";
  }
}

export function LearningPanel({ sessionId, onChanged }: { sessionId: string; onChanged: () => void }) {
  const t = useT();
  const [report, setReport] = useState<LearningReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await api<LearningReport>(`/api/whatsapp/agents/aprendizado?sessionId=${encodeURIComponent(sessionId)}`);
    if (r.ok) {
      setReport(r.data);
      setError(null);
    } else setError(t(r.error));
  }, [sessionId, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga ao trocar de número
    void load();
  }, [load]);

  async function removeExample(id: string) {
    setBusy(true);
    const r = await api(`/api/whatsapp/agents/aprendizado/exemplos/${encodeURIComponent(id)}`, { method: "DELETE" });
    setBusy(false);
    if (!r.ok) setMsg(t(r.error));
    void load();
  }

  async function decide(id: string, action: "accept" | "reject") {
    setBusy(true);
    const r = await api<{ applied: boolean }>(`/api/whatsapp/agents/aprendizado/sugestoes/${encodeURIComponent(id)}`, { method: "POST", body: JSON.stringify({ action }) });
    setBusy(false);
    if (!r.ok) setMsg(t(r.error));
    else if (action === "accept") {
      setMsg(r.data.applied ? t("Suggestion applied. The rules or instructions were updated.") : t("Suggestion accepted."));
      onChanged();
    }
    void load();
  }

  async function generate() {
    setBusy(true);
    setMsg(null);
    const r = await api<{ created: number }>("/api/whatsapp/agents/aprendizado/sugestoes", { method: "POST", body: JSON.stringify({ sessionId }) });
    setBusy(false);
    if (!r.ok) setMsg(t(r.error));
    else setMsg(r.data.created ? t("{n} new suggestions.", { n: r.data.created }) : t("The AI found no clear pattern this time."));
    void load();
  }

  const pending = report?.suggestions.length ?? 0;
  return (
    <CollapsibleSection
      id="aprendeu"
      title={t("What the agent learned")}
      defaultOpen={false}
      attention={pending > 0 || Boolean(error)}
      badge={pending > 0 ? { text: pending === 1 ? t("1 suggestion") : t("{n} suggestions", { n: pending }), tone: "accent" } : null}
      summary={
        report
          ? [
              pending === 1 ? t("1 suggestion") : t("{n} suggestions", { n: pending }),
              t("{n} errors blocked", { n: report.blocked.total }),
              report.examples.length === 1 ? t("1 learned example") : t("{n} learned examples", { n: report.examples.length }),
            ].join(" · ")
          : undefined
      }
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className="min-w-0 text-sm text-muted">
          {t("When you edit a draft or answer in place of the agent, the answer becomes an example of how your company talks. Rules never change by themselves: only with your click.")}
        </p>
        <button type="button" onClick={() => void generate()} disabled={busy} className={`${btnSecondary} shrink-0`}>
          {busy ? t("Wait…") : t("Generate suggestions with AI")}
        </button>
      </div>
      <p className="text-xs text-muted">{t("Generating suggestions with AI has a cost, shown in AI spending.")}</p>
      {msg && <p className="text-sm" role="status">{msg}</p>}
      {error && <p className="text-sm text-error">{error}</p>}
      {!report && !error && <div className="h-24 animate-pulse rounded-lg bg-surface-hover" />}

      {report && (
        <div className="space-y-4">
          <div className="space-y-2 rounded-lg border border-accent/30 p-3">
            <p className="text-sm font-semibold">
              {t("Suggestions to change the rules")} <span className="font-normal text-muted">({report.suggestions.length})</span>
            </p>
            {report.suggestions.length === 0 ? (
              <p className="text-xs text-muted">{t("Nothing here.")}</p>
            ) : (
              <ul className="space-y-3">
                {report.suggestions.map((s) => (
                  <li key={s.id} className="space-y-2 text-sm">
                    <p>{s.text}</p>
                    <p className="text-xs text-muted">{s.origin === "ia" ? t("Suggested by the AI") : t("Counted from the conversations")}</p>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => void decide(s.id, "accept")} disabled={busy} className={`${btnPrimary} px-3 py-1.5 text-xs`}>
                        {t("Accept")}
                      </button>
                      <button type="button" onClick={() => void decide(s.id, "reject")} disabled={busy} className={`${btnSecondary} px-3 py-1.5 text-xs`}>
                        {t("Reject")}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-2 rounded-lg border border-border p-3">
            <p className="text-sm font-semibold">
              {t("Errors blocked by a rule (last 30 days)")} <span className="font-normal text-muted">({report.blocked.total})</span>
            </p>
            {report.blocked.total > 0 && <p className="text-xs text-muted">{t("{n} were fixed by the automatic correction and did not go out wrong.", { n: report.blocked.corrected })}</p>}
            {report.blocked.byRule.length > 0 && (
              <ul className="space-y-1 text-sm">
                {report.blocked.byRule.map((b) => (
                  <li key={b.rule}>
                    {t(RULE_NAMES[b.rule] ?? "Other rule")} <span className="text-muted">({b.count})</span>
                  </li>
                ))}
              </ul>
            )}
            {report.blocked.recent.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer text-xs text-muted">{t("See the latest")}</summary>
                <ul className="mt-2 space-y-2">
                  {report.blocked.recent.map((b, i) => (
                    <li key={i} className="text-xs">
                      <span className="font-medium">{(b.rule ?? "").split(",").filter(Boolean).map((r) => t(RULE_NAMES[r] ?? "Other rule")).join(", ")}</span>
                      {b.subject && <span className="text-muted"> · {b.subject}</span>}
                      <span className="text-muted"> · {b.corrected ? t("fixed") : t("became a draft")} · {day(b.createdAt)}</span>
                      {b.question && <span className="block text-muted">{b.question}</span>}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2 rounded-lg border border-border p-3">
              <p className="text-sm font-semibold">
                {t("Discarded drafts")} <span className="font-normal text-muted">({report.discarded.total})</span>
              </p>
              {report.discarded.recent.length === 0 ? (
                <p className="text-xs text-muted">{t("Nothing here.")}</p>
              ) : (
                <ul className="space-y-2 text-xs">
                  {report.discarded.recent.map((d, i) => (
                    <li key={i}>
                      {d.question && <span className="block">{d.question}</span>}
                      {d.answer && <span className="block text-muted">{d.answer}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="space-y-2 rounded-lg border border-border p-3">
              <p className="text-sm font-semibold">{t("People from outside the area")}</p>
              {report.outside.length === 0 ? (
                <p className="text-xs text-muted">{t("Nothing here.")}</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {report.outside.map((o) => (
                    <li key={o.subject}>
                      {o.subject} <span className="text-muted">({t("{n} people", { n: o.people })})</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="space-y-2 rounded-lg border border-border p-3">
            <p className="text-sm font-semibold">
              {t("Learned examples")} <span className="font-normal text-muted">({report.examples.length})</span>
            </p>
            <p className="text-xs text-muted">{t("Without phone, email, document or the contact name. The most similar ones go into the agent Comando as examples.")}</p>
            {report.examples.length === 0 ? (
              <p className="text-xs text-muted">{t("Nothing here.")}</p>
            ) : (
              <ul className="divide-y divide-border">
                {report.examples.map((e) => (
                  <li key={e.id} className="flex items-start gap-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 space-y-0.5">
                      <span className="block text-xs text-muted">
                        {e.origin === "assumir" ? t("Your answer after taking over") : t("Draft you edited")} · {day(e.createdAt)}
                      </span>
                      <span className="block">
                        <span className="font-medium">{t("Customer:")}</span> {e.question}
                      </span>
                      <span className="block">
                        <span className="font-medium">{t("Company:")}</span> {e.answer}
                      </span>
                    </span>
                    <button type="button" onClick={() => void removeExample(e.id)} disabled={busy} className="shrink-0 text-xs text-error hover:underline">
                      {t("Remove")}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </CollapsibleSection>
  );
}

/* ------------------------------------ testar o agente ------------------------------------ */

export function TestPanel({ sessionId, hasCases, dirty }: { sessionId: string; hasCases: boolean; dirty: boolean }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResultadoTeste | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    const r = await api<ResultadoTeste>("/api/whatsapp/agents/testar", { method: "POST", body: JSON.stringify({ sessionId }) });
    setBusy(false);
    if (r.ok) setResult(r.data);
    else setError(t(r.error));
  }

  const failed = result ? result.total - result.passaram : 0;
  return (
    <CollapsibleSection
      id="testar"
      title={t("Test the agent")}
      defaultOpen={false}
      attention={Boolean(error) || failed > 0}
      badge={
        result
          ? { text: t("{a} of {b} passed", { a: result.passaram, b: result.total }), tone: failed > 0 ? "warning" : "success" }
          : !hasCases
            ? { text: t("No test cases"), tone: "default" }
            : null
      }
      summary={hasCases ? t("Test cases ready. Open to run the test.") : t("There are no test cases yet. Train with a document that has decision examples.")}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className="min-w-0 text-sm text-muted">
          {t("The AI plays the customer of each test case and the Qualification agent answers with the saved rules. Nothing is sent to anyone.")}
        </p>
        <button type="button" onClick={() => void run()} disabled={busy || !hasCases} className={`${btnPrimary} shrink-0`}>
          {busy ? t("Testing…") : t("Test the agent")}
        </button>
      </div>
      {!hasCases && <p className="text-xs text-warning">{t("There are no test cases yet. Train with a document that has decision examples.")}</p>}
      {dirty && hasCases && <p className="text-xs text-warning">{t("You have changes not saved. The test uses the saved rules, so click Save first.")}</p>}
      <p className="text-xs text-muted">{t("The cost shows in AI spending as Agent test.")}</p>
      {busy && <p className="text-xs text-muted" role="status">{t("This can take up to 2 minutes. Keep this page open.")}</p>}
      {error && <p className="text-sm text-error">{error}</p>}
      {result && (
        <div className="space-y-3">
          <p className={`text-sm font-semibold ${result.passaram === result.total ? "text-success" : "text-warning"}`}>
            {t("{a} of {b} passed", { a: result.passaram, b: result.total })}
            <span className="ml-2 font-normal text-muted">US$ {(result.custoUsdMicro / 1e6).toFixed(4)}</span>
          </p>
          {result.parouNoTeto && <p className="text-xs text-warning">{t("The daily AI spending cap stopped the test in the middle.")}</p>}
          <ol className="space-y-3">
            {result.casos.map((c, i) => (
              <li key={i} className={`space-y-1 rounded-lg border p-3 text-sm ${c.passou ? "border-success/30" : "border-error/30 bg-error/5"}`}>
                <p className="font-medium">
                  <span className={c.passou ? "text-success" : "text-error"}>{c.passou ? t("Passed") : t("Failed")}</span> · {c.situacao}
                </p>
                <p className="text-xs">
                  <span className="font-semibold">{t("Expected:")}</span> {c.esperado.map((d) => t(DECISION_NAMES[d] ?? d)).join(" / ")} ·{" "}
                  <span className="font-semibold">{t("Got:")}</span> {t(DECISION_NAMES[c.obtido] ?? c.obtido)}
                </p>
                {c.motivo && <p className="text-xs text-muted">{c.motivo}</p>}
                {c.regras.length > 0 && (
                  <ul className="space-y-0.5 text-xs">
                    {c.regras.map((r, j) => (
                      <li key={j}>
                        {t(RULE_NAMES[r.regra] ?? "Other rule")} · <span className={r.corrigida ? "text-success" : "text-error"}>{r.corrigida ? t("fixed") : t("not fixed")}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted">{t("See the simulated conversation")}</summary>
                  <ul className="mt-2 space-y-1">
                    {c.conversa.map((m, j) => (
                      <li key={j} className="whitespace-pre-wrap">
                        <span className="font-semibold">{m.de === "cliente" ? t("Customer:") : t("Agent:")}</span> {m.texto}
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            ))}
          </ol>
        </div>
      )}
    </CollapsibleSection>
  );
}
