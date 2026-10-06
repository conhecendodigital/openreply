"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/components/lang-provider";

/** Criar a senha no primeiro acesso (ou em Configurações, Segurança). */
export function CreatePasswordForm({
  next,
  allowSkip,
  onDone,
}: {
  next?: string;
  allowSkip?: boolean;
  onDone?: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(body: unknown) {
    const res = await fetch("/api/account/password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as { success?: boolean; error?: string } | null;
    return { ok: res.ok && json?.success, error: json?.error ?? null };
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 10) return setError("The password needs at least 10 characters.");
    if (password !== confirm) return setError("The two passwords are different.");
    setBusy(true);
    const out = await call({ newPassword: password });
    setBusy(false);
    if (!out.ok) return setError(out.error ?? "Something went wrong. Try again.");
    if (onDone) onDone();
    if (next) {
      router.push(next);
      router.refresh();
    }
  }

  async function skip() {
    setBusy(true);
    await call({ skip: true });
    router.push(next ?? "/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label htmlFor="new-password" className="sr-only">
        {t("New password")}
      </label>
      <input
        id="new-password"
        type="password"
        autoComplete="new-password"
        required
        minLength={10}
        placeholder={t("New password (at least 10 characters)")}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="h-11 w-full rounded-md border border-border bg-[#fafafa] px-3 text-sm focus:border-accent focus:bg-white"
      />
      <label htmlFor="confirm-password" className="sr-only">
        {t("Repeat the password")}
      </label>
      <input
        id="confirm-password"
        type="password"
        autoComplete="new-password"
        required
        placeholder={t("Repeat the password")}
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        className="h-11 w-full rounded-md border border-border bg-[#fafafa] px-3 text-sm focus:border-accent focus:bg-white"
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
        {busy ? t("Please wait...") : t("Create password")}
      </button>
      {allowSkip && (
        <p className="text-center">
          <button type="button" onClick={skip} disabled={busy} className="text-sm font-semibold text-accent hover:underline">
            {t("Not now")}
          </button>
        </p>
      )}
    </form>
  );
}
