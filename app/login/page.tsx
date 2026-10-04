import { EMAIL_PROVIDER_ID, signIn } from "@/lib/auth";
import { getCampaignTemplate } from "@/lib/templates/campaign-templates";
import { DemoNotice } from "@/components/demo-notice";

import { getT } from "@/lib/i18n/server";
import { LeadEngineLogo } from "@/components/sidebar";
import { LangSwitch } from "@/components/lang-provider";
import Link from "next/link";
import type { Metadata } from "next";

/**
 * Login (2026-10-04): visual da tela de entrada do instagram.com (cartão
 * central com o logo, campo e botão azul, divisória "ou", segundo cartão e
 * rodapé discreto). A autenticação continua igual: link de acesso por e-mail.
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
    checkEmail?: string;
    callbackUrl?: string;
    template?: string;
  }>;
}) {
  const t = await getT();
  const params = await searchParams;
  const checkEmail = params.checkEmail === "1";
  const selectedTemplate = getCampaignTemplate(params.template);
  const templateCallbackUrl = selectedTemplate
    ? `/campaigns/new?template=${selectedTemplate.slug}`
    : null;
  const callbackUrl = params.callbackUrl ?? templateCallbackUrl ?? "/dashboard";

  async function sendMagicLink(formData: FormData) {
    "use server";
    await signIn(EMAIL_PROVIDER_ID, {
      email: String(formData.get("email") ?? ""),
      redirectTo: callbackUrl,
    });
  }

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
                ? t("Sign in to use the {name} template.", { name: selectedTemplate.title })
                : t("Sign in to manage your comments, Direct and contacts.")}
            </p>

            {selectedTemplate && !checkEmail && (
              <div className="mt-5 rounded-lg border border-border bg-[#fafafa] px-4 py-3">
                <p className="text-xs font-semibold text-muted">{t("Template selected")}</p>
                <p className="mt-1 text-sm font-semibold text-foreground">{selectedTemplate.title}</p>
              </div>
            )}

            {checkEmail ? (
              <div className="mt-6 text-center" role="status">
                <h2 className="text-base font-semibold">{t("Check your email")}</h2>
                <p className="mt-2 text-sm leading-6 text-muted">
                  {t("We sent you a secure sign-in link. Open it on this device to continue.")}
                </p>
                <Link
                  href="/login"
                  className="mt-5 inline-block text-sm font-semibold text-accent hover:underline"
                >
                  {t("Use another email")}
                </Link>
              </div>
            ) : (
              <form action={sendMagicLink} className="mt-6 space-y-3">
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
                    aria-describedby="email-ajuda"
                    className="h-11 w-full rounded-md border border-border bg-[#fafafa] px-3 text-sm text-foreground placeholder:text-muted transition-colors focus:border-accent focus:bg-white"
                  />
                </div>

                <button
                  type="submit"
                  className="h-10 w-full rounded-lg bg-accent px-4 text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
                >
                  {t("Send access link")}
                </button>

                <p id="email-ajuda" className="pt-1 text-center text-xs leading-5 text-muted">
                  {t("We send a sign in link to your email. No password to remember.")}
                </p>
              </form>
            )}

            <div className="my-6 flex items-center gap-4" role="separator" aria-hidden="true">
              <span className="h-px flex-1 bg-border" />
              <span className="text-[13px] font-semibold uppercase text-muted">{t("or")}</span>
              <span className="h-px flex-1 bg-border" />
            </div>

            <p className="text-center">
              <Link href="/" className="text-sm font-semibold text-accent hover:underline">
                {t("Get to know Lead Engine")}
              </Link>
            </p>
          </div>

          <div className="rounded-xl border border-border bg-white px-6 py-5 text-center text-sm">
            <p className="font-semibold text-foreground">{t("First time here?")}</p>
            <p className="mt-1 text-muted">
              {t("The same link creates your account if your email has access.")}
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
