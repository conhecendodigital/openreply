import SeoPageShell, { seoPageMetadata } from "@/components/seo-page-shell";
import { commentLinkSeoPage } from "@/lib/seo-pages";

export function generateMetadata() {
  return seoPageMetadata(commentLinkSeoPage, "/comment-link-automation");
}

export default function CommentLinkAutomationPage() {
  return <SeoPageShell config={commentLinkSeoPage} />;
}
