import type { NextRequest } from "next/server";
import { handleTrackedLink } from "@/lib/links/redirect";

/**
 * Tracked link /r/<slug> (old format: ?c=<igsid>.<sig> says who got it).
 * Links already sent keep working. Robots of link previews and HEAD get the
 * Open Graph tags; people get the 302 (lib/links/redirect.ts).
 */
type RedirectRouteProps = {
  params: Promise<{ slug: string }>;
};

export async function GET(request: NextRequest, { params }: RedirectRouteProps) {
  const { slug } = await params;
  return handleTrackedLink(request, slug);
}

export async function HEAD(request: NextRequest, props: RedirectRouteProps) {
  return GET(request, props);
}
