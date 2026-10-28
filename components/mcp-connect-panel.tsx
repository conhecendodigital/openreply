"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/lang-provider";
import {
  buildConnectFile,
  connectFileName,
  connectKeyName,
  type ConnectClient,
  type ConnectPlatform,
} from "@/lib/mcp/connect";

interface KeysData {
  tokens: { id: string; name: string; prefix: string; createdAt: string; lastUsedAt: string | null }[];
  mcpUrl: string;
  workspaceId?: string;
}

function copy(text: string) {
  void navigator.clipboard?.writeText(text);
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3 text-sm text-foreground">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-semibold text-accent">{n}</span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-border bg-surface/70 p-4">
      <h3 className="mb-3 text-sm font-semibold text-foreground">{title}</h3>
      {children}
    </div>
  );
}

/**
 * Aba MCP (28/10/2026): conectar Claude, ChatGPT e Codex ao Lead Engine SEM
 * colar chave no chat. A chave é criada aqui, vai embutida num arquivo baixado
 * (Claude Code, Codex) ou fica na área de transferência para o campo de
 * cabeçalho do conector do Claude.ai. Mostrada uma vez; revogável abaixo.
 */
export function McpConnectPanel() {
  const t = useT();
  const [data, setData] = useState<KeysData | null>(null);
  const [platform, setPlatform] = useState<ConnectPlatform>("unix");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [webHeader, setWebHeader] = useState<string | null>(null);

  async function loadKeys() {
    const res = await fetch("/api/workspace/api-tokens");
    return res.json().catch(() => null);
  }

  async function refresh() {
    const payload = await loadKeys();
    if (payload?.success) setData(payload.data);
    else setError(payload?.error ?? t("Could not load API keys"));
  }

  useEffect(() => {
    loadKeys().then((payload) => {
      if (payload?.success) setData(payload.data);
      else setError(payload?.error ?? "Could not load API keys");
    });
  }, []);

  async function createKey(client: ConnectClient | "claude-web"): Promise<string | null> {
    setError(null);
    setNotice(null);
    const res = await fetch("/api/workspace/api-tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: connectKeyName(client) }),
    });
    const payload = await res.json().catch(() => null);
    if (!payload?.success) {
      setError(payload?.error ?? t("Could not create the key"));
      return null;
    }
    return payload.data.token as string;
  }

  async function downloadFile(client: ConnectClient) {
    if (!data) return;
    setBusy(client);
    const token = await createKey(client);
    if (token) {
      try {
        const content = buildConnectFile(client, platform, data.mcpUrl, token);
        const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = connectFileName(client, platform);
        link.click();
        URL.revokeObjectURL(link.href);
        setNotice(t("File downloaded. The key is inside it and will not be shown again. Run the file on your computer, never send it to anyone."));
      } catch {
        setError(t("Could not build the file. The server address looks wrong."));
      }
    }
    setBusy(null);
    await refresh();
  }

  async function webKey() {
    setBusy("claude-web");
    const token = await createKey("claude-web");
    if (token) {
      const header = `Bearer ${token}`;
      copy(header);
      setWebHeader(header);
    }
    setBusy(null);
    await refresh();
  }

  async function revoke(id: string, name: string) {
    if (!confirm(t('Revoke "{name}"? Anything using this key stops working right away.', { name }))) return;
    setBusy(`revoke:${id}`);
    await fetch(`/api/workspace/api-tokens?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    setBusy(null);
    await refresh();
  }

  const btn =
    "rounded bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-50";
  const ghost =
    "rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-border-hover hover:text-foreground";

  return (
    <div id="mcp" className="space-y-4">
      <div role="alert" className="rounded border border-error/40 bg-error/10 p-4 text-sm text-foreground">
        <p className="font-semibold">{t("Never paste your key in the AI chat.")}</p>
        <p className="mt-1 text-muted">
          {t("A key typed in a chat can leak and the AI may refuse it. If you pasted one by mistake, revoke it in the list at the bottom of this tab and create another.")}
        </p>
      </div>

      <p className="text-sm text-muted">
        {t("The AI controls your Lead Engine through the MCP server. You connect it once, outside the chat: by a file you run on your computer or by a field in the connector screen. The key only works in this workspace.")}
      </p>

      {data && (
        <Card title={t("Server address")}>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="min-w-0 truncate text-sm font-medium text-foreground">{data.mcpUrl}</p>
            <button type="button" className={ghost} onClick={() => copy(data.mcpUrl)}>{t("Copy")}</button>
          </div>
          {data.workspaceId && (
            <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="min-w-0 truncate text-xs text-muted">
                {t("Workspace ID (information only, it is not a secret and does not replace the key)")}: {data.workspaceId}
              </p>
              <button type="button" className={ghost} onClick={() => copy(data.workspaceId ?? "")}>{t("Copy")}</button>
            </div>
          )}
        </Card>
      )}

      {notice && <p className="rounded border border-accent/40 bg-accent/10 p-3 text-sm text-foreground">{notice}</p>}
      {error && <p className="text-sm text-error">{error}</p>}

      <Card title="Claude Code">
        <ol className="mb-4 space-y-2">
          <Step n={1}>{t("Pick your system:")}{" "}
            <select value={platform} onChange={(e) => setPlatform(e.target.value as ConnectPlatform)} className="rounded border border-border bg-surface px-2 py-1 text-sm">
              <option value="unix">Mac / Linux</option>
              <option value="windows">Windows</option>
            </select>
          </Step>
          <Step n={2}>{t("Click the button to download the connection file. It already has your key inside.")}</Step>
          <Step n={3}>{platform === "unix"
            ? t("Mac: open the Terminal, type chmod +x and drag the file in, press Enter, then run the file the same way. Or right-click the file and choose Open.")
            : t("Windows: right-click the .ps1 file and choose Run with PowerShell.")}</Step>
          <Step n={4}>{t("Open Claude Code and type /mcp. The server leadengine should appear as connected.")}</Step>
        </ol>
        <button type="button" disabled={!data || busy === "claude-code"} onClick={() => void downloadFile("claude-code")} className={btn}>
          {busy === "claude-code" ? t("Creating...") : t("Download Claude Code file")}
        </button>
      </Card>

      <Card title="Codex">
        <ol className="mb-4 space-y-2">
          <Step n={1}>{t("Click the button to download the connection file (same system chosen above).")}</Step>
          <Step n={2}>{t("Run it. It saves the key in a protected file on your computer and adds the server to the Codex config.toml, with the key in an environment variable, never inside config.toml.")}</Step>
          <Step n={3}>{t("Close and reopen the terminal, then open Codex.")}</Step>
        </ol>
        <button type="button" disabled={!data || busy === "codex"} onClick={() => void downloadFile("codex")} className={btn}>
          {busy === "codex" ? t("Creating...") : t("Download Codex file")}
        </button>
      </Card>

      <Card title="Claude.ai (conector personalizado)">
        <ol className="mb-4 space-y-2">
          <Step n={1}>{t("In Claude.ai go to Customize > Connectors > Add > Add custom connector.")}</Step>
          <Step n={2}>{t("Name: Lead Engine. Server URL: the address above.")}</Step>
          <Step n={3}>{t("Authentication: No sign in. In Request headers add the header Authorization and, as the value, paste what the button below copies (it starts with Bearer).")}</Step>
          <Step n={4}>{t("Paste only in that field of the connector screen, never in a conversation. Click Add.")}</Step>
        </ol>
        <p className="mb-3 text-xs text-muted">
          {t("Claude connects from Anthropic's servers, so the Lead Engine must be reachable on the internet (it is). On Team and Enterprise plans only owners add connectors and everyone shares that key. Menu names can change; confirmed against the Claude help center on 28/10/2026.")}
        </p>
        <button type="button" disabled={!data || busy === "claude-web"} onClick={() => void webKey()} className={btn}>
          {busy === "claude-web" ? t("Creating...") : t("Create key and copy header value")}
        </button>
        {webHeader && (
          <div className="mt-3 flex flex-col gap-2 rounded border border-accent/40 bg-accent/10 p-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-foreground">{t("Copied. Paste it in the header field now. It will not be shown again.")}</p>
            <div className="flex gap-2">
              <button type="button" className={ghost} onClick={() => copy(webHeader)}>{t("Copy again")}</button>
              <button type="button" className={ghost} onClick={() => { setWebHeader(null); copy(""); }}>{t("Done")}</button>
            </div>
          </div>
        )}
      </Card>

      <Card title="ChatGPT">
        <p className="text-sm text-muted">
          {t("Not available yet. The ChatGPT custom connector (Settings > Apps and connectors, with developer mode on) accepts OAuth or no authentication; sending a fixed key in a header was not confirmed in the documentation. Connecting ChatGPT without a key needs sign-in with OAuth, which the Lead Engine does not offer yet. Use Claude or Codex for now. Do not paste the key in the ChatGPT chat.")}
        </p>
      </Card>

      <Card title={t("Active keys")}>
        <div className="space-y-3">
          {data?.tokens.map((key) => (
            <div key={key.id} className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{key.name}</p>
                <p className="truncate text-xs text-muted">
                  {key.prefix}{t("… · created")} {new Date(key.createdAt).toLocaleString()} {t("· last used")}{" "}
                  {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : t("never")}
                </p>
              </div>
              <button type="button" onClick={() => void revoke(key.id, key.name)} disabled={busy === `revoke:${key.id}`} className="rounded-lg border border-error/20 px-3 py-1.5 text-xs font-medium text-error transition-colors hover:bg-error/10 disabled:opacity-50">
                {t("Revoke")}
              </button>
            </div>
          ))}
          {data && data.tokens.length === 0 && <p className="text-sm text-muted">{t("No keys created here yet.")}</p>}
        </div>
        <p className="mt-3 text-xs text-muted">
          {t("A key reads, creates things turned off and proposes drafts. Turning on, sending, deleting and managing members or keys stay with a person. Each key has a limit of 300 requests per minute.")}
        </p>
      </Card>
    </div>
  );
}
