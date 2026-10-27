"use client";

/**
 * Detalhe de um canal do Instagram ou da Página do Facebook (era o cartão grande da
 * página Canais, 23/10/2026: o cartão da grade ficou enxuto e tudo isto veio para
 * /channels/[id]). Nada mudou aqui: status, token, webhooks, testar conexão,
 * reconectar, desconectar (nunca apaga) e o "Apagar de verdade" só do dono.
 */

import { useState } from "react";
import { useDateTime, useTimeAgo } from "@/components/contact-ui";
import { channelAlertText, isSeriousAlert } from "@/components/channel-alert-banner";
import { useLang, useT } from "@/components/lang-provider";
import { buildPermissionPanel } from "@/lib/meta/permissions";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import {
  STATUS_LABEL,
  channelBtn,
  channelBtnDanger,
  channelBtnPrimary,
  channelBtnSecondary,
  type InstagramCard,
  type Role,
  type Status,
} from "@/components/channels/types";

interface TestResult {
  ok: boolean;
  status?: Status;
  code?: string;
  error?: string;
  followers?: number | null;
  webhookError?: string | null;
  checkedAt: string;
}

type Kept = {
  campaigns: number;
  contacts: number;
  messages: number;
  drafts: number;
  links: number;
  moderation: number;
  dmLogs: number;
  followerSnapshots: number;
};

const MODERATION_LABEL: Record<InstagramCard["moderationMode"], string> = {
  OFF: "Off",
  OBSERVE: "Observe only",
  HIDE: "Hide",
};

