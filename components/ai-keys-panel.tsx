"use client";

/**
 * /admin > Chaves de IA (06/10/2026). Uma chave por provedor, usada por todos
 * os usuários do beta. Depois de salva, a tela só mostra "termina em ••••abcd"
 * (a API nunca devolve a chave). Testar, trocar, remover, modelo de cada
 * agente, tetos diários, tabela de preços e cotação do dólar.
 */
import { useCallback, useEffect, useState } from "react";
import { useT } from "@/components/lang-provider";

type Provider = "anthropic" | "openai" | "typesafe";
type ChatProvider = "anthropic" | "openai";
type Agent = "qualificacao" | "atendimento" | "suporte";

type Credential = { provider: Provider; keyLast4: string; active: boolean; updatedAt: string };
type Price = { provider: Provider; input: number; output: number; cacheRead: number; cacheWrite: number };
type AgentCfg = { provider: ChatProvider; model: string; hardModel: string };
type Settings = {
  agents: Record<Agent, AgentCfg>;
  dailyCapUserUsd: number;
  dailyCapWorkspaceUsd: number;
  prices: Record<string, Price>;
  usdToBrl: number | null;
};
type Data = { providers: Provider[]; credentials: Credential[]; settings: Settings };
type TestResult = { ok: boolean; message: string; detail?: string | null };

const INPUT = "h-9 w-full rounded-md border border-border bg-[#fafafa] px-3 text-sm focus:border-accent focus:bg-white";
const BUTTON = "h-9 rounded-lg bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-60";
const LINK = "text-sm font-semibold text-accent hover:underline disabled:opacity-60";

const PROVIDER_NAME: Record<Provider, string> = {
  anthropic: "Claude (Anthropic)",
  openai: "OpenAI",
  typesafe: "TypeSafe (Jev)",
};
const AGENTS: Agent[] = ["qualificacao", "atendimento", "suporte"];

