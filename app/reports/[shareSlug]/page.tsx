import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCampaignReportBySlug } from "@/lib/reports/data";
import { LeadEngineLogo } from "@/components/sidebar";
import { LangSwitch } from "@/components/lang-provider";
import { getLang, getT } from "@/lib/i18n/server";
import type { TFunction } from "@/lib/i18n";

/**
 * Relatório público de campanha (2026-10-04): visual novo do site público,
 * só leitura, em português por padrão. Sem logo do cliente e sem os textos
 * da DM, só os números.
 */
type ReportPageProps = {
  params: Promise<{ shareSlug: string }>;
};

function MetricCard({ label, value, helper }: { label: string; value: string | number; helper: string }) {
  return (
    <div className="rounded-xl border border-border bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-2 text-[28px] font-bold leading-none tracking-tight text-foreground">{value}</p>
      <p className="mt-2 text-xs leading-5 text-muted">{helper}</p>
    </div>
  );
}

export async function generateMetadata({ params }: ReportPageProps): Promise<Metadata> {
  const { shareSlug } = await params;
  const report = await getCampaignReportBySlug(shareSlug);
  const t = await getT();

  if (!report) {
    return {
      title: t("Report not found - Lead Engine"),
      robots: { index: false, follow: false },
    };
  }

  return {
    title: t("{name} campaign report", { name: report.campaign.name }),
    description: t("Read only Instagram comment to DM campaign report for {name}.", {
      name: report.campaign.name,
    }),
    robots: { index: false, follow: false },
  };
}

