"use client";

/**
 * Detalhe de um canal TikTok ou YouTube: dados, estado, permissões concedidas,
 * testar conexão, reconectar e desconectar (com confirmação).
 */

import { useState } from "react";
import { callApi } from "@/components/posts/api";
import { Avatar } from "@/components/posts/accounts-bar";
import { useDateTime, useTimeAgo } from "@/components/contact-ui";
import { useLang, useT } from "@/components/lang-provider";
import { channelBtn, channelBtnDanger, channelBtnPrimary, channelBtnSecondary, STATUS_LABEL, type Role } from "@/components/channels/types";
import { BrandIcon } from "@/components/social/brand-icon";
import { CONNECT_ROUTE } from "@/components/channels/connect-card";
import { SOCIAL_BRAND_NAME } from "@/lib/social/brand-icons";
import type { SocialAccountDTO } from "@/lib/tiktok-composer";

interface TestOutcome {
  ok: boolean;
  checkedAt: string;
  detail?: string | null;
  needsReconnect?: boolean;
  error?: string;
}

/** "https://www.googleapis.com/auth/youtube.upload" vira "youtube.upload". */
function shortScope(scope: string): string {
  return scope.replace("https://www.googleapis.com/auth/", "");
}

export function SocialChannelDetail({
  account,
  role,
  onChanged,
}: {
  account: SocialAccountDTO;
  role: Role | null;
  onChanged: () => Promise<void>;
}) {
  const t = useT();
  const { lang } = useLang();
  const dateTime = useDateTime();
  const timeAgo = useTimeAgo();
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestOutcome | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kidsBusy, setKidsBusy] = useState(false);

  const canManage = role === "OWNER" || role === "ADMIN";
  const network = account.platform;
  const status = STATUS_LABEL[account.status];
  const isOn = account.status === "ACTIVE";
  const isOff = account.status === "DISCONNECTED";
  const connectHref = CONNECT_ROUTE[network === "YOUTUBE" ? "YOUTUBE" : "TIKTOK"];

  async function runTest() {
    setTesting(true);
    setError(null);
    const res = await callApi<TestOutcome>(`/api/social-accounts/${account.id}/test`, { method: "POST" });
    setTesting(false);
    if (res.ok && res.data) {
      setTest(res.data);
      await onChanged();
    } else {
      setError(t("The test failed."));
    }
  }

  async function setKidsDefault(enabled: boolean) {
    setKidsBusy(true);
    setError(null);
    const res = await callApi(`/api/social-accounts/${account.id}/youtube-kids-default`, { method: "PUT", body: JSON.stringify({ enabled }) });
    setKidsBusy(false);
    if (!res.ok) {
      setError(t("Could not save the default."));
      return;
    }
    await onChanged();
  }

  async function disconnect() {
    setBusy(true);
    setError(null);
    const res = await callApi(`/api/social-accounts/${account.id}`, { method: "DELETE" });
    setBusy(false);
    setConfirming(false);
    if (!res.ok) {
      setError(t("Could not disconnect."));
      return;
    }
    await onChanged();
  }

  return (
    <article className="panel overflow-hidden rounded-xl">
      <div className="flex items-start gap-4 p-4 sm:p-5">
        <div className="relative shrink-0">
          <Avatar url={account.avatarUrl} name={account.displayName} size={56} />
          <span className="absolute -bottom-1 -right-1 rounded-full ring-2 ring-background">
            <BrandIcon brand={network} size={24} />
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="truncate text-base font-semibold">{account.displayName}</p>
            <span className="rounded-full bg-surface-hover px-2.5 py-1 text-xs font-semibold text-muted">{SOCIAL_BRAND_NAME[network]}</span>
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${status.tone}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
              {lang === "pt" ? status.pt : status.en}
            </span>
          </div>
          {account.username && <p className="truncate text-sm text-muted">@{account.username}</p>}
          <p className="mt-0.5 text-xs text-muted">{t("Connected since {when}", { when: dateTime(account.connectedAt) })}</p>
        </div>
      </div>

      {isOff && (
        <div className="mx-4 mb-4 rounded-lg border border-border bg-surface-hover/60 p-3 text-sm sm:mx-5">
          <p className="font-medium">{t("This channel is off. Nothing runs and nothing is sent.")}</p>
        </div>
      )}
      {account.lastError && !isOn && (
        <p className="mx-4 mb-4 break-words rounded-lg border border-error/25 bg-error/10 px-3 py-2 text-sm text-error sm:mx-5">{account.lastError}</p>
      )}

      <div className="space-y-4 border-t border-border p-4 sm:p-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">{t("Permissions granted")}</p>
          {account.scopes.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {account.scopes.map((s) => (
                <span key={s} className="rounded-md bg-surface-hover px-2 py-0.5 font-mono text-xs">
                  {shortScope(s)}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-sm text-muted">{t("None")}</p>
          )}
          {account.missingScopes.length > 0 && (
            <div className="mt-3 rounded-lg border border-warning/40 bg-warning/10 p-3">
              <p className="text-xs font-semibold">{t("Not allowed yet")}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {account.missingScopes.map((s) => (
                  <span key={s} className="rounded-md border border-dashed border-warning px-2 py-0.5 font-mono text-xs">
                    {shortScope(s)}
                  </span>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-muted">{t("Reconnect the channel and accept every permission to use all features.")}</p>
            </div>
          )}
        </div>

        {network === "YOUTUBE" && !isOff && (
          <div className="rounded-lg border border-border p-3">
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={account.youtubeNotForKidsDefault === true}
                disabled={!canManage || kidsBusy}
                onChange={(e) => void setKidsDefault(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-accent"
              />
              <span>
                <span className="font-semibold">{t("Default: my videos are NOT made for kids")}</span>
                <span className="mt-1 block text-xs text-muted">
                  {t(
                    'This is your own statement to YouTube, not ours. Turn it on only if none of your videos on this channel is made for kids. New videos then go out as "not made for kids" without asking each time. You can still mark a single video as made for kids, and that answer wins.'
                  )}
                </span>
                <span className="mt-1 block text-xs text-muted">
                  {account.youtubeNotForKidsDefault && account.youtubeNotForKidsDefaultAt
                    ? t("Turned on on {when}", { when: dateTime(account.youtubeNotForKidsDefaultAt) })
                    : t("Off. YouTube still asks you for every video.")}
                </span>
              </span>
            </label>
          </div>
        )}

        {test && (
          <div
            role="status"
            className={`rounded-lg border px-3 py-2 text-sm ${test.ok ? "border-success/25 bg-success/10" : "border-error/25 bg-error/10 text-error"}`}
          >
            {test.ok ? (
              <>
                <p className="font-semibold text-success">{t("Connection OK")}</p>
                <p className="text-foreground/80">{t("checked {when}", { when: timeAgo(test.checkedAt) })}</p>
              </>
            ) : (
              <>
                <p className="font-semibold">{test.needsReconnect ? t("The token was rejected. Reconnect the account.") : t("Connection failed")}</p>
                {test.error && <p className="mt-0.5 break-words text-xs opacity-90">{test.error}</p>}
              </>
            )}
          </div>
        )}
        {error && <p className="text-sm text-error">{error}</p>}

        {canManage && (
          <div className="flex flex-wrap gap-2">
            <a href={connectHref} className={isOn ? channelBtnSecondary : channelBtnPrimary}>
              {t("Reconnect")}
            </a>
            {!isOff && (
              <button type="button" onClick={runTest} disabled={testing} className={channelBtnSecondary}>
                {testing ? t("Testing...") : t("Test connection")}
              </button>
            )}
            {!isOff && !confirming && (
              <button type="button" onClick={() => setConfirming(true)} className={channelBtnDanger}>
                {t("Disconnect")}
              </button>
            )}
          </div>
        )}
        {!canManage && role && <p className="text-xs text-muted">{t("Only owners and admins can change a channel.")}</p>}

        {confirming && (
          <div className="rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">
            <p className="font-semibold">{t("Disconnect {name}?", { name: account.displayName })}</p>
            <p className="mt-1">{t("Scheduled posts for this channel will not go out. Connect it again to use it.")}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={disconnect} disabled={busy} className={`${channelBtn} bg-foreground text-background hover:opacity-85`}>
                {busy ? t("Disconnecting...") : t("Yes, disconnect")}
              </button>
              <button type="button" onClick={() => setConfirming(false)} disabled={busy} className={channelBtnSecondary}>
                {t("Cancel")}
              </button>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