export function InstagramChannelDetail({
  card,
  role,
  onChanged,
}: {
  card: InstagramCard;
  role: Role | null;
  onChanged: () => Promise<void>;
}) {
  const t = useT();
  const { lang } = useLang();
  const timeAgo = useTimeAgo();
  const dateTime = useDateTime();
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [kept, setKept] = useState<Kept | null>(null);

  const canManage = role === "OWNER" || role === "ADMIN";
  const status = STATUS_LABEL[card.status];
  const isOn = card.status === "ACTIVE";
  const isOff = card.status === "DISCONNECTED";

  async function runTest() {
    setTesting(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/channels/instagram/${card.id}/test`, { method: "POST" });
      const payload = await res.json();
      if (payload.success) {
        setTest(payload.data);
        await onChanged();
      } else {
        setActionError(payload.error ?? t("The test failed."));
      }
    } catch {
      setActionError(t("The test failed."));
    } finally {
      setTesting(false);
    }
  }

  async function disconnect() {
    setDisconnecting(true);
    setActionError(null);
    try {
      const res = await fetch("/api/instagram/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instagramAccountId: card.id }),
      });
      const payload = await res.json().catch(() => null);
      if (payload?.success) {
        setKept(payload.data.kept ?? null);
        setConfirmDisconnect(false);
        setTest(null);
        await onChanged();
      } else {
        setActionError(payload?.error ?? t("Could not disconnect."));
      }
    } catch {
      setActionError(t("Could not disconnect."));
    } finally {
      setDisconnecting(false);
    }
  }

  const tokenText = (() => {
    if (isOff) return t("No token (disconnected)");
    if (!card.tokenExpiresAt) return t("not available");
    const date = new Date(card.tokenExpiresAt).toLocaleDateString(lang === "pt" ? "pt-BR" : "en");
    const days = card.tokenExpiresInDays;
    if (days === null) return date;
    if (days < 0) return t("Expired on {date}", { date });
    if (days === 0) return t("{date} (today)", { date });
    return t("{date} (in {n} days)", { date, n: days });
  })();
  const tokenWarn = !isOff && card.tokenExpiresInDays !== null && card.tokenExpiresInDays < 10;

  return (
    <article className="panel overflow-hidden rounded-xl">
      <div className="flex items-start gap-4 p-4 sm:p-5">
        <Avatar card={card} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="truncate text-base font-semibold">{card.platform === "facebook" ? card.name ?? card.username : `@${card.username}`}</p>
            {card.platform === "facebook" && (
              <span className="rounded-full bg-surface-hover px-2.5 py-1 text-xs font-semibold text-muted">{t("Facebook Page")}</span>
            )}
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${status.tone}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
              {lang === "pt" ? status.pt : status.en}
            </span>
          </div>
          {card.name && <p className="truncate text-sm text-muted">{card.name}</p>}
          <p className="mt-0.5 text-xs text-muted">
            {isOff && card.disconnectedAt
              ? t("Disconnected {when}", { when: dateTime(card.disconnectedAt) })
              : t("Connected since {when}", { when: dateTime(card.reconnectedAt ?? card.connectedAt) })}
          </p>
        </div>
      </div>

      {isOff && (
        <div className="mx-4 mb-4 rounded-lg border border-border bg-surface-hover/60 p-3 text-sm sm:mx-5">
          <p className="font-medium">{t("This channel is off. Nothing runs and nothing is sent.")}</p>
          <p className="mt-0.5 text-muted">
            {t("Everything was kept. Reconnect the same account and campaigns come back as they were.")}
          </p>
        </div>
      )}

      {card.alerts.length > 0 && (
        <ul className="mx-4 mb-4 space-y-2 sm:mx-5">
          {card.alerts.map((alert) => (
            <li
              key={alert.code}
              className={`rounded-lg border px-3 py-2 text-sm ${
                isSeriousAlert(alert) ? "border-error/25 bg-error/10 text-error" : "border-warning/30 bg-warning/10 text-foreground"
              }`}
            >
              {channelAlertText(t, alert)}
            </li>
          ))}
        </ul>
      )}

      <dl className="grid grid-cols-2 gap-px border-y border-border bg-border sm:grid-cols-3">
        <Stat label={t("Token expires")} warn={tokenWarn}>
          {tokenText}
        </Stat>
        <Stat label={t("Last webhook received")} warn={card.webhooksStale}>
          {card.lastWebhookAt ? (
            <span title={dateTime(card.lastWebhookAt)}>{timeAgo(card.lastWebhookAt)}</span>
          ) : (
            t("Never")
          )}
          {card.webhooksStale && <span className="block text-xs font-normal">{t("Stopped for over 24h")}</span>}
        </Stat>
        <Stat label={t("Campaigns on")}>
          {t("{a} of {b}", { a: card.campaigns.active, b: card.campaigns.total })}
          {!isOn && card.campaigns.active > 0 && (
            <span className="block text-xs font-normal text-muted">{t("waiting for the channel")}</span>
          )}
        </Stat>
        <Stat label={t("Moderation")}>{t(MODERATION_LABEL[card.moderationMode])}</Stat>
        <Stat label={t("Contacts")}>{card.contacts.toLocaleString(lang === "pt" ? "pt-BR" : "en")}</Stat>
        <Stat label={t("Drafts waiting")} warn={card.pendingDrafts > 0}>
          {card.pendingDrafts}
        </Stat>
      </dl>

      <div className="space-y-4 p-4 sm:p-5">
        <CollapsibleSection
          id={`ig-${card.id}-tecnico`}
          variant="group"
          hideFromIndex
          defaultOpen={false}
          attention={(card.missingWebhookFields?.length ?? 0) > 0}
          title={t("Subscribed webhooks")}
          badge={(card.missingWebhookFields?.length ?? 0) > 0 ? { text: t("Not subscribed yet"), tone: "warning" } : { text: String(card.webhookFields.length) }}
          summary={[card.webhookFields.slice(0, 4).join(", ") || t("None"), card.lastError ? t("Last error") : ""].filter(Boolean).join(" · ")}
        >
        <div>
          {card.webhookFields.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {card.webhookFields.map((field) => (
                <span key={field} className="rounded-md bg-surface-hover px-2 py-0.5 font-mono text-xs">
                  {field}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-sm text-muted">
              {card.webhookSubscribed
                ? t("Subscribed (fields not read yet; use Test connection)")
                : t("None")}
            </p>
          )}
          {(card.missingWebhookFields?.length ?? 0) > 0 && (
            <div className="mt-3 rounded-lg border border-warning/40 bg-warning/10 p-3">
              <p className="text-xs font-semibold text-foreground">{t("Not subscribed yet")}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {card.missingWebhookFields!.map((field) => (
                  <span
                    key={field}
                    className="rounded-md border border-dashed border-warning px-2 py-0.5 font-mono text-xs text-foreground"
                  >
                    {field}
                  </span>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-muted">
                {card.missingWebhookFields!.includes("live_comments")
                  ? t("live_comments brings comments made during your lives (Comment on a live campaigns). Tick it in the Meta app (Webhooks > Instagram) and reconnect the channel to subscribe again.")
                  : t("Reconnect the channel to subscribe again.")}
              </p>
            </div>
          )}
        </div>

        {card.lastError && (
          <div className="text-xs text-muted">
            <span className="font-semibold text-foreground">{t("Last error")}</span>
            {card.lastErrorAt ? ` · ${timeAgo(card.lastErrorAt)}` : ""}
            <p className="mt-0.5 break-words font-mono">{card.lastError}</p>
          </div>
        )}
        </CollapsibleSection>

        {card.platform === "instagram" && <PermissionsPanel card={card} t={t} />}

        {test && (
          <div
            role="status"
            className={`rounded-lg border px-3 py-2 text-sm ${
              test.ok ? "border-success/25 bg-success/10" : "border-error/25 bg-error/10 text-error"
            }`}
          >
            {test.ok ? (
              <>
                <p className="font-semibold text-success">{t("Connection OK")}</p>
                <p className="text-foreground/80">
                  {test.followers != null && `${t("{n} followers", { n: test.followers.toLocaleString(lang === "pt" ? "pt-BR" : "en") })} · `}
                  {t("checked {when}", { when: timeAgo(test.checkedAt) })}
                </p>
                {test.webhookError && <p className="mt-1 text-xs text-muted">{test.webhookError}</p>}
              </>
            ) : (
              <>
                <p className="font-semibold">
                  {test.status === "NEEDS_RECONNECT" ? t("The token was rejected. Reconnect the account.") : t("Connection failed")}
                </p>
                {test.error && <p className="mt-0.5 break-words text-xs opacity-90">{test.error}</p>}
              </>
            )}
          </div>
        )}

        {kept && (
          <div role="status" className="rounded-lg border border-border bg-surface-hover/60 px-3 py-2 text-sm">
            <p className="font-semibold">{t("Disconnected. Nothing was deleted.")}</p>
            <p className="mt-0.5 text-muted">
              {t("Kept: {campaigns} campaigns, {contacts} contacts, {messages} messages, {drafts} drafts, {links} links, {dmLogs} DM logs.", {
                campaigns: kept.campaigns,
                contacts: kept.contacts,
                messages: kept.messages,
                drafts: kept.drafts,
                links: kept.links,
                dmLogs: kept.dmLogs,
              })}
            </p>
          </div>
        )}

        {actionError && <p className="text-sm text-error">{actionError}</p>}

        {canManage && (
          <div className="flex flex-wrap gap-2">
            <a href={card.platform === "facebook" ? "/api/facebook/connect" : "/api/instagram/connect"} className={isOn ? channelBtnSecondary : channelBtnPrimary}>
              {t("Reconnect")}
            </a>
            {!isOff && (
              <button type="button" onClick={runTest} disabled={testing} className={channelBtnSecondary}>
                {testing ? t("Testing...") : t("Test connection")}
              </button>
            )}
            {!isOff && !confirmDisconnect && (
              <button type="button" onClick={() => setConfirmDisconnect(true)} className={channelBtnDanger}>
                {t("Disconnect")}
              </button>
            )}
          </div>
        )}
        {!canManage && role && (
          <p className="text-xs text-muted">{t("Only owners and admins can change a channel.")}</p>
        )}

        {confirmDisconnect && (
          <div className="rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">
            <p className="font-semibold">{t("Disconnect @{username}?", { username: card.username })}</p>
            <p className="mt-1">
              {t("The channel turns off: no campaign runs, no moderation, nothing is sent.")}
            </p>
            <p className="mt-1 font-semibold">
              {t("Nothing is deleted: campaigns, contacts, conversations, drafts, sequences, links, moderation and history all stay.")}
            </p>
            <p className="mt-1 text-muted">{t("Reconnect the same account to turn everything back on.")}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={disconnect} disabled={disconnecting} className={`${channelBtn} bg-foreground text-background hover:opacity-85`}>
                {disconnecting ? t("Disconnecting...") : t("Yes, disconnect")}
              </button>
              <button type="button" onClick={() => setConfirmDisconnect(false)} disabled={disconnecting} className={channelBtnSecondary}>
                {t("Cancel")}
              </button>
            </div>
          </div>
        )}
      </div>

      {role === "OWNER" && <DeleteForReal card={card} onDeleted={onChanged} />}
    </article>
  );
}

/** Hidden at the bottom of the card: owner only, channel already off, type the @. */
function DeleteForReal({ card, onDeleted }: { card: InstagramCard; onDeleted: () => Promise<void> }) {
  const t = useT();
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalize = (value: string) => value.replace(/^@+/, "").trim().toLowerCase();
  const matches = normalize(typed) === normalize(card.username) && typed.trim() !== "";
  const isOff = card.status === "DISCONNECTED";

  async function purge() {
    if (!matches || !isOff) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch("/api/instagram/purge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instagramAccountId: card.id, confirmUsername: typed }),
      });
      const payload = await res.json().catch(() => null);
      if (payload?.success) {
        await onDeleted();
        return;
      }
      const code = payload?.code;
      setError(
        code === "confirmation_mismatch"
          ? t("The @ does not match. Nothing was deleted.")
          : code === "not_disconnected"
            ? t("Disconnect the channel first.")
            : code === "human_only" || res.status === 403
              ? t("Only the workspace owner, signed in, can delete a channel.")
              : payload?.error ?? t("Could not delete.")
      );
    } catch {
      setError(t("Could not delete."));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <details className="group border-t border-border">
      <summary className="cursor-pointer list-none px-4 py-3 text-xs text-muted hover:text-foreground sm:px-5 [&::-webkit-details-marker]:hidden">
        <span className="inline-flex items-center gap-1">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {t("Delete for real")}
        </span>
      </summary>
      <div className="space-y-3 px-4 pb-5 text-sm sm:px-5">
        <div className="rounded-lg border border-error/30 bg-error/5 p-3">
          <p className="font-semibold text-error">{t("This cannot be undone.")}</p>
          <p className="mt-1 text-foreground/80">
            {t("Deletes the channel and everything it holds: campaigns, contacts, conversations and media, drafts, sequences, links, moderation, logs, clicks and follower history.")}
          </p>
        </div>
        {!isOff ? (
          <p className="text-muted">{t("Disconnect the channel first. Only a disconnected channel can be deleted.")}</p>
        ) : (
          <>
            <label className="block">
              <span className="text-muted">{t("Type @{username} to confirm", { username: card.username })}</span>
              <input
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                placeholder={`@${card.username}`}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                className="mt-1.5 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-error/50"
              />
            </label>
            <button
              type="button"
              onClick={purge}
              disabled={!matches || deleting}
              className={`${channelBtn} bg-error text-white hover:opacity-90`}
            >
              {deleting ? t("Deleting...") : t("Delete @{username} for real", { username: card.username })}
            </button>
          </>
        )}
        {error && <p className="text-error">{error}</p>}
      </div>
    </details>
  );
}

function Stat({ label, warn = false, children }: { label: string; warn?: boolean; children: React.ReactNode }) {
  return (
    <div className="bg-background px-4 py-3 sm:px-5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`mt-0.5 text-sm font-semibold ${warn ? "text-warning" : "text-foreground"}`}>{children}</dd>
    </div>
  );
}

function Avatar({ card }: { card: InstagramCard }) {
  const [broken, setBroken] = useState(false);
  const ring = card.status === "ACTIVE" ? "ig-gradient" : "bg-border";
  return (
    <span className={`grid h-14 w-14 shrink-0 place-items-center rounded-full p-[2px] ${ring}`}>
      <span className="grid h-full w-full place-items-center overflow-hidden rounded-full border-2 border-background bg-surface-hover">
        {card.profilePictureUrl && !broken ? (
          // eslint-disable-next-line @next/next/no-img-element -- Meta CDN URL, not optimizable
          <img
            src={card.profilePictureUrl}
            alt=""
            className={`h-full w-full object-cover ${card.status === "DISCONNECTED" ? "grayscale" : ""}`}
            onError={() => setBroken(true)}
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className="text-lg font-semibold uppercase text-muted">{card.username.slice(0, 1)}</span>
        )}
      </span>
    </span>
  );
}


/** Permissões autorizadas: o que a Meta informou como concedido na última conexão (não é leitura ao vivo). */
export function PermissionsPanel({ card, t }: { card: InstagramCard; t: ReturnType<typeof useT> }) {
  const panel = buildPermissionPanel(card.grantedScopes, []);
  const tone = { granted: "bg-success/10 text-success", missing: "border border-dashed border-warning text-foreground", unknown: "bg-surface-hover text-muted" } as const;
  const mark = { granted: t("Permission active"), missing: t("Permission missing"), unknown: t("Not confirmed") } as const;
  return (
    <div data-testid="permissions-panel">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{t("Authorized permissions")}</p>
      <p className="mt-0.5 text-xs text-muted">
        {panel.unknown
          ? t("The Meta did not report the permissions of this connection. Reconnect the account to see them here.")
          : t("Granted in the last connection, as Meta reported. If you change them on Meta later, reconnect to update this list.")}
      </p>
      <ul className="mt-2 space-y-1.5">
        {panel.rows.map((row) => (
          <li key={row.scope} className="flex flex-wrap items-center gap-2 text-sm">
            <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${tone[row.state]}`}>{mark[row.state]}</span>
            <span>{t(row.label)}</span>
            <span className="font-mono text-xs text-muted">{row.scope}</span>
          </li>
        ))}
      </ul>
      {panel.missingPublish && (
        <p role="alert" className="mt-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          {t("Publishing permission missing: Reels and carousels from the Posts tab will not go out. Reconnect the account and accept every permission on the Meta screen. If the Meta screen does not show it, the app still needs the publishing permission in the Meta for Developers panel.")}
        </p>
      )}
      {!panel.unknown && !panel.missingPublish && panel.missing.length > 0 && (
        <p className="mt-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">{t("Some permissions are missing. Reconnect the account and accept every permission.")}</p>
      )}
    </div>
  );
}
