import type { Metadata } from "next";
import Link from "next/link";
import PublicSiteHeader from "@/components/public-site-header";
import PublicSiteFooter from "@/components/public-site-footer";
import TemplateVisual from "@/components/template-visual";
import { CAMPAIGN_TEMPLATES } from "@/lib/templates/campaign-templates";
import { getT } from "@/lib/i18n/server";

/** Biblioteca pública de modelos (2026-10-04): visual novo, PT por padrão. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t("Instagram comment to DM templates - Lead Engine"),
    description: t(
      "Ready examples of comment to DM campaigns for product links, free materials, real estate, fitness, restaurants, events and creators."
    ),
    alternates: { canonical: "/templates" },
  };
}

export default async function TemplatesPage() {
  const t = await getT();
  return (
    <div className="min-h-screen bg-[#fafafa] text-foreground">
      <PublicSiteHeader active="templates" />

      <main>
        <section className="mx-auto grid w-full max-w-5xl items-center gap-8 px-4 pb-12 pt-10 sm:px-6 md:grid-cols-[1.1fr_0.9fr] md:gap-12 md:pb-16 md:pt-16">
          <div className="min-w-0">
            <p className="inline-flex items-center gap-2 rounded-full border border-border bg-white px-3 py-1 text-xs font-semibold text-muted">
              <span className="h-2 w-2 rounded-full bg-accent" aria-hidden="true" />
              {t("Template library")}
            </p>
            <h1 className="mt-5 text-balance text-[30px] font-bold leading-[1.15] tracking-tight sm:text-[40px]">
              {t("Instagram campaigns ready to adjust and turn on")}
            </h1>
            <p className="mt-4 max-w-xl text-base leading-7 text-muted">
              {t(
                "Comment to DM examples for free materials, product links, events, service menus and client campaigns. Each one comes with keywords, the message and a step by step."
              )}
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/login"
                className="inline-flex h-11 items-center justify-center rounded-lg bg-accent px-6 text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
              >
                {t("Sign in")}
              </Link>
              <a
                href="#modelos"
                className="inline-flex h-11 items-center justify-center rounded-lg border border-border bg-white px-6 text-sm font-semibold text-foreground transition-colors hover:bg-surface-hover"
              >
                {t("See templates")}
              </a>
            </div>
          </div>

          <div className="grid min-w-0 gap-3">
            {CAMPAIGN_TEMPLATES.slice(0, 2).map((template) => (
              <TemplateVisual key={template.slug} template={template} t={t} compact />
            ))}
          </div>
        </section>

        <section id="modelos" className="scroll-mt-20 border-t border-border bg-white py-12 md:py-16">
          <div className="mx-auto w-full max-w-5xl px-4 sm:px-6">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{t("All templates")}</h2>
            <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {CAMPAIGN_TEMPLATES.map((template) => (
                <li key={template.slug} className="flex flex-col rounded-xl border border-border bg-white p-5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-accent">{t(template.category)}</p>
                  <h3 className="mt-2 text-lg font-semibold leading-snug">{t(template.title)}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted">{t(template.summary)}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {template.keywords.map((keyword) => (
                      <span
                        key={keyword}
                        className="rounded-md border border-border bg-[#fafafa] px-2 py-1 text-xs font-semibold text-foreground"
                      >
                        {t(keyword)}
                      </span>
                    ))}
                  </div>
                  <div className="mt-auto grid gap-2 pt-5">
                    <Link
                      href={`/templates/${template.slug}`}
                      className="inline-flex h-10 w-full items-center justify-center rounded-lg border border-border bg-white px-4 text-sm font-semibold text-foreground transition-colors hover:bg-surface-hover"
                    >
                      {t("See step by step")}
                    </Link>
                    <Link
                      href={`/login?template=${template.slug}`}
                      className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-accent px-4 text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
                    >
                      {t("Use this template")}
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <PublicSiteFooter />
    </div>
  );
}