export default async function ReportPage({ params }: ReportPageProps) {
  const { shareSlug } = await params;
  const report = await getCampaignReportBySlug(shareSlug);

  if (!report) {
    notFound();
  }

  const t: TFunction = await getT();
  const locale = (await getLang()) === "pt" ? "pt-BR" : "en-US";
  const formatDate = (date: Date | null) =>
    date
      ? date.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" })
      : t("No sends yet");
  const formatDay = (date: Date) => date.toLocaleDateString(locale, { day: "numeric", month: "short" });

  const maxDaily = Math.max(...report.daily.map((day) => Math.max(day.sent, day.clicks)), 1);

  return (
    <div className="min-h-screen bg-[#fafafa] text-foreground">
      <header className="border-b border-border bg-white">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
          {report.branded ? (
            <Link href="/" className="rounded-lg text-foreground" aria-label={t("Lead Engine home")}>
              <LeadEngineLogo />
            </Link>
          ) : (
            <p className="text-sm font-semibold text-foreground">{t("Campaign report")}</p>
          )}
          <LangSwitch />
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 md:py-12">
        <section className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-accent">{t("Client campaign report")}</p>
            <h1 className="mt-2 break-words text-[28px] font-bold leading-tight tracking-tight sm:text-[36px]">
              {report.campaign.name}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
              <span>@{report.campaign.instagramUsername}</span>
              {report.campaign.goal && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{report.campaign.goal}</span>
                </>
              )}
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1.5">
                <span
                  className={`h-2 w-2 rounded-full ${report.campaign.isActive ? "bg-success" : "bg-muted"}`}
                  aria-hidden="true"
                />
                {report.campaign.isActive ? t("Active campaign") : t("Paused campaign")}
              </span>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-white p-4 text-sm md:min-w-64">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">{t("Workspace")}</p>
            <p className="mt-1 break-words font-semibold text-foreground">{report.workspace.name}</p>
            <p className="mt-3 text-xs text-muted">
              {t("Generated on {date}", { date: formatDate(report.generatedAt) })}
            </p>
          </div>
        </section>

        <section className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-5" aria-label={t("Numbers")}>
          <MetricCard label={t("DMs sent")} value={report.metrics.sent} helper={t("Private replies sent successfully.")} />
          <MetricCard
            label={t("Skipped sends")}
            value={report.metrics.skipped}
            helper={t("Duplicates, limits or cases with nothing to send.")}
          />
          <MetricCard label={t("Failed sends")} value={report.metrics.failed} helper={t("Replies that need a review.")} />
          <MetricCard label={t("Link clicks")} value={report.metrics.clicks} helper={t("Visits to the tracked link from the DMs.")} />
          <MetricCard
            label={t("Click rate")}
            value={`${report.metrics.ctr}%`}
            helper={t("Clicks divided by DMs sent.")}
          />
        </section>

        <div className="mt-6 grid gap-3 lg:grid-cols-[1.35fr_0.65fr]">
          <section className="min-w-0 rounded-xl border border-border bg-white p-4 sm:p-6">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold">{t("Last 7 days")}</h2>
                <p className="mt-1 text-sm text-muted">{t("DMs sent and link clicks per day.")}</p>
              </div>
              <p className="text-xs text-muted">
                {t("Last send: {date}", { date: formatDate(report.metrics.latestSentAt) })}
              </p>
            </div>
            <div className="mt-6 grid h-48 grid-cols-7 items-end gap-1.5 sm:h-56 sm:gap-3">
              {report.daily.map((day) => (
                <div key={day.date} className="flex h-full min-w-0 flex-col justify-end gap-2">
                  <div className="flex min-h-0 flex-1 items-end gap-0.5 sm:gap-1">
                    <div
                      className="w-full rounded-t-[3px] bg-accent"
                      style={{ height: `${Math.max((day.sent / maxDaily) * 100, 4)}%` }}
                      title={t("{n} sent", { n: day.sent })}
                    />
                    <div
                      className="w-full rounded-t-[3px] bg-success"
                      style={{ height: `${Math.max((day.clicks / maxDaily) * 100, 4)}%` }}
                      title={t("{n} clicks", { n: day.clicks })}
                    />
                  </div>
                  <p className="truncate text-center text-[11px] text-muted">{formatDay(new Date(day.day))}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-4 text-xs text-muted">
              <span className="inline-flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-accent" aria-hidden="true" />
                {t("DMs sent")}
              </span>
              <span className="inline-flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-success" aria-hidden="true" />
                {t("Link clicks")}
              </span>
            </div>
          </section>

          <aside className="grid min-w-0 content-start gap-3">
            <section className="rounded-xl border border-border bg-white p-4 sm:p-6">
              <h2 className="text-lg font-semibold">{t("Top keywords")}</h2>
              <div className="mt-4 space-y-3">
                {report.topKeywords.length === 0 && (
                  <p className="text-sm text-muted">{t("No keyword data yet.")}</p>
                )}
                {report.topKeywords.map((keyword) => (
                  <div
                    key={keyword.keyword}
                    className="flex items-center justify-between gap-4 border-b border-border pb-3 last:border-0 last:pb-0"
                  >
                    <span className="min-w-0 truncate text-sm font-semibold">{keyword.keyword}</span>
                    <span className="text-sm text-muted">{keyword.count}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-xl border border-border bg-white p-4 sm:p-6">
              <h2 className="text-lg font-semibold">{t("Tracked links")}</h2>
              <div className="mt-4 space-y-3">
                {report.trackedLinks.length === 0 && (
                  <p className="text-sm text-muted">{t("This campaign has no tracked link.")}</p>
                )}
                {report.trackedLinks.map((link) => (
                  <div key={link.slug} className="flex items-center justify-between gap-4">
                    <span className="min-w-0 truncate text-sm text-foreground">{link.destinationHost}</span>
                    <span className="text-sm font-semibold">{link.clicks}</span>
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </div>

        <section className="mt-3 rounded-xl border border-border bg-white p-4 sm:p-6">
          <h2 className="text-lg font-semibold">{t("Campaign setup")}</h2>
          <div className="mt-4 grid gap-5 md:grid-cols-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">{t("Keywords")}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {report.campaign.keywords.map((keyword) => (
                  <span
                    key={keyword}
                    className="rounded-md border border-border bg-[#fafafa] px-2 py-1 text-xs font-semibold text-foreground"
                  >
                    {keyword}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">{t("Created on")}</p>
              <p className="mt-2 text-sm">{formatDate(report.campaign.createdAt)}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">{t("Source post")}</p>
              {report.campaign.postUrl ? (
                <a
                  href={report.campaign.postUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex text-sm font-semibold text-accent hover:underline"
                >
                  {t("View post on Instagram")}
                </a>
              ) : (
                <p className="mt-2 text-sm text-muted">{t("No post attached")}</p>
              )}
            </div>
          </div>
        </section>

        {report.branded && (
          <footer className="mt-8 border-t border-border pt-6 text-center text-xs text-muted">
            {t("Made with Lead Engine.")}
          </footer>
        )}
      </main>
    </div>
  );
}
