import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import { auth } from "@/lib/auth";
import { getSecurityState } from "@/lib/account-security";
import { safeCallbackPath } from "@/lib/auth-config";
import { AuthCard } from "@/components/auth/auth-card";
import { TwoFactorSetup } from "@/components/auth/two-factor-setup";

/**
 * Fase 0: ativar o 2FA. Pro admin é obrigatório: o painel manda pra cá até o
 * 2FA estar ligado (app/(dashboard)/layout.tsx).
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Two-step verification - Lead Engine") };
}

export default async function TwoFactorSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const t = await getT();
  const session = await auth();
  if (!session) redirect("/login");
  const next = safeCallbackPath((await searchParams).callbackUrl ?? "/settings", "http://local.invalid");
  if (session.user.twoFactorEnabled) redirect(next);
  const state = await getSecurityState(session.user.id);
  const required = session.user.role === "ADMIN";

  return (
    <AuthCard title={t("Two-step verification")}>
      {required && (
        <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-900" role="status">
          {t("Your account is the Lead Engine admin, so two-step verification is required. Turn it on to continue.")}
        </p>
      )}
      <TwoFactorSetup hasPassword={state.hasPassword} next={next} />
    </AuthCard>
  );
}
