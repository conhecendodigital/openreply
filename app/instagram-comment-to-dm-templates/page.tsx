import SeoPageShell, { seoPageMetadata } from "@/components/seo-page-shell";
import { templatesSeoPage } from "@/lib/seo-pages";

export function generateMetadata() {
  return seoPageMetadata(templatesSeoPage, "/instagram-comment-to-dm-templates");
}

export default function InstagramCommentToDmTemplatesPage() {
  return <SeoPageShell config={templatesSeoPage} />;
}
