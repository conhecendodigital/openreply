"use client";

/** Aviso dos códigos ?tiktok= que as rotas de conexão do TikTok devolvem para /posts. */

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

export function TikTokConnectNotice() {
  const t = useT();
  const code = useSearchParams().get("tiktok");
  const known = code ? MESSAGES[code] : null;
  if (!known) return null;
  return (
    <div role="status" className={`rounded-xl border p-4 text-sm ${TONE[known.tone]}`}>
      <p className="font-semibold">{t(known.title)}</p>
      <p className="mt-1 opacity-90">{t(known.detail)}</p>
    </div>
  );
}
