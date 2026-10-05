import SeoPageShell, { seoPageMetadata } from "@/components/seo-page-shell";
import { agenciesSeoPage } from "@/lib/seo-pages";

export function generateMetadata() {
  return seoPageMetadata(agenciesSeoPage, "/instagram-dm-automation-agencies");
}

export default function InstagramDmAutomationAgenciesPage() {
  return <SeoPageShell config={agenciesSeoPage} />;
}
