"use client";

import { useEffect, useState } from "react";

import { useT } from "@/components/lang-provider";
interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

interface ApiKeysData {
  tokens: ApiKey[];
  mcpUrl: string;
  envTokenConfigured: boolean;
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "never";
}

/**
 * Settings section for workspace API keys (scripts and the MCP endpoint).
 * A new key is shown once, right after it is created; only its hash is kept.
 */
export function ApiKeysPanel() {
  const t = useT();
  const [data, setData] = useState<ApiKeysData | null>(null);
  const [name, setName] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadKeys() {
    const res = await fetch("/api/workspace/api-tokens");
    return res.json().catch(() => null);
  }

  async function refresh() {
    const payload = await loadKeys();
    if (payload?.success) setData(payload.data);
    else setError(payload?.error ?? "Could not load API keys");
  }

  useEffect(() => {
    loadKeys().then((payload) => {
      if (payload?.success) setData(payload.data);
      else setError(payload?.error ?? "Could not load API keys");
    });
  }, []);

  async function createKey(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy("create");
    const res = await fetch("/api/workspace/api-tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const payload = await res.json().catch(() => null);
    setBusy(null);
    if (!payload?.success) {
      setError(payload?.error ?? "Could not create the key");
      return;
    }
    setNewKey(payload.data.token);
    setName("");
    await refresh();
  }

  async function revokeKey(key: ApiKey) {
    if (!confirm(`Revoke "${key.name}"? Anything using this key stops working right away.`)) {
      return;
    }
    setBusy(`revoke:${key.id}`);
    await fetch(`/api/workspace/api-tokens?id=${encodeURIComponent(key.id)}`, {
      method: "DELETE",
    });
    setBusy(null);
    await refresh();
  }

  return (
    <section className="panel rounded p-4 sm:p-6">
      <h2 className="text-base font-semibold mb-2">{t("API & MCP")}</h2>
      <p className="mb-6 text-sm text-muted">
        {t("Keys for scripts and AI agents (MCP). Send them as")}{" "}
        <code className="text-foreground">{t("Authorization: Bearer <key>")}</code>{t(". A key reads, creates things turned off and proposes drafts. Turning on, sending, deleting and managing members or keys stay with a person.")}
      </p>

      {data && (
        <div className="mb-6 flex flex-col gap-2 rounded border border-border bg-surface/70 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs text-muted">{t("MCP endpoint")}</p>
            <p className="truncate text-sm font-medium text-foreground">{data.mcpUrl}</p>
          </div>
          <button
            type="button"
            onClick={() => void navigator.clipboard?.writeText(data.mcpUrl)}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-border-hover hover:text-foreground"
          >
            {t("Copy")}
          </button>
        </div>
      )}

      {newKey && (
        <div className="mb-6 rounded border border-accent/40 bg-accent/10 p-3">
          <p className="mb-2 text-sm font-medium text-foreground">
            {t("Copy your new key now. It will not be shown again.")}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <code className="min-w-0 flex-1 truncate rounded border border-border bg-surface px-3 py-2 text-xs text-foreground">
              {newKey}
            </code>
            <button
              type="button"
              onClick={() => void navigator.clipboard?.writeText(newKey)}
              className="rounded bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
            >
              {t("Copy key")}
            </button>
            <button
              type="button"
              onClick={() => setNewKey(null)}
              className="rounded-lg border border-border px-3 py-2 text-xs font-medium text-muted transition-colors hover:text-foreground"
            >
              {t("Done")}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {data?.tokens.map((key) => (
          <div
            key={key.id}
            className="flex flex-col gap-3 rounded border border-border bg-surface/70 p-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{key.name}</p>
              <p className="truncate text-xs text-muted">
                {key.prefix}{t("… · created")} {formatDate(key.createdAt)} {t("· last used")}{" "}
                {formatDate(key.lastUsedAt)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void revokeKey(key)}
              disabled={busy === `revoke:${key.id}`}
              className="rounded-lg border border-error/20 px-3 py-1.5 text-xs font-medium text-error transition-colors hover:bg-error/10 disabled:opacity-50"
            >
              {t("Revoke")}
            </button>
          </div>
        ))}
        {data && data.tokens.length === 0 && (
          <p className="text-sm text-muted">{t("No keys created here yet.")}</p>
        )}
        {data?.envTokenConfigured && (
          <p className="text-xs text-muted">
            {t("A key is also set on the server (OPENREPLY_API_TOKEN). It keeps working until it is removed from the server environment.")}
          </p>
        )}
      </div>

      <form
        onSubmit={createKey}
        className="mt-6 grid gap-3 border-t border-border pt-4 sm:grid-cols-[1fr_auto]"
      >
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t("Key name, e.g. Claude on my Mac")}
          maxLength={60}
          className="rounded border border-border bg-surface px-4 py-2 text-sm text-foreground outline-none transition-colors focus:border-accent/40"
          required
        />
        <button
          type="submit"
          disabled={busy === "create"}
          className="rounded bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
        >
          {busy === "create" ? t("Creating...") : t("Create key")}
        </button>
        {error && <p className="sm:col-span-2 text-sm text-error">{error}</p>}
      </form>
    </section>
  );
}
