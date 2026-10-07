/**
 * /r/<slug> and /r/<slug>/<code> (07/10/2026). Shared by both routes.
 *
 * - Robot of a link preview, or HEAD: 200 with the Open Graph tags
 *   (lib/links/preview.ts). No click, no redirect.
 * - Person: the click is counted (campaign, flow or broadcast link), credited
 *   to the contact when the link says who got it (short code, or the old
 *   signed ?c=), and a 302 to the destination.
 * - Host: on the app host every link works, as always. On a link domain
 *   (Workspace.linkDomain) only the links of THAT workspace open; any other
 *   host gets 404.
 */
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { getRequestIp, hashClickIp } from "@/lib/tracking/server";
import { RECIPIENT_PARAM, verifyRecipientToken } from "@/lib/tracking/recipient";
import { AUTO_TAGS, trackInteraction } from "@/lib/contacts/record";
import { recordFlowLinkClick } from "@/lib/flows/links";
import { recordBroadcastLinkClick } from "@/lib/broadcasts/links";
// Etapa 6: a link to one of our quizzes carries who clicked (signed c=).
import { withFunnelContact } from "@/lib/funnels/contact-link";
import { isAppHost, requestHost } from "@/lib/links/hosts";
import { workspaceForLinkHost } from "@/lib/links/domain";
import { previewResponse, resolveLinkPreview, wantsPreview, type PreviewSource } from "@/lib/links/preview";
import { getPublishedFunnelBySlug } from "@/lib/funnels/public";

/** /r/_ping answers this, so saving a link domain can check it reaches us. */
export const LINK_PING_SLUG = "_ping";
export const LINK_PING_BODY = "lead-engine-link-ok";

export type LinkRecipient = { igUserId: string; dmLogId: string | null };

