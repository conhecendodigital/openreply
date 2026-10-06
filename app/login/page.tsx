import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getCampaignTemplate } from "@/lib/templates/campaign-templates";
import { DemoNotice } from "@/components/demo-notice";
import { getT } from "@/lib/i18n/server";
import { LeadEngineLogo } from "@/components/sidebar";
import { LangSwitch } from "@/components/lang-provider";
import { LoginForm } from "@/components/auth/login-form";
import { auth } from "@/lib/auth";
import { isGoogleLoginConfigured } from "@/lib/better-auth";
import { safeCallbackPath } from "@/lib/auth-config";

/**
 * Login (2026-10-04, visual do instagram.com). Fase 0 (06/10/2026): login
 * novo com três jeitos de entrar: senha, Google e link por e-mail.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t("Sign in - Lead Engine"),
    description: t("Sign in to manage your Instagram comment and Direct automations."),
  };
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    callbackUrl?: string;
    template?: string;
    error?: string;
  }>;
}) {
  const t = await getT();
  const params = await searchParams;
  const selectedTemplate = getCampaignTemplate(params.template);
  const templateCallbackUrl = selectedTemplate ? `/campaigns/new?template=${selectedTemplate.slug}` : null;
  const callbackUrl = safeCallbackPath(params.callbackUrl ?? templateCallbackUrl ?? "/dashboard", "http://local.invalid");

  // Já logado de verdade (sessão conferida no banco, não só o cookie)? Vai pro painel.
  const session = await auth().catch(() => null);
  if (session) redirect(callbackUrl);

  return (
    <div className="flex min-h-screen flex-col bg-[#fafafa] text-foreground">
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-10">
        <div className="w-full max-w-[350px] space-y-3">
          <DemoNotice variant="panel" />

          <div className="rounded-xl border border-border bg-white px-6 pb-8 pt-10 sm:px-10">
            <h1 className="flex justify-center text-foreground">
              <LeadEngineLogo className="scale-125" />
            </h1>
            <p className="mt-6 text-center text-[15px] font-semibold leading-snug text-muted">
              {selectedTemplate
                ? t("Sign in to use the {name} template.", { name: t(selectedTemplate.title) })
                : t("Sign in to manage your comments, Direct and contacts.")}
            </p>

            {selectedTemplate && (
              <div className="mt-5 rounded-lg border border-border bg-[#fafafa] px-4 py-3">
                <p className="text-xs font-semibold text-muted">{t("Template selected")}</p>
                <p className="mt-1 text-sm font-semibold text-foreground">{t(selectedTemplate.title)}</p>
              </div>
            )}

            <LoginForm
              callbackUrl={callbackUrl}
              googleEnabled={isGoogleLoginConfigured()}
              initialError={params.error ?? null}
            />
          </div>

          <div className="rounded-xl border border-border bg-white px-6 py-5 text-center text-sm">
            <p className="font-semibold text-foreground">{t("First time here?")}</p>
            <p className="mt-1 text-muted">
              {t("Ask for the link by email or use Google. If your email has access, your account is created on the spot.")}
            </p>
            <p className="mt-3">
              <Link href="/" className="font-semibold text-accent hover:underline">
                {t("Get to know Lead Engine")}
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
          <Link href="/data-deletion" className="hover:underline">{t("Data deletion")}</Link>
        </nav>
        <div className="mt-4 flex items-center justify-center gap-2">
          <span>{t("Language")}</span>
          <LangSwitch />
        </div>
        <p className="mt-4">© 2026 Lead Engine</p>
      </footer>
    </div>
  );
}
