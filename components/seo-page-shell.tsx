import type { Metadata } from "next";
import Link from "next/link";
import PublicSiteHeader from "@/components/public-site-header";
import PublicSiteFooter from "@/components/public-site-footer";
import { getT } from "@/lib/i18n/server";

/**
 * Páginas de SEO (2026-10-04): visual novo do site público (fundo #fafafa,
 * cartões brancos com borda #dbdbdb, botão azul), em português por padrão.
 * O texto vem em inglês do config (chave) e passa pelo t().
 */
export interface SeoPageSection {
  title: string;
  body: string;
}

export interface SeoPageConfig {
  metaTitle: string;
  metaDescription: string;
  eyebrow: string;
  title: string;
  description: string;
  primaryCta: string;
  secondaryCta?: string;
  checklistTitle: string;
  bullets: string[];
  sections: SeoPageSection[];
  comparisonTitle: string;
  /** Nome da terceira coluna da comparação. */
  otherLabel: string;
  comparisons: Array<{
    label: string;
    ours: string;
    other: string;
  }>;
  templateLinks: Array<{
    label: string;
    href: string;
  }>;
  faqs: SeoPageSection[];
}

/** Metadados traduzidos de uma página de SEO. */
export async function seoPageMetadata(config: SeoPageConfig, path: string): Promise<Metadata> {
  const t = await getT();
  const title = t(config.metaTitle);
  const description = t(config.metaDescription);
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { title, description, url: path },
  };
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="mt-0.5 h-5 w-5 shrink-0 text-accent"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12.2 2.7 2.7L16.2 9.4" />
    </svg>
  );
}

export default async function SeoPageShell({ config }: { config: SeoPageConfig }) {
  const t = await getT();
  return (
    <div className="min-h-screen bg-[#fafafa] text-foreground">
      <PublicSiteHeader />

      <main>
        {/* Topo */}
        <section className="mx-auto grid w-full max-w-5xl items-start gap-8 px-4 pb-14 pt-10 sm:px-6 md:grid-cols-[1.15fr_0.85fr] md:gap-12 md:pb-20 md:pt-16">
          <div className="min-w-0">
            <p className="inline-flex items-center gap-2 rounded-full border border-border bg-white px-3 py-1 text-xs font-semibold text-muted">
              <span className="h-2 w-2 rounded-full bg-accent" aria-hidden="true" />
              {t(config.eyebrow)}
            </p>
            <h1 className="mt-5 text-balance text-[30px] font-bold leading-[1.15] tracking-tight sm:text-[40px]">
              {t(config.title)}
            </h1>
            <p className="mt-4 max-w-xl text-base leading-7 text-muted">{t(config.description)}</p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/login"
                className="inline-flex h-11 items-center justify-center rounded-lg bg-accent px-6 text-center text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
              >
                {t(config.primaryCta)}
              </Link>
              <Link
                href="/templates"
                className="inline-flex h-11 items-center justify-center rounded-lg border border-border bg-white px-6 text-center text-sm font-semibold text-foreground transition-colors hover:bg-surface-hover"
              >
                {t(config.secondaryCta ?? "See templates")}
              </Link>
            </div>
          </div>

          <div className="min-w-0 rounded-xl border border-border bg-white p-5 sm:p-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">{t(config.checklistTitle)}</p>
            <ul className="mt-4 space-y-3">
              {config.bullets.map((bullet) => (
                <li key={bullet} className="flex gap-3 text-sm leading-6 text-foreground">
                  <CheckIcon />
                  <span>{t(bullet)}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Destaques */}
        <section className="border-t border-border bg-white py-14 md:py-20">
          <div className="mx-auto w-full max-w-5xl px-4 sm:px-6">
            <ul className="grid gap-3 md:grid-cols-3">
              {config.sections.map((section) => (
                <li key={section.title} className="rounded-xl border border-border bg-white p-5">
                  <h2 className="text-lg font-semibold">{t(section.title)}</h2>
                  <p className="mt-2 text-sm leading-6 text-muted">{t(section.body)}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Comparação */}
        <section className="border-t border-border py-14 md:py-20">
          <div className="mx-auto w-full max-w-5xl px-4 sm:px-6">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{t(config.comparisonTitle)}</h2>
            <div className="mt-8 overflow-hidden rounded-xl border border-border bg-white">
              <div className="hidden grid-cols-[0.8fr_1fr_1fr] border-b border-border bg-[#fafafa] text-xs font-semibold uppercase tracking-wide text-muted md:grid">
                <div className="p-4">{t("What you need")}</div>
                <div className="p-4 text-foreground">Lead Engine</div>
                <div className="p-4">{t(config.otherLabel)}</div>
              </div>
              {config.comparisons.map((item) => (
                <div
                  key={item.label}
                  className="grid grid-cols-1 border-b border-border last:border-0 md:grid-cols-[0.8fr_1fr_1fr]"
                >
                  <div className="bg-[#fafafa] p-4 text-sm font-semibold text-foreground md:bg-transparent">
                    {t(item.label)}
                  </div>
                  <div className="px-4 pb-2 pt-3 text-sm leading-6 text-foreground md:p-4">
                    <span className="block text-xs font-semibold uppercase tracking-wide text-accent md:hidden">
                      Lead Engine
                    </span>
                    {t(item.ours)}
                  </div>
                  <div className="px-4 pb-4 pt-2 text-sm leading-6 text-muted md:p-4">
                    <span className="block text-xs font-semibold uppercase tracking-wide text-muted md:hidden">
                      {t(config.otherLabel)}
                    </span>
                    {t(item.other)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Modelos */}
        <section className="border-t border-border bg-white py-14 md:py-20">
          <div className="mx-auto grid w-full max-w-5xl gap-8 px-4 sm:px-6 md:grid-cols-[0.9fr_1.1fr]">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-accent">{t("Start from a template")}</p>
              <h2 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
                {t("A ready example to adjust, instead of a blank page")}
              </h2>
              <p className="mt-3 text-sm leading-6 text-muted">
                {t(
                  "Pick a template, connect your Instagram account, choose the post and adjust the keywords and the message before turning it on."
                )}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {config.templateLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border bg-white p-4 text-sm font-semibold text-foreground transition-colors hover:bg-surface-hover"
                >
                  <span>{t(link.label)}</span>
                  <span aria-hidden="true" className="text-muted">›</span>
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* Perguntas */}
        <section className="border-t border-border py-14 md:py-20">
          <div className="mx-auto grid w-full max-w-5xl gap-8 px-4 sm:px-6 md:grid-cols-[0.8fr_1.2fr]">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-accent">{t("Questions")}</p>
              <h2 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">{t("Common questions")}</h2>
            </div>
            <div className="grid gap-3">
              {config.faqs.map((faq) => (
                <article key={faq.title} className="rounded-xl border border-border bg-white p-5">
                  <h3 className="text-base font-semibold">{t(faq.title)}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted">{t(faq.body)}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Chamada final */}
        <section className="border-t border-border bg-white py-14 md:py-20">
          <div className="mx-auto w-full max-w-md px-4 sm:px-6">
            <div className="rounded-xl border border-border bg-white px-6 py-10 text-center sm:px-10">
              <h2 className="text-xl font-semibold leading-snug">
                {t("Ready to look at your comments with other eyes?")}
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted">
                {t("Sign in with your email and connect your Instagram professional account.")}
              </p>
              <Link
                href="/login"
                className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-lg bg-accent px-6 text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
              >
                {t("Sign in")}
              </Link>
            </div>
          </div>
        </section>
      </main>

      <PublicSiteFooter />
    </div>
  );
}
