"use client";

/**
 * Canais > Conexões e chaves (06/10/2026). Pedido do dono: "preciso que as
 * apis e conexões fiquem tudo em canais para colocar as chaves".
 *
 * Um cartão por serviço: uazapi, gateway OpenWA, API oficial (em breve), Pixel
 * e API de Conversões da Meta (o mesmo painel que ficava em Configurações) e,
 * só pro admin da plataforma, o status das chaves de IA com atalho pro /admin.
 *
 * A tela nunca recebe o valor de uma chave: só "salvo", os 4 últimos
 * caracteres, quem trocou e quando. Trocar e Remover pedem confirmação.
 */

import { useCallback, useEffect, useState } from "react";
import { useT } from "@/components/lang-provider";
import { useDateTime } from "@/components/contact-ui";
import { MetaCapiPanel } from "@/components/meta-capi-panel";
import { CollapsibleSection, type SectionBadge } from "@/components/ui/collapsible-section";

type Kind = "url" | "secret" | "number";
type Source = "workspace" | "env" | "none";

export interface FieldView {
  field: string;
  kind: Kind;
  saved: boolean;
  last4: string | null;
  number: number | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface ServiceView {
  service: "uazapi" | "openwa";
  fields: FieldView[];
  source: Source;
  workspaceComplete: boolean;
  envConfigured: boolean;
}

export interface AuditView {
  service: string;
  field: string | null;
  action: string;
  actor: string | null;
  createdAt: string;
}

export interface IntegrationsData {
  services: ServiceView[];
  audit: AuditView[];
  whatsappEnabled: boolean;
  ai: Record<string, boolean> | null;
}

type TestResult = { ok: boolean; code: string; source: "workspace" | "env" | null; instances?: number; checkedAt: string };

/** Texto de cada campo (rótulo, exemplo e dica). Inglês é a chave do i18n. */
export const FIELD_TEXT: Record<string, Record<string, { label: string; placeholder: string; hint?: string }>> = {
  uazapi: {
    serverUrl: { label: "Server URL", placeholder: "https://yourname.uazapi.com" },
    adminToken: { label: "Admin token", placeholder: "Paste the Admin token here" },
    maxInstances: {
      label: "Devices in your plan",
      placeholder: "2",
      hint: "How many WhatsApp numbers your uazapi plan allows. Empty uses 2.",
    },
  },
  openwa: {
    baseUrl: { label: "Gateway URL", placeholder: "https://gateway.yourdomain.com" },
    apiKey: { label: "Operator key", placeholder: "Paste the operator key here" },
  },
};

export const SERVICE_TEXT: Record<ServiceView["service"], { title: string; where: string }> = {
  uazapi: {
    title: "WhatsApp · uazapi",
    where: "Where to get it: in the uazapi panel, copy the Server URL and the Admin Token.",
  },
  openwa: {
    title: "WhatsApp · OpenWA gateway",
    where: "Where to get it: in your OpenWA gateway, copy its https address and an API key with the operator role.",
  },
};

/** Erro do servidor → frase simples. */
export function integrationErrorText(t: (s: string) => string, code: string | undefined): string {
  switch (code) {
    case "url_invalid":
      return t("This address does not look right. Copy it again, starting with https://");
    case "url_not_https":
      return t("Use an address that starts with https://");
    case "url_internal":
      return t("This address points to an internal network. Use the public https address of the service.");
    case "secret_invalid":
      return t("This key does not look right. Copy it again, without spaces.");
    case "number_invalid":
      return t("Type a whole number from 1 to 100.");
    case "rate_limited":
      return t("Too many tries. Wait a few minutes and try again.");
    case "forbidden":
      return t("Only owners and admins can change this.");
    case "human_only":
      return t("API keys cannot change this. Do it here, signed in.");
    default:
      return t("Could not save. Try again.");
  }
}

/** Resultado do Testar conexão → frase simples. */
export function testResultText(t: (s: string, v?: Record<string, string | number>) => string, result: TestResult): string {
  switch (result.code) {
    case "ok":
      return result.instances === 1
        ? t("Connection OK. The server has 1 number created.")
        : result.instances != null
        ? t("Connection OK. The server has {n} numbers created.", { n: result.instances })
        : t("Connection OK.");
    case "not_configured":
      return t("Nothing configured yet. Save the address and the key first.");
    case "unauthorized":
      return t("The service refused the key. Check if you copied the right one.");
    case "timeout":
      return t("The service took too long to answer. Try again in a moment.");
    case "unreachable":
      return t("Could not reach this address. Check the URL.");
    case "url_blocked":
      return t("This address points to an internal network. Use the public https address of the service.");
    default:
      return t("The service answered something unexpected. Check the URL.");
  }
}

const inputClass =
  "w-full rounded border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-accent/40";
const btn = "inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50";
const btnPrimary = `${btn} bg-accent text-white hover:bg-accent-hover`;
const btnSecondary = `${btn} border border-border text-foreground hover:bg-surface-hover`;
const btnDanger = `${btn} border border-error/30 text-error hover:bg-error/10`;

export function IntegrationsPanel({ initial = null }: { initial?: IntegrationsData | null }) {
  const t = useT();
  const [data, setData] = useState<IntegrationsData | null>(initial);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      fetch("/api/channels/integrations", { cache: "no-store" })
        .then((res) => res.json())
        .then((payload) => {
          if (payload?.success) {
            setData(payload.data);
            setError(null);
          } else setError(payload?.code ?? "error");
        })
        .catch(() => setError("error")),
    []
  );

