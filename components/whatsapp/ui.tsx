"use client";

/**
 * Peças comuns das telas do WhatsApp (Conversas, Conexões, Agentes):
 * botões, selo de status do número, hora curta e o aviso de "ainda não está
 * ligado no servidor". Mesmo visual do resto do painel (tokens de globals.css).
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useT } from "@/components/lang-provider";

export const btn =
  "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50";
export const btnPrimary = `${btn} bg-accent text-white hover:bg-accent-hover`;
export const btnSecondary = `${btn} bg-surface-hover text-foreground hover:bg-border`;
export const btnDanger = `${btn} border border-error/30 text-error hover:bg-error/10`;
export const INPUT =
  "w-full rounded-md border border-border bg-[#fafafa] px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent focus:bg-white focus:outline-none";

export type WaStatus = "PENDING" | "QR_READY" | "CONNECTED" | "DISCONNECTED" | "RESTRICTED" | "BANNED";

const STATUS: Record<WaStatus, { label: string; tone: string; dot: string }> = {
  CONNECTED: { label: "Connected now", tone: "bg-success/10 text-success", dot: "bg-success" },
  QR_READY: { label: "Waiting for the QR code", tone: "bg-warning/10 text-warning", dot: "bg-warning" },
  PENDING: { label: "Starting", tone: "bg-warning/10 text-warning", dot: "bg-warning" },
  DISCONNECTED: { label: "Disconnected", tone: "bg-surface-hover text-muted", dot: "bg-muted" },
  RESTRICTED: { label: "Restricted by WhatsApp", tone: "bg-error/10 text-error", dot: "bg-error" },
  BANNED: { label: "Banned by WhatsApp", tone: "bg-error/10 text-error", dot: "bg-error" },
};

export function StatusPill({ status }: { status: WaStatus }) {
  const t = useT();
  const s = STATUS[status] ?? STATUS.PENDING;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${s.tone}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {t(s.label)}
    </span>
  );
}

/** "14:05" hoje, "06/10" em outro dia. */
export function shortTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { day: "2-digit", month: "2-digit" });
}

export function formatPhone(e164: string | null): string {
  if (!e164) return "";
  const d = e164.replace(/\D/g, "");
  const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(d);
  return m ? `+55 ${m[1]} ${m[2]}-${m[3]}` : `+${d}`;
}

export type ServerStatus = {
  enabled: boolean;
  gatewayConfigured: boolean;
  /** uazapi (UAZAPI_SERVER_URL e UAZAPI_ADMIN_TOKEN). Ausente em servidor antigo. */
  uazapiConfigured?: boolean;
  webhookReady: boolean;
  ai: { anthropic: boolean; openai: boolean };
};

/** Lê /api/whatsapp/status uma vez. */
export function useServerStatus(): ServerStatus | null {
  const [status, setStatus] = useState<ServerStatus | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/whatsapp/status", { cache: "no-store" })
      .then((r) => r.json())
      .then((p) => {
        if (alive && p?.success) setStatus(p.data as ServerStatus);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return status;
}

/** Aviso amarelo quando falta ligar algo no servidor (variáveis do Dokploy). */
export function ServerNotice({ status }: { status: ServerStatus | null }) {
  const t = useT();
  if (!status) return null;
  const missing: string[] = [];
  if (!status.enabled) missing.push(t("WhatsApp is not turned on on the server yet (WHATSAPP_ENABLED)."));
  // Basta um provedor configurado (uazapi ou OpenWA); o card de cada um explica o que falta.
  if (!status.gatewayConfigured && !status.uazapiConfigured) {
    missing.push(t("No WhatsApp provider is configured yet. Add the uazapi or the OpenWA gateway in Channels, Connections and keys."));
  }
  if (!status.webhookReady) missing.push(t("The server has no public https address for the webhook yet."));
  if (missing.length === 0) return null;
  return (
    <div className="rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm text-foreground" role="status">
      <p className="font-semibold">{t("WhatsApp is not ready on the server")}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted">
        {missing.map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ul>
    </div>
  );
}

/** Abas das 3 telas do WhatsApp (no celular o menu fica escondido). */
export function WhatsAppTabs({ active }: { active: "inbox" | "leads" | "connections" | "agents" }) {
  const t = useT();
  const tabs = [
    { key: "inbox", href: "/whatsapp/inbox", label: t("Conversations") },
    { key: "leads", href: "/whatsapp/leads", label: t("Leads") },
    { key: "connections", href: "/whatsapp/connections", label: t("Connections") },
    { key: "agents", href: "/whatsapp/agents", label: t("Agents") },
  ] as const;
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-border" aria-label={t("WhatsApp")}>
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={tab.key === active ? "page" : undefined}
          className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm ${
            tab.key === active ? "border-foreground font-semibold text-foreground" : "border-transparent text-muted hover:text-foreground"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

/** Caixa de confirmação simples (sem depender de window.confirm). */
export function ConfirmBox({
  title,
  body,
  confirmLabel,
  danger,
  busy,
  confirmDisabled,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  /** Ex.: enquanto a pessoa não digitou o nome pra confirmar. */
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full max-w-md rounded-xl bg-background p-5 shadow-xl">
        <p className="text-base font-semibold">{title}</p>
        <div className="mt-2 space-y-2 text-sm text-muted">{body}</div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className={btnSecondary}>
            {t("Cancel")}
          </button>
          <button type="button" onClick={onConfirm} disabled={busy || confirmDisabled} className={danger ? btnDanger : btnPrimary}>
            {busy ? t("Wait…") : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** fetch que devolve { ok, data, error } no formato das rotas do Lead Engine. */
export async function api<T>(url: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: string; code?: string }> {
  try {
    const res = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
    const payload = await res.json().catch(() => null);
    if (payload?.success) return { ok: true, data: payload.data as T };
    return { ok: false, error: payload?.error ?? "Something went wrong. Try again in a minute.", code: payload?.details?.code };
  } catch {
    return { ok: false, error: "Could not reach the server. Try again." };
  }
}
