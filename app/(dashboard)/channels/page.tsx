"use client";

/**
 * Channels (2026-10-05) — "uma página de canais ligados pra gente ter melhor
 * controle". One card per connected Instagram account: status, token expiry,
 * subscribed webhooks, last webhook received (alert when silent > 24 h),
 * campaigns on, moderation mode, contacts and pending drafts, with Reconnect,
 * Test connection and Disconnect. Owner's rule (2026-10-03): disconnecting
 * never deletes anything; deleting for real is a separate, hidden step that
 * only the owner can do, typing the account's @ to confirm.
 * Below: "coming soon" cards for Telegram, WhatsApp, Messenger and Threads.
 */

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { InstagramConnectNotice } from "@/components/instagram-connect-notice";
import { useLang, useT } from "@/components/lang-provider";
import { useDateTime, useTimeAgo } from "@/components/contact-ui";
import { channelAlertText, isSeriousAlert, type BannerAlert } from "@/components/channel-alert-banner";

type Status = "ACTIVE" | "NEEDS_RECONNECT" | "DISCONNECTED";
type Role = "OWNER" | "ADMIN" | "MEMBER";

interface InstagramCard {
  platform: "instagram";
  id: string;
  instagramId: string;
  username: string;
  name: string | null;
  profilePictureUrl: string | null;
  status: Status;
  connectedAt: string;
  reconnectedAt: string | null;
  disconnectedAt: string | null;
  tokenExpiresAt: string | null;
  tokenExpiresInDays: number | null;
  webhookSubscribed: boolean;
  webhookFields: string[];
  /** Expected fields (lib/meta/webhook-fields.ts) this account is not subscribed to. */
  missingWebhookFields?: string[];
  lastWebhookAt: string | null;
  webhooksStale: boolean;
  lastError: string | null;
  lastErrorAt: string | null;
  campaigns: { active: number; total: number };
  moderationMode: "OFF" | "OBSERVE" | "HIDE";
  contacts: number;
  pendingDrafts: number;
  alerts: BannerAlert[];
}

interface ComingSoon {
  platform: "telegram" | "whatsapp" | "messenger" | "threads";
  name: string;
  requirements: string[];
}

interface Overview {
  instagram: InstagramCard[];
  comingSoon: ComingSoon[];
  alerts: BannerAlert[];
}

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

/** The owner's words: Conectado / Precisa reconectar / Desconectado. */
const STATUS_LABEL: Record<Status, { pt: string; en: string; tone: string; dot: string }> = {
  ACTIVE: { pt: "Conectado", en: "Connected", tone: "bg-success/10 text-success", dot: "bg-success" },
  NEEDS_RECONNECT: { pt: "Precisa reconectar", en: "Needs reconnect", tone: "bg-error/10 text-error", dot: "bg-error" },
  DISCONNECTED: { pt: "Desconectado", en: "Disconnected", tone: "bg-surface-hover text-muted", dot: "bg-muted" },
};

const MODERATION_LABEL: Record<InstagramCard["moderationMode"], string> = {
  OFF: "Off",
  OBSERVE: "Observe only",
  HIDE: "Hide",
};

const btn =
  "inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50";
const btnPrimary = `${btn} bg-accent text-white hover:bg-accent-hover`;
const btnSecondary = `${btn} bg-surface-hover text-foreground hover:bg-border`;
const btnDanger = `${btn} border border-error/30 text-error hover:bg-error/10`;

export default function ChannelsPage() {
  const t = useT();
  const router = useRouter();
  const [data, setData] = useState<Overview | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      fetch("/api/channels", { cache: "no-store" })
        .then((res) => res.json())
        .then((payload) => {
          if (payload.success) {
            setData(payload.data);
            setLoadError(null);
          } else {
            setLoadError(payload.error ?? "error");
          }
        })
        .catch(() => setLoadError("error"))
        .finally(() => setLoading(false)),
    []
  );

  useEffect(() => {
    void load();
    fetch("/api/workspace/members")
      .then((r) => r.json())
      .then((p) => p.success && setRole(p.data.currentUserRole))
      .catch(() => undefined);
  }, [load]);

  // After any change: new card data + the banner in the layout.
  const refresh = useCallback(async () => {
    await load();
    router.refresh();
  }, [load, router]);

  const canManage = role === "OWNER" || role === "ADMIN";
  const instagram = data?.instagram ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <Suspense fallback={null}>
        <InstagramConnectNotice />
      </Suspense>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm text-muted">
            {t("Every channel the Lead Engine talks through. Disconnecting turns a channel off and never deletes anything.")}
          </p>
        </div>
        {canManage && (
          <a href="/api/instagram/connect" className={`${btnPrimary} shrink-0`}>
            {instagram.length > 0 ? t("Connect another account") : t("Connect Instagram")}
          </a>
        )}
      </div>

      <section className="space-y-4">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <InstagramGlyph className="h-5 w-5" />
          Instagram
        </h2>

        {loading && <div className="panel h-56 animate-pulse rounded-xl" />}

        {!loading && loadError && (
          <div className="rounded-xl border border-error/20 bg-error/10 p-4 text-sm text-error">
            {t("Could not load the channels. Try again in a moment.")}
          </div>
        )}

        {!loading && !loadError && instagram.length === 0 && (
          <div className="panel rounded-xl p-6 text-center">
            <p className="text-sm font-semibold">{t("No Instagram account connected yet")}</p>
            <p className="mt-1 text-sm text-muted">
              {t("Connect an Instagram professional account to launch campaigns.")}
            </p>
          </div>
        )}

        {instagram.map((card) => (
          <InstagramChannelCard key={card.id} card={card} role={role} onChanged={refresh} />
        ))}
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold">{t("Coming soon")}</h2>
          <p className="mt-1 text-sm text-muted">{t("Channels we can turn on next, and what each one needs.")}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {(data?.comingSoon ?? []).map((channel) => (
            <ComingSoonCard key={channel.platform} channel={channel} />
          ))}
        </div>
      </section>
    </div>
  );
}