  useEffect(() => {
    if (!initial) void load();
  }, [initial, load]);

  return (
    <CollapsibleSection
      id="conexoes"
      title={t("Connections and keys")}
      attention={Boolean(error) || Boolean(data?.services.some((s) => !s.workspaceComplete && s.fields.some((f) => f.saved && f.kind !== "number")))}
      summary={
        data
          ? data.services.map((s) => `${t(SERVICE_TEXT[s.service].title)}: ${t(sourceBadge(s).text)}`).join(" · ")
          : undefined
      }
      description={t("Paste and change here the keys of the services the Lead Engine uses. What you save here counts before the server settings. Keys are saved encrypted and never show again: you only see the last 4 characters.")}
    >

      {error && (
        <div className="rounded-xl border border-error/20 bg-error/10 p-4 text-sm text-error">
          {t("Could not load the keys. Try again in a moment.")}
        </div>
      )}
      {!data && !error && <div className="panel h-40 animate-pulse rounded-xl" />}

      {data && (
        <>
          <div
            className={`rounded-lg border px-3 py-2 text-sm ${
              data.whatsappEnabled ? "border-success/25 bg-success/10" : "border-warning/30 bg-warning/10"
            }`}
          >
            <span className="font-semibold">{t("WhatsApp on the server:")}</span>{" "}
            {data.whatsappEnabled
              ? t("on.")
              : t("off. The server owner turns it on with WHATSAPP_ENABLED=1. The keys below can be saved now and start working when it is on.")}
          </div>

          {data.services.map((service) => (
            <ServiceCard key={service.service} service={service} onChanged={load} />
          ))}

          <CollapsibleSection
            id="conexao-oficial"
            variant="group"
            hideFromIndex
            defaultOpen={false}
            title={t("WhatsApp · Official API (Cloud API)")}
            badge={{ text: t("Coming soon") }}
            summary={t("Coming after Meta approves the app. There is nothing to paste here yet.")}
          >
            <p className="text-sm text-muted">{t("Coming after Meta approves the app. There is nothing to paste here yet.")}</p>
          </CollapsibleSection>

          <MetaCapiPanel />

          {data.ai && <AiStatusCard ai={data.ai} />}

          {data.audit.length > 0 && <AuditList audit={data.audit} />}
        </>
      )}
    </CollapsibleSection>
  );
}

/** De onde vem a configuração do serviço (texto em inglês = chave do i18n). */
function sourceBadge(service: ServiceView): SectionBadge {
  if (service.source === "workspace") return { text: "Using what you saved here", tone: "success" };
  if (service.source === "env") return { text: "Using the server settings", tone: "default" };
  return { text: "Not configured", tone: "warning" };
}

