import type { NextRequest } from "next/server";
import { handleTrackedLink } from "@/lib/links/redirect";
import { resolveRecipientCode } from "@/lib/links/codes";

/**
 * Short tracked link /r/<slug>/<code> (07/10/2026): the code (6 to 8 letters
 * and numbers) says who got the link (TrackedLinkRecipient). Unknown code:
 * the person still goes to the destination, only not credited.
 */
type ShortRouteProps = {
  params: Promise<{ slug: string; code: string }>;
};

export async function GET(request: NextRequest, { params }: ShortRouteProps) {
  const { slug, code } = await params;
  const found = await resolveRecipientCode(slug, code);
  return handleTrackedLink(request, slug, found ? { igUserId: found.igUserId, dmLogId: found.dmLogId } : null);
}

export async function HEAD(request: NextRequest, props: ShortRouteProps) {
  return GET(request, props);
}
