"use client";

/**
 * Notice for the ?instagram= / ?connected= codes the OAuth routes redirect
 * back with. Since 2026-10-05 they land on /channels.
 */

import { useSearchParams } from "next/navigation";

import { useT } from "@/components/lang-provider";
type Tone = "error" | "warning" | "success";

const TONE_CLASSES: Record<Tone, string> = {
  error: "border-error/20 bg-error/10 text-error",
  warning: "border-warning/20 bg-warning/10 text-warning",
  success: "border-success/20 bg-success/10 text-success",
};

const MESSAGES: Record<string, { tone: Tone; title: string; detail: string }> = {
  denied: {
    tone: "warning",
    title: "Instagram connection cancelled",
    detail:
      "You declined the permission prompt on Instagram. Start again and accept all requested permissions.",
  },
  invalid: {
    tone: "error",
    title: "Instagram connection expired",
    detail:
      "The login link was missing or older than 10 minutes. Click Connect Instagram to start a fresh attempt.",
  },
  forbidden: {
    tone: "error",
    title: "Not permitted",
    detail:
      "Only workspace owners and admins can connect an Instagram account.",
  },
  already_connected: {
    tone: "warning",
    title: "Account already connected",
    detail:
      "That Instagram account belongs to another workspace (even if it is disconnected there). Delete it for real there first, or connect a different account.",
  },
};

const FACEBOOK_MESSAGES: Record<string, { tone: Tone; title: string; detail: string }> = {
  denied: {
    tone: "warning",
    title: "Facebook connection cancelled",
    detail: "You declined the permission prompt on Facebook. Start again and accept all requested permissions.",
  },
  invalid: {
    tone: "error",
    title: "Facebook connection expired",
    detail: "The login link was missing or older than 10 minutes. Click Connect Facebook Page to try again.",
  },
  forbidden: {
    tone: "error",
    title: "Not permitted",
    detail: "Only workspace owners and admins can connect a Facebook Page.",
  },
  no_pages: {
    tone: "warning",
    title: "No Page selected",
    detail: "Facebook returned no Page. Connect again and tick the Page in the Facebook window.",
  },
  already_connected: {
    tone: "warning",
    title: "Page already connected",
    detail: "That Page belongs to another workspace (even if it is disconnected there).",
  },
};

export function InstagramConnectNotice() {
  const t = useT();
  const searchParams = useSearchParams();
  const status = searchParams.get("instagram");
  const facebook = searchParams.get("facebook");

  // 23/10/2026: Facebook Page connect (app/api/facebook/callback).
  if (facebook) {
    const known = FACEBOOK_MESSAGES[facebook];
    if (facebook === "connected") {
      return (
        <Notice tone="success" title={t("Facebook Page connected")}>
          <p>{t("{n} Page(s) on. Campaigns can now answer comments and Messenger messages on them.", { n: searchParams.get("pages") ?? "1" })}</p>
        </Notice>
      );
    }
    if (facebook === "misconfigured") {
      return (
        <Notice tone="error" title={t("Facebook app not configured")}>
          <p>{t("Set these environment variables and restart the server:")}</p>
          <p className="mt-2 font-mono text-xs">{(searchParams.get("missing") ?? "").split(",").filter(Boolean).join(", ")}</p>
        </Notice>
      );
    }
    if (facebook === "failed") {
      return (
        <Notice tone="error" title={t("Facebook Page connection failed")}>
          <p>{t("Facebook accepted the login but the Page could not be connected. Usually a missing permission or a redirect URI not added in the Meta app.")}</p>
          {searchParams.get("reason") && (
            <p className="mt-2 font-mono text-xs break-words opacity-80">{searchParams.get("reason")}</p>
          )}
        </Notice>
      );
    }
    if (!known) return null;
    return (
      <Notice tone={known.tone} title={t(known.title)}>
        <p>{t(known.detail)}</p>
      </Notice>
    );
  }

  if (!status && searchParams.get("connected") === "true") {
    return (
      <Notice tone="success" title={t("Instagram connected")}>
        <p>{t("The channel is on. If it was connected before, its campaigns, contacts and history came back as they were.")}</p>
      </Notice>
    );
  }

  if (!status) return null;

  if (status === "misconfigured") {
    const missing = (searchParams.get("missing") ?? "")
      .split(",")
      .filter(Boolean);

    return (
      <Notice tone="error" title={t("Instagram app not configured")}>
        <p>
          {t("Set")}{" "}
          {missing.length > 0
            ? t("these environment variables")
            : t("the required environment variables")}{" "}
          {t("and restart the server:")}
        </p>
        {missing.length > 0 && (
          <ul className="mt-2 space-y-1">
            {missing.map((name) => (
              <li key={name} className="font-mono text-xs">
                {name}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2">
          {t("See")} <span className="font-mono text-xs">{t("docs/setup.md")}</span> {t("for how to obtain each value. Note that")}{" "}
          <span className="font-mono text-xs">{t("ENCRYPTION_KEY")}</span> {t("must be a 64-character hex string.")}
        </p>
      </Notice>
    );
  }

  if (status === "failed") {
    const reason = searchParams.get("reason");

    return (
      <Notice tone="error" title={t("Instagram connection failed")}>
        <p>
          {t("Instagram accepted the login but the connection could not be completed. This is usually a mismatched redirect URI or an app that is missing the required permissions.")}
        </p>
        {reason && (
          <p className="mt-2 font-mono text-xs break-words opacity-80">
            {reason}
          </p>
        )}
      </Notice>
    );
  }

  const known = MESSAGES[status];
  if (!known) return null;

  return (
    <Notice tone={known.tone} title={t(known.title)}>
      <p>{t(known.detail)}</p>
    </Notice>
  );
}

function Notice({
  tone,
  title,
  children,
}: {
  tone: Tone;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded border p-4 text-sm ${TONE_CLASSES[tone]}`}>
      <p className="font-semibold">{title}</p>
      <div className="mt-1 opacity-90">{children}</div>
    </div>
  );
}
