import type { Metadata } from "next";
import LegalShell from "@/components/legal-shell";
import LegalSections from "@/components/legal-sections";
import { getLang, getT } from "@/lib/i18n/server";
import { LEGAL_INFO, legalVars } from "@/lib/legal-info";
import { dataDeletionPage } from "@/lib/legal-pages";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  const vars = legalVars();
  return {
    title: t(dataDeletionPage.metaTitle, vars),
    description: t(dataDeletionPage.metaDescription, vars),
  };
}

export default async function DataDeletionPage() {
  const t = await getT();
  const lang = await getLang();
  const vars = legalVars();
  return (
    <LegalShell
      title={t(dataDeletionPage.title, vars)}
      description={t(dataDeletionPage.description, vars)}
      updatedLabel={t("Last updated {date}", { date: lang === "pt" ? LEGAL_INFO.updatedPt : LEGAL_INFO.updatedEn })}
    >
      <LegalSections sections={dataDeletionPage.sections} t={t} vars={vars} />

      <section>
        <h2>{t("Check a deletion request")}</h2>
        <form action="/data-deletion/status" method="get" className="mt-3 flex flex-col gap-2 sm:flex-row">
          <label htmlFor="code" className="sr-only">
            {t("Confirmation code")}
          </label>
          <input
            id="code"
            name="code"
            required
            autoComplete="off"
            placeholder={t("Confirmation code")}
            className="h-10 flex-1 rounded-lg border border-border px-3 font-mono text-sm uppercase"
          />
          <button
            type="submit"
            className="h-10 rounded-lg bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-hover"
          >
            {t("Check status")}
          </button>
        </form>
      </section>
    </LegalShell>
  );
}