function InstagramChannelCard({
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
            <p className="truncate text-base font-semibold">@{card.username}</p>
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
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">{t("Subscribed webhooks")}</p>
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
            <a href="/api/instagram/connect" className={isOn ? btnSecondary : btnPrimary}>
              {t("Reconnect")}
            </a>
            {!isOff && (
              <button type="button" onClick={runTest} disabled={testing} className={btnSecondary}>
                {testing ? t("Testing...") : t("Test connection")}
              </button>
            )}
            {!isOff && !confirmDisconnect && (
              <button type="button" onClick={() => setConfirmDisconnect(true)} className={btnDanger}>
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
              <button type="button" onClick={disconnect} disabled={disconnecting} className={`${btn} bg-foreground text-background hover:opacity-85`}>
                {disconnecting ? t("Disconnecting...") : t("Yes, disconnect")}
              </button>
              <button type="button" onClick={() => setConfirmDisconnect(false)} disabled={disconnecting} className={btnSecondary}>
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
              className={`${btn} bg-error text-white hover:opacity-90`}
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

function ComingSoonCard({ channel }: { channel: ComingSoon }) {
  const t = useT();
  return (
    <div className="panel rounded-xl p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 font-semibold">
          <PlatformGlyph platform={channel.platform} />
          {channel.name}
        </p>
        <span className="rounded-full bg-surface-hover px-2.5 py-1 text-xs font-semibold text-muted">{t("Coming soon")}</span>
      </div>
      <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted">{t("What's missing to turn it on")}</p>
      <ul className="mt-1.5 space-y-1 text-sm">
        {channel.requirements.map((req) => (
          <li key={req} className="flex gap-2">
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-muted" />
            <span>{t(req)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const glyphStroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function InstagramGlyph({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <rect {...glyphStroke} x="3" y="3" width="18" height="18" rx="5" />
      <circle {...glyphStroke} cx="12" cy="12" r="4" />
      <path {...glyphStroke} d="M17.5 6.5h.01" />
    </svg>
  );
}

function PlatformGlyph({ platform }: { platform: ComingSoon["platform"] }) {
  const cls = "h-5 w-5 text-muted";
  switch (platform) {
    case "telegram":
      return (
        <svg viewBox="0 0 24 24" className={cls} aria-hidden>
          <path {...glyphStroke} d="M21.5 4.5 2.8 11.7c-.8.3-.8 1.4 0 1.6l4.7 1.5 1.8 5.6c.2.7 1.1.9 1.6.4l2.6-2.5 4.8 3.5c.6.4 1.4.1 1.6-.6l3-15.4c.2-.9-.6-1.6-1.4-1.3zM7.5 14.8 18 7.5l-7.9 8.1" />
        </svg>
      );
    case "whatsapp":
      return (
        <svg viewBox="0 0 24 24" className={cls} aria-hidden>
          <path {...glyphStroke} d="M3.5 20.5 5 16.3A8.5 8.5 0 1 1 8 19.2z" />
          <path {...glyphStroke} d="M9 8.5c0 3.5 3 6.5 6.5 6.5l1-1.5-2-1-1 .8c-1-.4-2-1.4-2.4-2.4l.8-1-1-2z" />
        </svg>
      );
    case "messenger":
      return (
        <svg viewBox="0 0 24 24" className={cls} aria-hidden>
          <path {...glyphStroke} d="M12 3C7 3 3 6.7 3 11.4c0 2.6 1.2 4.9 3.2 6.4V21l3-1.6c.9.2 1.8.4 2.8.4 5 0 9-3.7 9-8.4S17 3 12 3z" />
          <path {...glyphStroke} d="m7.5 13.5 3-3.2 2.2 2.2 3.8-2.5-3 3.2-2.2-2.2z" />
        </svg>
      );
    case "threads":
      return (
        <svg viewBox="0 0 24 24" className={cls} aria-hidden>
          <path {...glyphStroke} d="M17 8.5C16 5.5 14 4 11.8 4 7.7 4 5 7.4 5 12s2.7 8 6.8 8c3.4 0 6-2 6-5 0-2.6-2.2-4.2-5.2-4.2-2.2 0-3.6 1.1-3.6 2.6 0 1.4 1.2 2.4 2.8 2.4 2.6 0 3.7-2.3 3.4-6" />
        </svg>
      );
  }
}