function ProviderKey({
  provider,
  credential,
  onChange,
}: {
  provider: Provider;
  credential: Credential | undefined;
  onChange: () => void;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; detail?: string | null } | null>(null);

  async function call(method: string, path: string, body?: unknown): Promise<{ success: boolean; data?: unknown; error?: string }> {
    try {
      const res = await fetch(path, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      return (await res.json().catch(() => null)) ?? { success: false, error: "Could not save. Try again." };
    } catch {
      return { success: false, error: "Could not reach the server. Try again." };
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy("save");
    setMsg(null);
    const res = await call("PUT", `/api/admin/ai/credentials/${provider}`, { key });
    setBusy(null);
    if (!res.success) return setMsg({ ok: false, text: t(res.error ?? "Could not save. Try again.") });
    setKey("");
    setEditing(false);
    setMsg({ ok: true, text: t("Key saved.") });
    onChange();
  }

  async function test() {
    setBusy("test");
    setMsg(null);
    const res = await call("POST", `/api/admin/ai/credentials/${provider}/test`, key ? { key } : {});
    setBusy(null);
    if (!res.success) return setMsg({ ok: false, text: t(res.error ?? "Could not test. Try again.") });
    const r = res.data as TestResult;
    setMsg({ ok: r.ok, text: t(r.message), detail: r.detail });
  }

  async function remove() {
    if (!confirm(t("Remove the {provider} key? The agents that use it stop until you save a new one.", { provider: PROVIDER_NAME[provider] }))) return;
    setBusy("remove");
    setMsg(null);
    const res = await call("DELETE", `/api/admin/ai/credentials/${provider}`);
    setBusy(null);
    if (!res.success) return setMsg({ ok: false, text: t(res.error ?? "Could not remove. Try again.") });
    setMsg({ ok: true, text: t("Key removed.") });
    onChange();
  }

  const showForm = !credential || editing;
  return (
    <li className="space-y-2 px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold">{PROVIDER_NAME[provider]}</span>
        {credential ? (
          <span className="text-sm text-muted">{t("ends in ••••{last4}", { last4: credential.keyLast4 })}</span>
        ) : (
          <span className="text-sm text-muted">{t("No key yet")}</span>
        )}
      </div>
      {showForm && (
        <form onSubmit={save} className="flex flex-wrap gap-2">
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={t("Paste the key here")}
            aria-label={t("{provider} key", { provider: PROVIDER_NAME[provider] })}
            className={`${INPUT} min-w-0 flex-1`}
          />
          <button type="submit" disabled={!key.trim() || busy !== null} className={BUTTON}>
            {busy === "save" ? t("Saving...") : t("Save")}
          </button>
          {editing && (
            <button type="button" onClick={() => { setEditing(false); setKey(""); }} className={LINK}>
              {t("Cancel")}
            </button>
          )}
        </form>
      )}
      <div className="flex flex-wrap gap-4">
        {(credential || key.trim()) && (
          <button type="button" onClick={test} disabled={busy !== null} className={LINK}>
            {busy === "test" ? t("Testing...") : t("Test")}
          </button>
        )}
        {credential && !editing && (
          <button type="button" onClick={() => setEditing(true)} disabled={busy !== null} className={LINK}>
            {t("Replace")}
          </button>
        )}
        {credential && (
          <button type="button" onClick={remove} disabled={busy !== null} className="text-sm font-semibold text-red-600 hover:underline disabled:opacity-60">
            {t("Remove")}
          </button>
        )}
      </div>
      {msg && (
        <p className={`text-sm ${msg.ok ? "text-green-700" : "text-red-600"}`} role="status">
          {msg.text}
          {msg.detail && <span className="block text-xs text-muted">{t("Provider said: {detail}", { detail: msg.detail })}</span>}
        </p>
      )}
    </li>
  );
}

function SettingsForm({ initial, onSaved }: { initial: Settings; onSaved: () => void }) {
  const t = useT();
  const [s, setS] = useState<Settings>(initial);
  const [prices, setPrices] = useState<Array<{ model: string } & Price>>(
    Object.entries(initial.prices).map(([model, p]) => ({ model, ...p }))
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const pricesMap: Record<string, Price> = Object.fromEntries(
    prices.filter((p) => p.model.trim()).map(({ model, ...p }) => [model.trim(), p])
  );
  const modelsFor = (provider: ChatProvider) =>
    Object.entries(pricesMap)
      .filter(([m, p]) => p.provider === provider && !m.includes("embedding"))
      .map(([m]) => m);

  function setAgent(agent: Agent, patch: Partial<AgentCfg>) {
    setS((cur) => {
      const next = { ...cur.agents[agent], ...patch };
      if (patch.provider) {
        const list = modelsFor(patch.provider);
        if (!list.includes(next.model)) next.model = list[0] ?? "";
        if (!list.includes(next.hardModel)) next.hardModel = list[list.length - 1] ?? "";
      }
      return { ...cur, agents: { ...cur.agents, [agent]: next } };
    });
  }

  function setPrice(i: number, patch: Partial<{ model: string } & Price>) {
    setPrices((cur) => cur.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/ai/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...s, prices: pricesMap }),
      });
      const payload = await res.json().catch(() => null);
      if (!payload?.success) setMsg({ ok: false, text: t(payload?.error ?? "Could not save. Try again.") });
      else {
        setMsg({ ok: true, text: t("Settings saved.") });
        onSaved();
      }
    } catch {
      setMsg({ ok: false, text: t("Could not reach the server. Try again.") });
    } finally {
      setBusy(false);
    }
  }

  const agentName: Record<Agent, string> = {
    qualificacao: t("Qualification"),
    atendimento: t("Customer service"),
    suporte: t("Support"),
  };

  return (
    <form onSubmit={save} className="space-y-6">
      <div>
        <h3 className="mb-2 text-sm font-semibold">{t("Model of each agent")}</h3>
        <p className="mb-3 text-sm text-muted">
          {t("The everyday model answers most messages. The hard case model only comes in when the conversation is hard or the Jev is unsure.")}
        </p>
        <div className="space-y-3">
          {AGENTS.map((agent) => {
            const cfg = s.agents[agent];
            const list = modelsFor(cfg.provider);
            return (
              <div key={agent} className="grid gap-2 sm:grid-cols-4 sm:items-center">
                <span className="text-sm font-semibold">{agentName[agent]}</span>
                <select
                  aria-label={t("Provider of {agent}", { agent: agentName[agent] })}
                  value={cfg.provider}
                  onChange={(e) => setAgent(agent, { provider: e.target.value as ChatProvider })}
                  className={INPUT}
                >
                  <option value="anthropic">{PROVIDER_NAME.anthropic}</option>
                  <option value="openai">{PROVIDER_NAME.openai}</option>
                </select>
                <select
                  aria-label={t("Everyday model of {agent}", { agent: agentName[agent] })}
                  value={cfg.model}
                  onChange={(e) => setAgent(agent, { model: e.target.value })}
                  className={INPUT}
                >
                  {list.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                <select
                  aria-label={t("Hard case model of {agent}", { agent: agentName[agent] })}
                  value={cfg.hardModel}
                  onChange={(e) => setAgent(agent, { hardModel: e.target.value })}
                  className={INPUT}
                >
                  {list.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">{t("Daily spending caps")}</h3>
        <p className="mb-3 text-sm text-muted">
          {t("When the day's spending reaches the cap, the agent stops calling the AI until midnight (Brasília time). At 80% a warning shows up here.")}
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm">
            <span className="mb-1 block text-muted">{t("Per user (US$ per day)")}</span>
            <input type="number" min={0} step="0.01" value={s.dailyCapUserUsd}
              onChange={(e) => setS({ ...s, dailyCapUserUsd: Number(e.target.value) })} className={INPUT} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted">{t("Per workspace (US$ per day)")}</span>
            <input type="number" min={0} step="0.01" value={s.dailyCapWorkspaceUsd}
              onChange={(e) => setS({ ...s, dailyCapWorkspaceUsd: Number(e.target.value) })} className={INPUT} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted">{t("Dollar rate in R$ (optional)")}</span>
            <input type="number" min={0} step="0.01" value={s.usdToBrl ?? ""} placeholder={t("Only dollars")}
              onChange={(e) => setS({ ...s, usdToBrl: e.target.value === "" ? null : Number(e.target.value) })} className={INPUT} />
          </label>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">{t("Price table")}</h3>
        <p className="mb-3 text-sm text-muted">
          {t("Dollars per 1 million tokens. Prices change: check the Anthropic, OpenAI and TypeSafe pages and edit here. Each call keeps the price of the moment it happened.")}
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="py-1 pr-2">{t("Model")}</th>
                <th className="py-1 pr-2">{t("Provider")}</th>
                <th className="py-1 pr-2">{t("Input")}</th>
                <th className="py-1 pr-2">{t("Output")}</th>
                <th className="py-1 pr-2">{t("Cache read")}</th>
                <th className="py-1 pr-2">{t("Cache write")}</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {prices.map((p, i) => (
                <tr key={i}>
                  <td className="py-1 pr-2">
                    <input aria-label={t("Model")} value={p.model} onChange={(e) => setPrice(i, { model: e.target.value })} className={`${INPUT} min-w-[11rem]`} />
                  </td>
                  <td className="py-1 pr-2">
                    <select aria-label={t("Provider")} value={p.provider} onChange={(e) => setPrice(i, { provider: e.target.value as Provider })} className={INPUT}>
                      <option value="anthropic">Anthropic</option>
                      <option value="openai">OpenAI</option>
                      <option value="typesafe">TypeSafe</option>
                    </select>
                  </td>
                  {(["input", "output", "cacheRead", "cacheWrite"] as const).map((k) => (
                    <td key={k} className="py-1 pr-2">
                      <input type="number" min={0} step="0.001" aria-label={k} value={p[k]}
                        onChange={(e) => setPrice(i, { [k]: Number(e.target.value) })} className={`${INPUT} w-24`} />
                    </td>
                  ))}
                  <td className="py-1">
                    <button type="button" onClick={() => setPrices((cur) => cur.filter((_, j) => j !== i))} className="text-sm font-semibold text-red-600 hover:underline">
                      {t("Remove")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          type="button"
          onClick={() => setPrices((cur) => [...cur, { model: "", provider: "anthropic", input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }])}
          className={`${LINK} mt-2`}
        >
          {t("Add model")}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} className={BUTTON}>
          {busy ? t("Saving...") : t("Save settings")}
        </button>
        {msg && <span className={`text-sm ${msg.ok ? "text-green-700" : "text-red-600"}`} role="status">{msg.text}</span>}
      </div>
    </form>
  );
}

async function fetchAdminAi(): Promise<Data | null> {
  try {
    const res = await fetch("/api/admin/ai", { cache: "no-store" });
    const payload = await res.json().catch(() => null);
    return payload?.success ? (payload.data as Data) : null;
  } catch {
    return null;
  }
}

export function AiKeysPanel() {
  const t = useT();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState(false);
  const [version, setVersion] = useState(0);

  const apply = useCallback((d: Data | null) => {
    setError(!d);
    if (d) setData(d);
  }, []);
  const load = useCallback(() => fetchAdminAi().then(apply), [apply]);

  useEffect(() => {
    fetchAdminAi().then(apply);
  }, [apply]);

  if (error) return <p className="text-sm text-red-600">{t("Could not load the AI keys. Check the database roles (docs/ia-chaves-e-gastos.md).")}</p>;
  if (!data) return <p className="text-sm text-muted">{t("Loading...")}</p>;

  const byProvider = Object.fromEntries(data.credentials.map((c) => [c.provider, c])) as Partial<Record<Provider, Credential>>;
  return (
    <div className="space-y-6">
      <ul className="divide-y divide-border rounded-lg border border-border">
        {data.providers.map((p) => (
          <ProviderKey key={p} provider={p} credential={byProvider[p]} onChange={() => void load()} />
        ))}
      </ul>
      <SettingsForm key={version} initial={data.settings} onSaved={() => { void load().then(() => setVersion((v) => v + 1)); }} />
    </div>
  );
}
