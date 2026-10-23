"use client";

/** Contas sociais conectadas (TikTok) e o botão Conectar TikTok. */

import { useState } from "react";
import { useT } from "@/components/lang-provider";
import { callApi } from "@/components/posts/api";
import type { SocialAccountDTO } from "@/lib/tiktok-composer";

const btn = "inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50";
export const btnPrimary = `${btn} bg-accent text-white hover:bg-accent-hover`;
export const btnSecondary = `${btn} bg-surface-hover text-foreground hover:bg-border`;
export const btnDanger = `${btn} border border-error/30 text-error hover:bg-error/10`;

const STATUS: Record<SocialAccountDTO["status"], { label: string; tone: string; dot: string }> = {
  ACTIVE: { label: "Connected", tone: "bg-success/10 text-success", dot: "bg-success" },
  NEEDS_RECONNECT: { label: "Needs reconnect", tone: "bg-error/10 text-error", dot: "bg-error" },
  DISCONNECTED: { label: "Disconnected", tone: "bg-surface-hover text-muted", dot: "bg-muted" },
};

export function Avatar({ url, name, size = 40 }: { url: string | null; name: string; size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  if (url) return <img src={url} alt="" width={size} height={size} className="rounded-full object-cover" style={{ width: size, height: size }} />;
  return (
    <span
      aria-hidden
      className="flex items-center justify-center rounded-full bg-surface-hover text-sm font-semibold text-muted"
      style={{ width: size, height: size }}
    >
      {name.slice(0, 1).toUpperCase() || "?"}
    </span>
  );
}

export function AccountsBar({
  accounts,
  loading,
  onChanged,
}: {
  accounts: SocialAccountDTO[];
  loading: boolean;
  onChanged: () => Promise<void> | void;
}) {
  const t = useT();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function disconnect(id: string) {
    setBusy(id);
    setError(null);
    const res = await callApi(`/api/social-accounts/${id}`, { method: "DELETE" });
    setBusy(null);
    setConfirming(null);
    if (!res.ok) {
      setError(t("Could not disconnect. Try again in a moment."));
      return;
    }
    await onChanged();
  }

  return (
    <section aria-label={t("Connected accounts")} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">{t("Connected accounts")}</h2>
        <a href="/api/tiktok/connect" className={btnPrimary}>
          {t("Connect TikTok")}
        </a>
      </div>

      {error && <p className="rounded-xl bg-error/10 px-4 py-2.5 text-sm text-error">{error}</p>}
      {loading && <div className="panel h-20 animate-pulse rounded-xl border border-border" />}

      {!loading && accounts.length === 0 && (
        <div className="panel rounded-xl border border-border p-5 text-sm text-muted">
          {t("No TikTok account connected yet. Click Connect TikTok to start.")}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {accounts.map((a) => {
          const st = STATUS[a.status];
          return (
            <div key={a.id} className="panel flex flex-wrap items-center gap-3 rounded-xl border border-border p-4">
              <Avatar url={a.avatarUrl} name={a.displayName} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{a.displayName}</p>
                <p className="truncate text-xs text-muted">
                  TikTok{a.username ? ` · @${a.username}` : ""}
                </p>
                <span className={`mt-1 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ${st.tone}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
                  {t(st.label)}
                </span>
                {a.lastError && a.status !== "ACTIVE" && (
                  <p className="mt-1 break-words text-xs text-error">{a.lastError}</p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {a.status === "NEEDS_RECONNECT" && (
                  <a href="/api/tiktok/connect" className={btnSecondary}>
                    {t("Reconnect")}
                  </a>
                )}
                {a.status !== "DISCONNECTED" &&
                  (confirming === a.id ? (
                    <>
                      <button type="button" disabled={busy === a.id} onClick={() => void disconnect(a.id)} className={btnDanger}>
                        {t("Yes, disconnect")}
                      </button>
                      <button type="button" onClick={() => setConfirming(null)} className={btnSecondary}>
                        {t("Cancel")}
                      </button>
                    </>
                  ) : (
                    <button type="button" onClick={() => setConfirming(a.id)} className={btnSecondary}>
                      {t("Disconnect")}
                    </button>
                  ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
