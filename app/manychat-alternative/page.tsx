import SeoPageShell, { seoPageMetadata } from "@/components/seo-page-shell";
import { manychatAlternativePage } from "@/lib/seo-pages";

export function generateMetadata() {
  return seoPageMetadata(manychatAlternativePage, "/manychat-alternative");
}

export default function ManychatAlternativePage() {
  return <SeoPageShell config={manychatAlternativePage} />;
}