const notFound = () =>
  new NextResponse("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

type OtherLink = { workspaceId: string; destinationUrl: string; label: string | null };

/** A flow or broadcast link with this slug (slugs are unique across the 3 tables). */
async function findOtherLink(slug: string): Promise<OtherLink | null> {
  const select = { workspaceId: true, destinationUrl: true, label: true } as const;
  const flow = await prisma.flowLink.findUnique({ where: { slug }, select }).catch(() => null);
  if (flow) return flow;
  return (await prisma.broadcastLink.findUnique({ where: { slug }, select }).catch(() => null)) ?? null;
}

async function loadQuiz(slug: string) {
  return getPublishedFunnelBySlug(slug);
}

/** The link as the preview shows it: https://<host>/r/<slug> (no person in it). */
function canonicalUrl(request: NextRequest, host: string, onApp: boolean, slug: string): string {
  const origin = onApp ? new URL(request.url).origin : `https://${host}`;
  return `${origin}/r/${slug}`;
}

/**
 * `recipient`: who got the link (from the short code). undefined = read the
 * old ?c= from the URL. null = nobody (unknown code: the person still goes).
 */
export async function handleTrackedLink(
  request: NextRequest,
  slug: string,
  recipient?: LinkRecipient | null
): Promise<Response> {
  if (slug === LINK_PING_SLUG) {
    return new NextResponse(LINK_PING_BODY, { status: 200, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  }

  const host = requestHost(request);
  const onApp = isAppHost(host);
  const hostWorkspaceId = onApp ? null : await workspaceForLinkHost(host);
  if (!onApp && !hostWorkspaceId) return notFound();

  const trackedLink = await prisma.trackedLink.findUnique({
    where: { slug },
    select: {
      id: true,
      workspaceId: true,
      automationId: true,
      destinationUrl: true,
      label: true,
      previewTitle: true,
      previewDescription: true,
      previewImageUrl: true,
      automation: {
        select: {
          instagramAccountId: true,
        },
      },
    },
  });
  if (trackedLink && hostWorkspaceId && trackedLink.workspaceId !== hostWorkspaceId) return notFound();

  if (wantsPreview(request)) {
    let source: PreviewSource | null = trackedLink;
    if (!source) {
      const other = await findOtherLink(slug);
      if (other && hostWorkspaceId && other.workspaceId !== hostWorkspaceId) return notFound();
      source = other;
    }
    if (!source) return notFound();
    const preview = await resolveLinkPreview(source, { loadQuiz });
    return previewResponse(preview, canonicalUrl(request, host, onApp, slug), request.method);
  }

  // A short code says who got it. Otherwise the old signed ?c= (links that
  // already went out keep working). Public links have neither.
  const contactIgUserId =
    recipient === undefined
      ? verifyRecipientToken(slug, new URL(request.url).searchParams.get(RECIPIENT_PARAM))
      : recipient?.igUserId ?? null;

  if (!trackedLink) {
    if (hostWorkspaceId) {
      const other = await findOtherLink(slug);
      if (!other || other.workspaceId !== hostWorkspaceId) return notFound();
    }
    // Etapa 3: not a campaign link; maybe a flow button's link. Campaign
    // links above are untouched (slugs are unique across both tables).
    const flowDestination = await recordFlowLinkClick({
      slug,
      request,
      contactIgUserId,
    });
    if (flowDestination) return NextResponse.redirect(withFunnelContact(flowDestination, contactIgUserId), { status: 302 });
    // Etapa 5: then a broadcast button's link (slugs are unique across the 3).
    const broadcastDestination = await recordBroadcastLinkClick({
      slug,
      request,
      contactIgUserId,
    });
    if (broadcastDestination) {
      return NextResponse.redirect(withFunnelContact(broadcastDestination, contactIgUserId), { status: 302 });
    }
    return NextResponse.redirect(new URL("/", request.url), { status: 302 });
  }

  const click = await prisma.linkClick.create({
    data: {
      workspaceId: trackedLink.workspaceId,
      automationId: trackedLink.automationId,
      instagramAccountId: trackedLink.automation.instagramAccountId,
      trackedLinkId: trackedLink.id,
      ipHash: hashClickIp(getRequestIp(request)),
      userAgent: request.headers.get("user-agent"),
      referrer: request.headers.get("referer"),
      ...(contactIgUserId ? { contactIgUserId } : {}),
    },
  });

  if (contactIgUserId && click?.id) {
    // CRM never delays or breaks the redirect.
    await creditClick({
      clickId: click.id,
      clickedAt: click.createdAt ?? new Date(),
      igUserId: contactIgUserId,
      dmLogId: recipient?.dmLogId ?? null,
      workspaceId: trackedLink.workspaceId,
      automationId: trackedLink.automationId,
      instagramAccountId: trackedLink.automation.instagramAccountId,
    }).catch(() => {});
  }

  return NextResponse.redirect(withFunnelContact(trackedLink.destinationUrl, contactIgUserId), { status: 302 });
}

async function creditClick(input: {
  clickId: string;
  clickedAt: Date;
  igUserId: string;
  /** The DM that delivered the link, known from the short code. */
  dmLogId: string | null;
  workspaceId: string;
  automationId: string;
  instagramAccountId: string;
}) {
  const [account, automation, dmLog] = await Promise.all([
    prisma.instagramAccount.findUnique({
      where: { id: input.instagramAccountId },
      select: { id: true, workspaceId: true, instagramId: true },
    }),
    prisma.automation.findUnique({
      where: { id: input.automationId },
      select: { name: true },
    }),
    input.dmLogId
      ? prisma.dmLog.findFirst({
          where: { id: input.dmLogId, automationId: input.automationId, commenterId: input.igUserId },
          select: { id: true },
        })
      : prisma.dmLog.findFirst({
          where: { automationId: input.automationId, commenterId: input.igUserId, status: "SENT" },
          orderBy: { dmSentAt: "desc" },
          select: { id: true },
        }),
  ]);
  if (!account || account.workspaceId !== input.workspaceId) return;

  if (dmLog) {
    await prisma.linkClick.update({ where: { id: input.clickId }, data: { dmLogId: dmLog.id } });
  }

  await trackInteraction({
    account,
    igUserId: input.igUserId,
    event: {
      type: "CLICK",
      refId: input.clickId,
      occurredAt: input.clickedAt,
      automationId: input.automationId,
      text: automation?.name ?? null,
    },
    tags: [
      AUTO_TAGS.clicked,
      ...(automation?.name ? [AUTO_TAGS.clickedCampaign(automation.name)] : []),
    ],
  });
}
