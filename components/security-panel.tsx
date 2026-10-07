"use client";

/**
 * Fase 0 (06/10/2026): Configurações, Segurança. Senha (criar ou trocar),
 * Google, 2FA (ligar, códigos novos, desligar) e sessões abertas.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useT } from "@/components/lang-provider";
import { authClient, authErrorKey } from "@/lib/auth-client";
import { CreatePasswordForm } from "@/components/auth/create-password-form";
import { BackupCodes } from "@/components/auth/two-factor-setup";
import { CollapsibleSection } from "@/components/ui/collapsible-section";

type Security = {
  email: string | null;
  role: "USER" | "ADMIN";
  twoFactorEnabled: boolean;
  twoFactorRequired: boolean;
  googleEnabled: boolean;
  hasPassword: boolean;
  hasGoogle: boolean;
};

type SessionRow = {
  id: string;
  token: string;
  createdAt: string | Date;
  updatedAt: string | Date;
  ipAddress?: string | null;
  userAgent?: string | null;
};

const INPUT = "h-10 w-full rounded-md border border-border bg-[#fafafa] px-3 text-sm focus:border-accent focus:bg-white";
const BUTTON = "h-9 rounded-lg bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-60";
const LINK_BUTTON = "text-sm font-semibold text-accent hover:underline disabled:opacity-60";

function deviceName(ua: string | null | undefined, t: (s: string) => string): string {
  if (!ua) return t("Unknown device");
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : t("Browser");
  const os = /iPhone|iPad/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser}, ${os}` : browser;
}

function ChangePassword() {
  const t = useT();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (next.length < 10) return setMsg({ ok: false, text: "The password needs at least 10 characters." });
    setBusy(true);
    const { error } = await authClient.changePassword({ currentPassword: current, newPassword: next, revokeOtherSessions: true });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: authErrorKey(error) });
    setCurrent("");
    setNext("");
    setMsg({ ok: true, text: "Password changed. Your other sessions were closed." });
  }

  return (
    <form onSubmit={submit} className="grid gap-2 sm:max-w-sm">
      <input type="password" autoComplete="current-password" required placeholder={t("Current password")} aria-label={t("Current password")} value={current} onChange={(e) => setCurrent(e.target.value)} className={INPUT} />
      <input type="password" autoComplete="new-password" required placeholder={t("New password (at least 10 characters)")} aria-label={t("New password")} value={next} onChange={(e) => setNext(e.target.value)} className={INPUT} />
      {msg && (
        <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-green-700" : "text-red-600"}`}>
          {t(msg.text)}
        </p>
      )}
      <div>
        <button type="submit" disabled={busy} className={BUTTON}>
          {busy ? t("Please wait...") : t("Change password")}
        </button>
      </div>
    </form>
  );
}

function TwoFactorBox({ security, reload }: { security: Security; reload: () => void }) {
  const t = useT();
  const [password, setPassword] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!security.twoFactorEnabled) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted">{t("Off. Turn it on so your password alone is not enough to get in.")}</p>
        <Link href="/account/two-factor?callbackUrl=%2Fsettings" className={`${BUTTON} inline-flex items-center`}>
          {t("Turn on two-step verification")}
        </Link>
      </div>
    );
  }

  async function newCodes() {
    setBusy(true);
    setError(null);
    const { data, error: err } = await authClient.twoFactor.generateBackupCodes({ ...(security.hasPassword ? { password } : {}) } as { password: string });
    setBusy(false);
    if (err || !data) return setError(authErrorKey(err));
    setCodes((data as { backupCodes: string[] }).backupCodes);
    setPassword("");
  }

  async function turnOff() {
    setBusy(true);
    setError(null);
    const { error: err } = await authClient.twoFactor.disable({ ...(security.hasPassword ? { password } : {}) } as { password: string });
    setBusy(false);
    if (err) return setError(authErrorKey(err));
    setPassword("");
    reload();
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-green-700">{t("On. Every sign in asks for the code of your authenticator app.")}</p>
      {codes ? (
        <div className="sm:max-w-sm">
          <p className="mb-2 text-sm text-muted">{t("New recovery codes. The old ones stopped working.")}</p>
          <BackupCodes codes={codes} />
        </div>
      ) : (
        <div className="grid gap-2 sm:max-w-sm">
          {security.hasPassword && (
            <input type="password" autoComplete="current-password" placeholder={t("Your password")} aria-label={t("Your password")} value={password} onChange={(e) => setPassword(e.target.value)} className={INPUT} />
          )}
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {t(error)}
            </p>
          )}
          <div className="flex flex-wrap gap-4">
            <button type="button" onClick={newCodes} disabled={busy} className={LINK_BUTTON}>
              {t("Generate new recovery codes")}
            </button>
            {!security.twoFactorRequired && (
              <button type="button" onClick={turnOff} disabled={busy} className="text-sm font-semibold text-red-600 hover:underline disabled:opacity-60">
                {t("Turn off")}
              </button>
            )}
          </div>
          {security.twoFactorRequired && (
            <p className="text-xs text-muted">{t("As the admin, you cannot turn it off.")}</p>
          )}
        </div>
      )}
    </div>
  );
}

function Sessions() {
  const t = useT();
  const router = useRouter();
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fetchSessions = useCallback(() => Promise.all([authClient.listSessions(), authClient.getSession()]), []);
  const apply = useCallback(([list, me]: Awaited<ReturnType<typeof fetchSessions>>) => {
    setRows((list.data as SessionRow[] | null) ?? []);
    setCurrent((me.data?.session as { token?: string } | undefined)?.token ?? null);
  }, []);
  const load = useCallback(async () => apply(await fetchSessions()), [apply, fetchSessions]);

  useEffect(() => {
    fetchSessions()
      .then(apply)
      .catch(() => setRows([]));
  }, [apply, fetchSessions]);

  async function revoke(token: string) {
    setBusy(true);
    await authClient.revokeSession({ token });
    await load();
    setBusy(false);
  }

  async function revokeOthers() {
    setBusy(true);
    await authClient.revokeOtherSessions();
    await load();
    setBusy(false);
  }

  async function signOut() {
    setBusy(true);
    await authClient.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {rows === null ? (
        <p className="text-sm text-muted">{t("Loading...")}</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {rows.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <span>
                <span className="font-semibold">{deviceName(s.userAgent, t)}</span>
                {s.token === current && <span className="ml-2 text-xs font-semibold text-green-700">{t("This device")}</span>}
                <span className="block text-xs text-muted">
                  {[s.ipAddress, new Date(s.updatedAt).toLocaleString()].filter(Boolean).join(" · ")}
                </span>
              </span>
              {s.token !== current && (
                <button type="button" onClick={() => revoke(s.token)} disabled={busy} className={LINK_BUTTON}>
                  {t("Sign out")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-4">
        <button type="button" onClick={revokeOthers} disabled={busy} className={LINK_BUTTON}>
          {t("Sign out of all other devices")}
        </button>
        <button type="button" onClick={signOut} disabled={busy} className="text-sm font-semibold text-red-600 hover:underline disabled:opacity-60">
          {t("Sign out of this device")}
        </button>
      </div>
    </div>
  );
}

export function SecurityPanel() {
  const t = useT();
  const [security, setSecurity] = useState<Security | null>(null);
  const [linking, setLinking] = useState(false);

  const fetchSecurity = useCallback(async (): Promise<Security | null> => {
    const res = await fetch("/api/account/security");
    const json = (await res.json().catch(() => null)) as { success?: boolean; data?: Security } | null;
    return json?.success && json.data ? json.data : null;
  }, []);
  const load = useCallback(async () => {
    const data = await fetchSecurity();
    if (data) setSecurity(data);
  }, [fetchSecurity]);

  useEffect(() => {
    fetchSecurity()
      .then((data) => {
        if (data) setSecurity(data);
      })
      .catch(() => {});
  }, [fetchSecurity]);

  async function connectGoogle() {
    setLinking(true);
    await authClient.linkSocial({ provider: "google", callbackURL: "/settings" });
    setLinking(false);
  }

  return (
    <CollapsibleSection
      id="seguranca"
      title={t("Security")}
      defaultOpen={false}
      attention={Boolean(security?.twoFactorRequired && !security.twoFactorEnabled)}
      badge={
        security
          ? security.twoFactorEnabled
            ? { text: t("Two-step on"), tone: "success" }
            : { text: t("Two-step off"), tone: security.twoFactorRequired ? "warning" : "default" }
          : null
      }
      summary={
        security
          ? [
              security.hasPassword ? t("Password created") : t("No password yet"),
              security.twoFactorEnabled ? t("Two-step on") : t("Two-step off"),
              security.hasGoogle ? t("Google connected") : "",
            ]
              .filter(Boolean)
              .join(" · ")
          : undefined
      }
    >
      {!security ? (
        <p className="text-sm text-muted">{t("Loading...")}</p>
      ) : (
        <div className="space-y-2">
          <CollapsibleSection id="seguranca-senha" variant="group" hideFromIndex defaultOpen={!security.hasPassword} title={t("Password")} summary={security.hasPassword ? t("Password created") : t("No password yet")}>
            {security.hasPassword ? (
              <ChangePassword />
            ) : (
              <div className="sm:max-w-sm">
                <p className="mb-3 text-sm text-muted">{t("You sign in with the link by email. Create a password to sign in faster.")}</p>
                <CreatePasswordForm onDone={load} />
              </div>
            )}
          </CollapsibleSection>

          {security.googleEnabled && (
            <CollapsibleSection id="seguranca-google" variant="group" hideFromIndex defaultOpen={false} title={t("Google")} summary={security.hasGoogle ? t("Google connected") : t("Google not connected")}>
              {security.hasGoogle ? (
                <p className="text-sm text-green-700">{t("Connected. You can sign in with Google.")}</p>
              ) : (
                <button type="button" onClick={connectGoogle} disabled={linking} className={LINK_BUTTON}>
                  {t("Connect Google")}
                </button>
              )}
            </CollapsibleSection>
          )}

          <CollapsibleSection
            id="seguranca-2fa"
            variant="group"
            hideFromIndex
            defaultOpen={!security.twoFactorEnabled}
            attention={security.twoFactorRequired && !security.twoFactorEnabled}
            title={t("Two-step verification")}
            summary={security.twoFactorEnabled ? t("Two-step on") : t("Two-step off")}
          >
            <TwoFactorBox security={security} reload={load} />
          </CollapsibleSection>

          <CollapsibleSection id="seguranca-sessoes" variant="group" hideFromIndex defaultOpen={false} title={t("Active sessions")} summary={t("Where your account is open now")}>
            <Sessions />
          </CollapsibleSection>
        </div>
      )}
    </CollapsibleSection>
  );
}
