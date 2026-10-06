"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/components/lang-provider";
import { authClient, authErrorKey } from "@/lib/auth-client";

const INPUT =
  "h-11 w-full rounded-md border border-border bg-[#fafafa] px-3 text-sm text-foreground placeholder:text-muted transition-colors focus:border-accent focus:bg-white";
const PRIMARY =
  "h-10 w-full rounded-lg bg-accent px-4 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-60";

function Divider({ label }: { label: string }) {
  return (
    <div className="my-5 flex items-center gap-4" role="separator" aria-hidden="true">
      <span className="h-px flex-1 bg-border" />
      <span className="text-[13px] font-semibold uppercase text-muted">{label}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" className="h-4 w-4">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

/** Erros que voltam do link do e-mail ou do Google na URL (?error=...). */
function urlErrorKey(code: string | null): string | null {
  if (!code) return null;
  if (code === "INVALID_TOKEN" || code === "EXPIRED_TOKEN") return "This link expired or was already used. Ask for a new one.";
  if (code === "EMAIL_NOT_ALLOWED" || code === "signup_disabled" || code === "unable_to_create_user")
    return "This email does not have access to Lead Engine.";
  if (code === "account_not_linked")
    return "Google did not confirm this email. Sign in with the link and connect Google in Settings.";
  return "Could not sign in. Try again.";
}

export function LoginForm({
  callbackUrl,
  googleEnabled,
  initialError,
}: {
  callbackUrl: string;
  googleEnabled: boolean;
  initialError: string | null;
}) {
  const t = useT();
  const router = useRouter();
  const [mode, setMode] = useState<"password" | "link">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(urlErrorKey(initialError));
  const [linkSent, setLinkSent] = useState(false);

  const errorUrl = `/login?callbackUrl=${encodeURIComponent(callbackUrl)}`;

  async function signInWithPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error: err } = await authClient.signIn.email({ email: email.trim(), password });
    setBusy(false);
    if (err) {
      setError(authErrorKey(err));
      return;
    }
    if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) {
      router.push(`/login/2fa?callbackUrl=${encodeURIComponent(callbackUrl)}`);
      return;
    }
    router.push(callbackUrl);
    router.refresh();
  }

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await authClient.signIn.magicLink({
      email: email.trim(),
      callbackURL: callbackUrl,
      errorCallbackURL: errorUrl,
    });
    setBusy(false);
    if (err) {
      setError(authErrorKey(err));
      return;
    }
    setLinkSent(true);
  }

  async function signInWithGoogle() {
    setBusy(true);
    setError(null);
    const { error: err } = await authClient.signIn.social({
      provider: "google",
      callbackURL: callbackUrl,
      errorCallbackURL: errorUrl,
    });
    if (err) {
      setBusy(false);
      setError(authErrorKey(err));
    }
  }

  if (linkSent) {
    return (
      <div className="mt-6 text-center" role="status">
        <h2 className="text-base font-semibold">{t("Check your email")}</h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          {t("If your email has access, the link arrives in a few seconds. It is valid for 15 minutes.")}
        </p>
        <button
          type="button"
          onClick={() => setLinkSent(false)}
          className="mt-5 text-sm font-semibold text-accent hover:underline"
        >
          {t("Use another email")}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-6">
      {googleEnabled && (
        <>
          <button
            type="button"
            onClick={signInWithGoogle}
            disabled={busy}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-border bg-white px-4 text-sm font-semibold text-foreground transition-colors hover:bg-[#fafafa] disabled:opacity-60"
          >
            <GoogleIcon />
            {t("Continue with Google")}
          </button>
          <Divider label={t("or")} />
        </>
      )}

      <form onSubmit={mode === "password" ? signInWithPassword : sendLink} className="space-y-3">
        <div>
          <label htmlFor="email" className="sr-only">
            {t("Email")}
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            inputMode="email"
            placeholder={t("Your email")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={INPUT}
          />
        </div>

        {mode === "password" && (
          <div>
            <label htmlFor="password" className="sr-only">
              {t("Password")}
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              placeholder={t("Password")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={INPUT}
            />
          </div>
        )}

        {error && (
          <p role="alert" className="text-center text-sm text-red-600">
            {t(error)}
          </p>
        )}

        <button type="submit" disabled={busy} className={PRIMARY}>
          {busy ? t("Please wait...") : mode === "password" ? t("Sign in") : t("Send access link")}
        </button>
      </form>

      <p className="mt-4 text-center text-xs leading-5 text-muted">
        {mode === "password"
          ? t("No password yet, or forgot it? Sign in with the link and create one in Settings, Security.")
          : t("We send a sign in link to your email. No password to remember.")}
      </p>
      <p className="mt-3 text-center">
        <button
          type="button"
          onClick={() => {
            setMode(mode === "password" ? "link" : "password");
            setError(null);
          }}
          className="text-sm font-semibold text-accent hover:underline"
        >
          {mode === "password" ? t("Get a link by email instead") : t("Sign in with password")}
        </button>
      </p>
    </div>
  );
}
