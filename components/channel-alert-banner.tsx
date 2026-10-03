"use client";

/**
 * Banner at the top of the panel when a channel needs attention (2026-10-05):
 * token expiring in under 10 days, token expired, channel that needs to be
 * reconnected, webhooks not subscribed or silent for over 24 h.
 * The alerts come from getChannelAlerts (layout, no Meta call). Hidden on the
 * Channels page itself, which shows the same alerts on each card.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/components/lang-provider";
import type { TFunction } from "@/lib/i18n";

export type BannerAlert = {
  code: "needs_reconnect" | "token_expired" | "token_expiring" | "webhooks_stale" | "webhooks_not_subscribed";
  instagramAccountId: string;
  username: string;
  message: string;
  days?: number;
  hours?: number;
};

/** Translated text for one alert (built from the code, not the English message). */
export function channelAlertText(t: TFunction, alert: BannerAlert): string {
  const username = alert.username;
  switch (alert.code) {
    case "needs_reconnect":
      return t("@{username} needs to be reconnected", { username });
    case "token_expired":
      return t("@{username}: the token expired", { username });
    case "token_expiring":
      return alert.days !== undefined && alert.days <= 0
        ? t("@{username}: the token expires today", { username })
        : t("@{username}: the token expires in {n} day(s)", { username, n: alert.days ?? "?" });
    case "webhooks_not_subscribed":
      return t("@{username}: webhooks are not subscribed", { username });
    case "webhooks_stale":
      return t("@{username}: no webhook received in over {h}h", { username, h: alert.hours ?? 24 });
    default:
      return alert.message;
  }
}

/** Serious = the channel is not working at all (red); the rest is a warning (amber). */
export function isSeriousAlert(alert: BannerAlert): boolean {
  return alert.code === "needs_reconnect" || alert.code === "token_expired";
}

export default function ChannelAlertBanner({ alerts }: { alerts: BannerAlert[] }) {
  const t = useT();
  const pathname = usePathname();
  if (alerts.length === 0 || pathname === "/channels" || pathname.startsWith("/channels/")) return null;

  const serious = alerts.some(isSeriousAlert);
  const shown = alerts.slice(0, 3);
  const rest = alerts.length - shown.length;

  return (
    <div
      role="alert"
      className={`mb-5 flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between ${
        serious ? "border-error/30 bg-error/10" : "border-warning/30 bg-warning/10"
      }`}
    >
      <div className="flex min-w-0 gap-3">
        <svg
          viewBox="0 0 24 24"
          className={`mt-0.5 h-5 w-5 shrink-0 ${serious ? "text-error" : "text-warning"}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01" />
        </svg>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{t("A channel needs attention")}</p>
          <ul className="mt-1 space-y-0.5 text-sm text-foreground/80">
            {shown.map((alert) => (
              <li key={`${alert.instagramAccountId}:${alert.code}`} className="break-words">
                {channelAlertText(t, alert)}
              </li>
            ))}
            {rest > 0 && <li className="text-muted">{t("+{n} more", { n: rest })}</li>}
          </ul>
        </div>
      </div>
      <Link
        href="/channels"
        className="shrink-0 self-start rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-background transition-opacity hover:opacity-85 sm:self-center"
      >
        {t("Open Channels")}
      </Link>
    </div>
  );
}
