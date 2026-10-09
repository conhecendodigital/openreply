import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import LegalCompanyLine from "@/components/legal-company-line";
import { getT } from "@/lib/i18n/server";
import { LeadEngineLogo } from "@/components/sidebar";
import { LangSwitch } from "@/components/lang-provider";
import { LoginForm } from "@/components/auth/login-form";
import { auth } from "@/lib/auth";
import { isGoogleLoginConfigured } from "@/lib/better-auth";
import { safeCallbackPath } from "@/lib/auth-config";

/**
 * Criar conta (09/10/2026, pedido do dono). Não abre cadastro por senha
 * (disableSignUp continua true): a conta nasce no primeiro link por e-mail ou
 * no Google, e só pra quem tem acesso (ALLOWED_EMAILS, lista do beta ou convite
 * de equipe, ver lib/auth-signin.ts). A senha a pessoa cria depois em
 * Configurações, Segurança. Assim ninguém cria conta com o e-mail de outro.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t("Create account - Lead Engine"),
    description: t("Create your Lead Engine account with an email link or Google."),
  };
}

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const t = await getT();
  const params = await searchParams;
  const callbackUrl = safeCallbackPath(params.callbackUrl ?? "/dashboard", "http://local.invalid");

  const session = await auth().catch(() => null);
  if (session) redirect(callbackUrl);

  return (
    <div className="flex min-h-screen flex-col bg-[#fafafa] text-foreground">
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-10">
        <div className="w-full max-w-[350px] space-y-3">
          <div className="rounded-xl border border-border bg-white px-6 pb-8 pt-10 sm:px-10">
            <h1 className="flex justify-center text-foreground">
              <LeadEngineLogo className="scale-125" />
            </h1>
            <p className="mt-6 text-center text-[15px] font-semibold leading-snug text-muted">
              {t("Create your account to manage your comments, Direct and contacts.")}
            </p>

            <LoginForm
              callbackUrl={callbackUrl}
              googleEnabled={isGoogleLoginConfigured()}
              initialError={params.error ?? null}
              initialMode="link"
            />

            <ol className="mt-6 space-y-1 text-xs leading-relaxed text-muted">
              <li>{t("1. Type your email and get the link (or use Google).")}</li>
              <li>{t("2. Open the link: your account is created on the spot.")}</li>
              <li>{t("3. Create your password in Settings, Security.")}</li>
            </ol>
          </div>

          <div className="rounded-xl border border-border bg-white px-6 py-5 text-center text-sm">
            <p className="text-muted">
              {t("Only emails with access get the link. No access yet? Ask whoever invited you to add your email.")}
            </p>
            <p className="mt-3">
              {t("Already have an account?")}{" "}
              <Link href="/login" className="font-semibold text-accent hover:underline">
                {t("Sign in")}
              </Link>
            </p>
          </div>
        </div>
      </main>

      <footer className="px-4 pb-8 text-center text-xs text-muted">
        <nav className="flex flex-wrap justify-center gap-x-4 gap-y-2" aria-label={t("Lead Engine")}>
          <Link href="/" className="hover:underline">{t("Lead Engine")}</Link>
          <Link href="/privacy" className="hover:underline">{t("Privacy")}</Link>
          <Link href="/terms" className="hover:underline">{t("Terms")}</Link>
        </nav>
        <div className="mt-4 flex items-center justify-center gap-2">
          <span>{t("Language")}</span>
          <LangSwitch />
        </div>
        <LegalCompanyLine className="mt-4" />
      </footer>
    </div>
  );
}
