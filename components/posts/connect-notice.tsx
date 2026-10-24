"use client";

/** Aviso dos códigos ?tiktok= e ?youtube= que as rotas de conexão devolvem para /posts e /channels. */

import { useSearchParams } from "next/navigation";
import { useT } from "@/components/lang-provider";

type Tone = "error" | "warning" | "success";

const TONE: Record<Tone, string> = {
  error: "border-error/20 bg-error/10 text-error",
  warning: "border-warning/20 bg-warning/10 text-warning",
  success: "border-success/20 bg-success/10 text-success",
};

const MESSAGES: Record<string, { tone: Tone; title: string; detail: string }> = {
  connected: {
    tone: "success",
    title: "TikTok connected",
    detail: "Your TikTok account is ready. Create a post and schedule it.",
  },
  denied: {
    tone: "warning",
    title: "TikTok connection cancelled",
    detail: "You declined the permission prompt on TikTok. Start again and accept the permissions.",
  },
  invalid: {
    tone: "error",
    title: "TikTok connection expired",
    detail: "The login link was missing or older than 10 minutes. Click Connect TikTok to try again.",
  },
  forbidden: {
    tone: "error",
    title: "Not permitted",
    detail: "Only workspace owners and admins can connect a TikTok account.",
  },
  failed: {
    tone: "error",
    title: "TikTok connection failed",
    detail: "TikTok accepted the login but the account could not be connected. Usually a redirect URI that does not match the one in the TikTok app.",
  },
  misconfigured: {
    tone: "error",
    title: "TikTok app not configured",
    detail: "The TikTok keys are not set on the server yet. Add them and restart the server.",
  },
  already_connected: {
    tone: "warning",
    title: "Account already connected",
    detail: "That TikTok account belongs to another workspace.",
  },
};

const YOUTUBE_MESSAGES: Record<string, { tone: Tone; title: string; detail: string }> = {
  connected: {
    tone: "success",
    title: "YouTube connected",
    detail: "Your YouTube channel is ready. Create a post and schedule it.",
  },
  partial: {
    tone: "warning",
    title: "YouTube connected, but some permissions are missing",
    detail: "The channel is connected. Connect it again and accept every permission to use all features.",
  },
  denied: {
    tone: "warning",
    title: "YouTube connection cancelled",
    detail: "You declined the permission prompt on Google. Start again and accept the permissions.",
  },
  invalid: {
    tone: "error",
    title: "YouTube connection expired",
    detail: "The login link was missing or older than 10 minutes. Click Connect YouTube to try again.",
  },
  forbidden: {
    tone: "error",
    title: "Not permitted",
    detail: "Only workspace owners and admins can connect a YouTube channel.",
  },
  failed: {
    tone: "error",
    title: "YouTube connection failed",
    detail: "Google accepted the login but the channel could not be connected. Try again, accepting every permission.",
  },
  misconfigured: {
    tone: "error",
    title: "Google app not configured",
    detail: "The Google keys are not set on the server yet. Add them and restart the server.",
  },
  already_connected: {
    tone: "warning",
    title: "Channel already connected",
    detail: "That YouTube channel belongs to another workspace.",
  },
  api_disabled: {
    tone: "error",
    title: "YouTube Data API is off",
    detail: "Turn on YouTube Data API v3 in the same Google Cloud project, wait a few minutes and try again.",
  },
  no_channel: {
    tone: "error",
    title: "No YouTube channel found",
    detail: "That Google account has no YouTube channel. Create one on YouTube and connect again.",
  },
};

export function ConnectNotice() {
  const t = useT();
  const params = useSearchParams();
  const tiktok = params.get("tiktok");
  const youtube = params.get("youtube");
  const known = youtube ? YOUTUBE_MESSAGES[youtube] : tiktok ? MESSAGES[tiktok] : null;
  if (!known) return null;
  const missing = youtube === "partial" ? (params.get("missing") ?? "").split(",").filter(Boolean) : [];
  return (
    <div role="status" className={`rounded-xl border p-4 text-sm ${TONE[known.tone]}`}>
      <p className="font-semibold">{t(known.title)}</p>
      <p className="mt-1 opacity-90">{t(known.detail)}</p>
      {missing.length > 0 && (
        <p className="mt-1 break-words opacity-90">
          {t("Missing")}: {missing.join(", ")}
        </p>
      )}
    </div>
  );
}
