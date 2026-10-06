"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useT } from "@/components/lang-provider";
import { authClient, authErrorKey } from "@/lib/auth-client";

/** Desafio do 2FA no login: código do app autenticador ou código de recuperação. */
export function TwoFactorChallenge({ callbackUrl }: { callbackUrl: string }) {
  const t = useT();
  const router = useRouter();
  const [useBackup, setUseBackup] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const clean = code.replace(/\s+/g, "");
    const { error: err } = useBackup
      ? await authClient.twoFactor.verifyBackupCode({ code: clean })
      : await authClient.twoFactor.verifyTotp({ code: clean });
    setBusy(false);
    if (err) {
      setError(authErrorKey(err));
      return;
    }
    router.push(callbackUrl);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-3">
      <p className="text-center text-sm leading-6 text-muted">
        {useBackup
          ? t("Type one of the recovery codes you saved. Each one works only once.")
          : t("Open your authenticator app and type the 6 digit code for Lead Engine.")}
      </p>
      <label htmlFor="code" className="sr-only">
        {t("Code")}
      </label>
      <input
        id="code"
        name="code"
        required
        autoFocus
        autoComplete="one-time-code"
        inputMode={useBackup ? "text" : "numeric"}
        placeholder={useBackup ? t("Recovery code") : "123456"}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        className="h-11 w-full rounded-md border border-border bg-[#fafafa] px-3 text-center text-base tracking-widest text-foreground placeholder:text-muted focus:border-accent focus:bg-white"
      />
      {error && (
        <p role="alert" className="text-center text-sm text-red-600">
          {t(error)}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="h-10 w-full rounded-lg bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-60"
      >
        {busy ? t("Please wait...") : t("Confirm")}
      </button>
      <p className="pt-2 text-center">
        <button
          type="button"
          onClick={() => {
            setUseBackup(!useBackup);
            setCode("");
            setError(null);
          }}
          className="text-sm font-semibold text-accent hover:underline"
        >
          {useBackup ? t("Use the authenticator app") : t("Lost your phone? Use a recovery code")}
        </button>
      </p>
      <p className="text-center">
        <Link href="/login" className="text-xs text-muted hover:underline">
          {t("Back to sign in")}
        </Link>
      </p>
    </form>
  );
}
