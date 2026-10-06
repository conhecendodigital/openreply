"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/components/lang-provider";
import { authClient, authErrorKey } from "@/lib/auth-client";
import { encodeQr, qrSvgPath } from "@/lib/qr";

function QrCode({ text, label }: { text: string; label: string }) {
  const { path, size } = useMemo(() => qrSvgPath(encodeQr(text)), [text]);
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      className="mx-auto h-48 w-48 rounded-lg border border-border bg-white"
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}

/** Mostra os códigos de recuperação com botão de baixar. */
export function BackupCodes({ codes }: { codes: string[] }) {
  const t = useT();
  const text = codes.join("\n");
  const href = `data:text/plain;charset=utf-8,${encodeURIComponent(
    `Lead Engine: códigos de recuperação do 2FA\nCada código funciona uma vez só.\n\n${text}\n`
  )}`;
  return (
    <div>
      <ul className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-[#fafafa] p-3 font-mono text-sm">
        {codes.map((c) => (
          <li key={c} className="text-center">
            {c}
          </li>
        ))}
      </ul>
      <p className="mt-3 flex flex-wrap justify-center gap-4 text-sm">
        <a href={href} download="lead-engine-codigos-2fa.txt" className="font-semibold text-accent hover:underline">
          {t("Download codes")}
        </a>
        <button
          type="button"
          onClick={() => navigator.clipboard?.writeText(text).catch(() => {})}
          className="font-semibold text-accent hover:underline"
        >
          {t("Copy codes")}
        </button>
      </p>
    </div>
  );
}

/** Ativar o 2FA: QR code, confirmação com um código e os 10 códigos de recuperação. */
export function TwoFactorSetup({ hasPassword, next }: { hasPassword: boolean; next: string }) {
  const t = useT();
  const router = useRouter();
  const [step, setStep] = useState<"start" | "scan" | "codes">("start");
  const [password, setPassword] = useState("");
  const [uri, setUri] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const secret = useMemo(() => {
    try {
      return uri ? new URL(uri).searchParams.get("secret") ?? "" : "";
    } catch {
      return "";
    }
  }, [uri]);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error: err } = await authClient.twoFactor.enable({
      ...(hasPassword ? { password } : {}),
      issuer: "Lead Engine",
    } as { password: string; issuer: string });
    setBusy(false);
    if (err || !data) return setError(authErrorKey(err));
    const out = data as { totpURI?: string; backupCodes?: string[] };
    setUri(out.totpURI ?? "");
    setCodes(out.backupCodes ?? []);
    setStep("scan");
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await authClient.twoFactor.verifyTotp({ code: code.replace(/\s+/g, "") });
    setBusy(false);
    if (err) return setError(authErrorKey(err));
    setStep("codes");
  }

  if (step === "start") {
    return (
      <form onSubmit={start} className="space-y-3">
        <p className="text-sm leading-6 text-muted">
          {t("Install an authenticator app on your phone (Google Authenticator, Authy or Microsoft Authenticator). After that, every sign in asks for the code that shows up in it.")}
        </p>
        {hasPassword && (
          <>
            <label htmlFor="tf-password" className="sr-only">
              {t("Your password")}
            </label>
            <input
              id="tf-password"
              type="password"
              required
              autoComplete="current-password"
              placeholder={t("Your password")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11 w-full rounded-md border border-border bg-[#fafafa] px-3 text-sm focus:border-accent focus:bg-white"
            />
          </>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {t(error)}
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="h-10 w-full rounded-lg bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-60"
        >
          {busy ? t("Please wait...") : t("Turn on two-step verification")}
        </button>
      </form>
    );
  }

  if (step === "scan") {
    return (
      <form onSubmit={confirm} className="space-y-3">
        <p className="text-sm leading-6 text-muted">
          {t("1. In the app, tap to add an account and scan this QR code.")}
        </p>
        <QrCode text={uri} label={t("QR code for the authenticator app")} />
        <p className="text-center text-xs text-muted">
          {t("Cannot scan? Type this key in the app:")}
          <br />
          <code className="mt-1 inline-block break-all font-mono text-[13px] text-foreground">{secret}</code>
        </p>
        <p className="pt-2 text-sm leading-6 text-muted">{t("2. Type the 6 digit code the app shows.")}</p>
        <label htmlFor="tf-code" className="sr-only">
          {t("Code")}
        </label>
        <input
          id="tf-code"
          required
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="123456"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="h-11 w-full rounded-md border border-border bg-[#fafafa] px-3 text-center tracking-widest focus:border-accent focus:bg-white"
        />
        {error && (
          <p role="alert" className="text-sm text-red-600">
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
      </form>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-muted">
        {t("Done! Save these recovery codes somewhere safe. If you lose your phone, each one lets you in once.")}
      </p>
      <BackupCodes codes={codes} />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="mt-1" />
        <span>{t("I saved my recovery codes")}</span>
      </label>
      <button
        type="button"
        disabled={!saved}
        onClick={() => {
          router.push(next);
          router.refresh();
        }}
        className="h-10 w-full rounded-lg bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-60"
      >
        {t("Continue")}
      </button>
    </div>
  );
}
