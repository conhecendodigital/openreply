import Link from "next/link";
import { getT } from "@/lib/i18n/server";
import LegalCompanyLine from "@/components/legal-company-line";

/** Rodapé do site público (2026-10-04), o mesmo da página inicial. */
export default async function PublicSiteFooter() {
  const t = await getT();
  return (
    <footer className="border-t border-border py-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-3 px-4 text-center text-xs text-muted sm:px-6">
        <nav className="flex flex-wrap justify-center gap-x-4 gap-y-2" aria-label={t("Lead Engine")}>
          <Link href="/" className="hover:underline">{t("Lead Engine")}</Link>
          <Link href="/templates" className="hover:underline">{t("Templates")}</Link>
          <Link href="/privacy" className="hover:underline">{t("Privacy")}</Link>
          <Link href="/terms" className="hover:underline">{t("Terms")}</Link>
          <Link href="/data-deletion" className="hover:underline">{t("Data deletion")}</Link>
        </nav>
        <p>{t("Uses the official Meta API. Not affiliated with Meta or Instagram.")}</p>
        <LegalCompanyLine />
      </div>
    </footer>
  );
}
