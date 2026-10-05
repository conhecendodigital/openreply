import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import PublicSiteHeader from "@/components/public-site-header";
import PublicSiteFooter from "@/components/public-site-footer";
import TemplateVisual from "@/components/template-visual";
import {
  CAMPAIGN_TEMPLATES,
  getCampaignTemplate,
  getCampaignTemplateSlugs,
} from "@/lib/templates/campaign-templates";
import { getT } from "@/lib/i18n/server";

type TemplatePageProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return getCampaignTemplateSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: TemplatePageProps): Promise<Metadata> {
  const { slug } = await params;
  const template = getCampaignTemplate(slug);
  const t = await getT();

  if (!template) {
    return { title: t("Template not found - Lead Engine") };
  }

  return {
    title: t("{name}: Instagram comment to DM template - Lead Engine", { name: t(template.title) }),
    description: t(template.summary),
    alternates: { canonical: `/templates/${template.slug}` },
  };
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1.5 text-base font-semibold text-foreground">{value}</p>
    </div>
  );
}

export default async function TemplateDetailPage({ params }: TemplatePageProps) {
  const { slug } = await params;
  const template = getCampaignTemplate(slug);

  if (!template) {
    notFound();
  }

  const t = await getT();
  const relatedTemplates = CAMPAIGN_TEMPLATES.filter((item) => item.slug !== template.slug).slice(0, 3);

  return (
    <div className="min-h-screen bg-[#fafafa] text-foreground">
      <PublicSiteHeader active="templates" />

      <main>
        <section className="mx-auto grid w-full max-w-5xl items-start gap-8 px-4 pb-12 pt-8 sm:px-6 md:grid-cols-[1.1fr_0.9fr] md:gap-12 md:pb-16 md:pt-12">
          <div className="min-w-0">
            <Link href="/templates" className="text-sm font-semibold text-accent hover:underline">
              ‹ {t("Back to templates")}
            </Link>
            <p className="mt-6 text-xs font-semibold uppercase tracking-wide text-accent">
              {t("{category} template", { category: t(template.category) })}
            </p>
            <h1 className="mt-2 text-balance text-[30px] font-bold leading-[1.15] tracking-tight sm:text-[40px]">
              {t(template.title)}
            </h1>
            <p className="mt-4 max-w-xl text-base leading-7 text-muted">{t(template.summary)}</p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Link
                href={`/login?template=${template.slug}`}
                className="inline-flex h-11 items-center justify-center rounded-lg bg-accent px-6 text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
              >
                {t("Use this template")}
              </Link>
              <a
                href="#passo-a-passo"
                className="inline-flex h-11 items-center justify-center rounded-lg border border-border bg-white px-6 text-sm font-semibold text-foreground transition-colors hover:bg-surface-hover"
              >
                {t("Read the step by step")}
              </a>
            </div>
          </div>

          <div className="min-w-0">
            <TemplateVisual template={template} t={t} />
          </div>
        </section>

        <section className="border-t border-border bg-white py-12 md:py-16">
          <div className="mx-auto grid w-full max-w-5xl gap-6 px-4 sm:px-6 md:grid-cols-[0.75fr_1.25fr] md:gap-8">
            <aside className="grid content-start gap-3">
              <InfoCard label={t("Audience")} value={t(template.audience)} />
              <InfoCard
                label={t("Estimated setup time")}
                value={t("About {n} minutes", { n: template.setupMinutes })}
              />
              <InfoCard label={t("Campaign goal")} value={t(template.goal)} />
            </aside>

            <div id="passo-a-passo" className="min-w-0 scroll-mt-20 space-y-3">
              <section className="rounded-xl border border-border bg-white p-5">
                <h2 className="text-lg font-semibold">{t("What this campaign is for")}</h2>
                <p className="mt-2 text-sm leading-6 text-muted">{t(template.outcome)}</p>
              </section>

              <section className="rounded-xl border border-border bg-white p-5">
                <h2 className="text-lg font-semibold">{t("Step by step")}</h2>
                <ol className="mt-4 space-y-3">
                  {template.playbook.map((step, index) => (
                    <li key={step} className="flex gap-3">
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold text-white">
                        {index + 1}
                      </span>
                      <span className="pt-0.5 text-sm leading-6 text-foreground">{t(step)}</span>
                    </li>
                  ))}
                </ol>
              </section>

              <section className="rounded-xl border border-border bg-white p-5">
                <h2 className="text-lg font-semibold">{t("DM message")}</h2>
                <p className="mt-2 break-words rounded-lg border border-border bg-[#fafafa] p-3 font-mono text-[13px] leading-6 text-foreground">
                  {t(template.dmMessage)}
                </p>
                <p className="mt-2 text-xs leading-5 text-muted">
                  {t("{username} is replaced by the name of the person who commented. Swap the link for yours.")}
                </p>
              </section>

              <div className="grid gap-3 sm:grid-cols-2">
                <section className="rounded-xl border border-border bg-white p-5">
                  <h2 className="text-base font-semibold">{t("Good for")}</h2>
                  <ul className="mt-3 space-y-1.5">
                    {template.bestFor.map((item) => (
                      <li key={item} className="text-sm text-muted">
                        {t(item)}
                      </li>
                    ))}
                  </ul>
                </section>
                <section className="rounded-xl border border-border bg-white p-5">
                  <h2 className="text-base font-semibold">{t("Metrics to follow")}</h2>
                  <ul className="mt-3 space-y-1.5">
                    {template.metrics.map((item) => (
                      <li key={item} className="text-sm text-muted">
                        {t(item)}
                      </li>
                    ))}
                  </ul>
                </section>
              </div>

              <section className="rounded-xl border border-border bg-[#fafafa] p-5">
                <h2 className="text-lg font-semibold">{t("Use this template in Lead Engine")}</h2>
                <p className="mt-2 text-sm leading-6 text-muted">
                  {t(
                    "Sign in, connect your Instagram account, choose the post or reel and create the campaign with the keywords and the message of this template."
                  )}
                </p>
                <Link
                  href={`/login?template=${template.slug}`}
                  className="mt-4 inline-flex h-11 w-full items-center justify-center rounded-lg bg-accent px-6 text-sm font-semibold text-white transition-colors hover:bg-accent-hover sm:w-auto"
                >
                  {t("Use this template")}
                </Link>
              </section>
            </div>
          </div>
        </section>

        <section className="border-t border-border py-12 md:py-16">
          <div className="mx-auto w-full max-w-5xl px-4 sm:px-6">
            <h2 className="text-2xl font-bold tracking-tight">{t("More templates")}</h2>
            <ul className="mt-6 grid gap-3 md:grid-cols-3">
              {relatedTemplates.map((item) => (
                <li key={item.slug}>
                  <Link
                    href={`/templates/${item.slug}`}
                    className="block h-full rounded-xl border border-border bg-white p-5 transition-colors hover:bg-surface-hover"
                  >
                    <p className="text-xs font-semibold uppercase tracking-wide text-accent">{t(item.category)}</p>
                    <h3 className="mt-2 text-base font-semibold">{t(item.title)}</h3>
                    <p className="mt-1.5 text-sm leading-6 text-muted">{t(item.summary)}</p>
                  </Link>
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
