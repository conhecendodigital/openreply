import type { Metadata } from "next";
import LegalShell from "@/components/legal-shell";
import LegalSections from "@/components/legal-sections";
import { getLang, getT } from "@/lib/i18n/server";
import { LEGAL_INFO, legalVars } from "@/lib/legal-info";
import { termsPage } from "@/lib/legal-pages";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  const vars = legalVars();
  return {
    title: t(termsPage.metaTitle, vars),
    description: t(termsPage.metaDescription, vars),
  };
}

export default async function TermsPage() {
  const t = await getT();
  const lang = await getLang();
  const vars = legalVars();
  return (
    <LegalShell
      title={t(termsPage.title, vars)}
      description={t(termsPage.description, vars)}
      updatedLabel={t("Last updated {date}", { date: lang === "pt" ? LEGAL_INFO.updatedPt : LEGAL_INFO.updatedEn })}
    >
      <LegalSections sections={termsPage.sections} t={t} vars={vars} />
    </LegalShell>
  );
}
