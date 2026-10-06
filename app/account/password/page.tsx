import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import { auth } from "@/lib/auth";
import { getSecurityState } from "@/lib/account-security";
import { safeCallbackPath } from "@/lib/auth-config";
import { AuthCard } from "@/components/auth/auth-card";
import { CreatePasswordForm } from "@/components/auth/create-password-form";

/** Fase 0: primeiro acesso de quem só entrava pelo link. Cria a senha (ou "agora não"). */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Create your password - Lead Engine") };
}

export default async function CreatePasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const t = await getT();
  const session = await auth();
  if (!session) redirect("/login");
  const next = safeCallbackPath((await searchParams).callbackUrl, "http://local.invalid");
  const state = await getSecurityState(session.user.id);
  if (state.hasPassword) redirect(next);

  return (
    <AuthCard title={t("Create your password")}>
      <p className="mb-4 text-center text-sm leading-6 text-muted">
        {t("Now you can also sign in with email and password. The link by email keeps working.")}
      </p>
      <CreatePasswordForm next={next} allowSkip />
    </AuthCard>
  );
}