function ServiceCard({ service, onChanged }: { service: ServiceView; onChanged: () => Promise<void> }) {
  const t = useT();
  const text = SERVICE_TEXT[service.service];
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const partial = !service.workspaceComplete && service.fields.some((f) => f.saved && f.kind !== "number");

  async function runTest() {
    setTesting(true);
    setTestError(null);
    try {
      const res = await fetch(`/api/channels/integrations/${service.service}/test`, { method: "POST" });
      const payload = await res.json().catch(() => null);
      if (payload?.success) setTest(payload.data);
      else setTestError(payload?.code === "rate_limited" ? t("Too many tries. Wait a few minutes and try again.") : t("The test failed."));
    } catch {
      setTestError(t("The test failed."));
    } finally {
      setTesting(false);
    }
  }

  return (
    <CollapsibleSection
      id={`conexao-${service.service}`}
      variant="group"
      hideFromIndex
      title={t(text.title)}
      defaultOpen={service.source === "none" || partial}
      attention={partial}
      badge={{ ...sourceBadge(service), text: t(sourceBadge(service).text) }}
      summary={service.fields
        .filter((f) => f.kind !== "number")
        .map((f) => (f.saved ? t("{field} saved", { field: t(FIELD_TEXT[service.service]?.[f.field]?.label ?? f.field) }) : t("{field} missing", { field: t(FIELD_TEXT[service.service]?.[f.field]?.label ?? f.field) })))
        .join(" · ")}
    >
      <p className="text-sm text-muted">{t(text.where)}</p>
      {partial && (
        <p className="mt-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs">
          {t("Fill in the address and the key here. Until both are saved, the server settings keep counting.")}
        </p>
      )}

      <div className="mt-4 divide-y divide-border">
        {service.fields.map((field) => (
          <FieldRow key={field.field} service={service.service} field={field} onChanged={onChanged} />
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <button type="button" onClick={runTest} disabled={testing} className={btnSecondary}>
          {testing ? t("Testing...") : t("Test connection")}
        </button>
        {test && (
          <p role="status" className={`text-sm ${test.ok ? "text-success" : "text-error"}`}>
            {testResultText(t, test)}
            {test.source && (
              <span className="ml-1 text-xs text-muted">
                ({test.source === "workspace" ? t("with what you saved here") : t("with the server settings")})
              </span>
            )}
          </p>
        )}
        {testError && <p className="text-sm text-error">{testError}</p>}
      </div>
    </CollapsibleSection>
  );
}

function FieldRow({ service, field, onChanged }: { service: string; field: FieldView; onChanged: () => Promise<void> }) {
  const t = useT();
  const dateTime = useDateTime();
  const text = FIELD_TEXT[service]?.[field.field] ?? { label: field.field, placeholder: "" };
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [confirming, setConfirming] = useState<"replace" | "remove" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = `int-${service}-${field.field}`;

  async function save() {
    if (field.saved && confirming !== "replace") {
      setConfirming("replace");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/channels/integrations/${service}/${field.field}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      });
      const payload = await res.json().catch(() => null);
      if (payload?.success) {
        setValue("");
        setEditing(false);
        setConfirming(null);
        await onChanged();
      } else {
        setError(integrationErrorText(t, payload?.code));
        setConfirming(null);
      }
    } catch {
      setError(t("Could not save. Try again."));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/channels/integrations/${service}/${field.field}`, { method: "DELETE" });
      const payload = await res.json().catch(() => null);
      if (payload?.success) {
        setConfirming(null);
        await onChanged();
      } else setError(integrationErrorText(t, payload?.code));
    } catch {
      setError(t("Could not save. Try again."));
    } finally {
      setBusy(false);
    }
  }

  const showInput = !field.saved || editing;
  const savedText =
    field.kind === "number"
      ? t("Saved: {n}", { n: field.number ?? "" })
      : t("Saved, ends in ••••{last4}", { last4: field.last4 ?? "" });

  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <label htmlFor={inputId} className="block text-sm font-medium text-foreground">
        {t(text.label)}
      </label>
      {text.hint && <p className="text-xs text-muted">{t(text.hint)}</p>}

      {field.saved && !editing && (
        <div className="mt-1.5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm">{savedText}</p>
            {field.updatedAt && (
              <p className="text-xs text-muted">
                {field.updatedBy
                  ? t("Changed by {who} on {when}", { who: field.updatedBy, when: dateTime(field.updatedAt) })
                  : t("Changed on {when}", { when: dateTime(field.updatedAt) })}
              </p>
            )}
          </div>
          <div className="flex shrink-0 gap-2">
            <button type="button" onClick={() => setEditing(true)} className={btnSecondary}>
              {t("Change")}
            </button>
            <button type="button" onClick={() => setConfirming("remove")} className={btnDanger}>
              {t("Remove")}
            </button>
          </div>
        </div>
      )}

      {showInput && (
        <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
          <input
            id={inputId}
            type={field.kind === "secret" ? "password" : field.kind === "number" ? "number" : "url"}
            inputMode={field.kind === "number" ? "numeric" : undefined}
            min={field.kind === "number" ? 1 : undefined}
            max={field.kind === "number" ? 100 : undefined}
            autoComplete={field.kind === "secret" ? "new-password" : "off"}
            spellCheck={false}
            autoCapitalize="none"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t(text.placeholder)}
            className={inputClass}
          />
          <div className="flex shrink-0 gap-2">
            <button type="button" onClick={() => void save()} disabled={busy || !value.trim()} className={btnPrimary}>
              {busy ? t("Saving...") : t("Save")}
            </button>
            {editing && (
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setValue("");
                  setConfirming(null);
                }}
                className={btnSecondary}
              >
                {t("Cancel")}
              </button>
            )}
          </div>
        </div>
      )}

      {confirming && (
        <div className="mt-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          <p className="font-semibold">
            {confirming === "replace" ? t("Replace the saved value?") : t("Remove the saved value?")}
          </p>
          <p className="mt-0.5 text-muted">
            {confirming === "replace"
              ? t("The old value stops working right away. Numbers already connected keep their conversations.")
              : t("Without it, the server settings count again (if there are any). Nothing else is deleted.")}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => void (confirming === "replace" ? save() : remove())}
              disabled={busy}
              className={confirming === "replace" ? btnPrimary : `${btn} bg-error text-white hover:opacity-90`}
            >
              {confirming === "replace" ? t("Yes, replace") : t("Yes, remove")}
            </button>
            <button type="button" onClick={() => setConfirming(null)} disabled={busy} className={btnSecondary}>
              {t("Cancel")}
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-1.5 text-sm text-error">{error}</p>}
    </div>
  );
}

const AI_LABEL: Record<string, string> = { anthropic: "Claude (Anthropic)", openai: "OpenAI", typesafe: "TypeSafe" };

function AiStatusCard({ ai }: { ai: Record<string, boolean> }) {
  const t = useT();
  return (
    <CollapsibleSection
      id="conexao-ia"
      variant="group"
      hideFromIndex
      defaultOpen={false}
      title={t("AI keys (platform)")}
      badge={{ text: t("Only you see this") }}
      summary={Object.entries(ai)
        .map(([provider, configured]) => `${AI_LABEL[provider] ?? provider}: ${configured ? t("Configured") : t("Not configured")}`)
        .join(" · ")}
    >
      <p className="text-sm text-muted">
        {t("These keys are for the whole platform, not only this workspace. You change them in Admin, AI keys.")}
      </p>
      <ul className="mt-3 space-y-1.5 text-sm">
        {Object.entries(ai).map(([provider, configured]) => (
          <li key={provider} className="flex items-center justify-between gap-3">
            <span>{AI_LABEL[provider] ?? provider}</span>
            <span className={`text-xs font-semibold ${configured ? "text-success" : "text-warning"}`}>
              {configured ? t("Configured") : t("Not configured")}
            </span>
          </li>
        ))}
      </ul>
      <a href="/admin#chaves-ia" className={`${btnSecondary} mt-4`}>
        {t("Open AI keys in Admin")}
      </a>
    </CollapsibleSection>
  );
}

const ACTION_TEXT: Record<string, string> = {
  saved: "saved",
  replaced: "replaced",
  removed: "removed",
  tested: "tested the connection of",
};

function AuditList({ audit }: { audit: AuditView[] }) {
  const t = useT();
  const dateTime = useDateTime();
  return (
    <CollapsibleSection
      id="conexao-historico"
      variant="group"
      hideFromIndex
      defaultOpen={false}
      title={t("Recent changes")}
      badge={{ text: String(audit.length) }}
      summary={audit[0] ? dateTime(audit[0].createdAt) : undefined}
    >
      <ul className="space-y-1.5 text-sm">
        {audit.map((a, i) => {
          const fieldLabel = a.field ? FIELD_TEXT[a.service]?.[a.field]?.label : null;
          const serviceLabel = SERVICE_TEXT[a.service as ServiceView["service"]]?.title ?? a.service;
          return (
            <li key={`${a.createdAt}-${i}`} className="flex flex-col sm:flex-row sm:justify-between sm:gap-3">
              <span>
                {t("{who} {action} {what}", {
                  who: a.actor ?? t("Someone"),
                  action: t(ACTION_TEXT[a.action] ?? a.action),
                  what: fieldLabel ? `${t(fieldLabel)} (${t(serviceLabel)})` : t(serviceLabel),
                })}
              </span>
              <span className="text-xs text-muted">{dateTime(a.createdAt)}</span>
            </li>
          );
        })}
      </ul>
    </CollapsibleSection>
  );
}
