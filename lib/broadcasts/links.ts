/**
 * Tracked links of a broadcast's link buttons (/r/<slug>). Created when the
 * broadcast is sent (one per button, slug unique across campaign TrackedLink,
 * FlowLink and BroadcastLink) and resolved by /r/<slug> only after the
 * campaign and flow lookups found nothing.
 */
import { prisma } from "@/lib/db/client";
import { generateTrackedLinkSlug, getRequestIp, hashClickIp } from "@/lib/tracking/server";
import { AUTO_TAGS, trackInteraction } from "@/lib/contacts/record";
import type { BroadcastButton } from "@/lib/broadcasts/schema";

export async function freeLinkSlug(): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const slug = generateTrackedLinkSlug();
    const [campaign, flow, broadcast] = await Promise.all([
      prisma.trackedLink.findUnique({ where: { slug }, select: { id: true } }),
      prisma.flowLink.findUnique({ where: { slug }, select: { id: true } }),
      prisma.broadcastLink.findUnique({ where: { slug }, select: { id: true } }),
    ]);
    if (!campaign && !flow && !broadcast) return slug;
  }
  throw new Error("Could not create a unique link slug");
}

/** One BroadcastLink per link button. Returns buttonId -> slug. */
export async function syncBroadcastLinks(
  broadcast: { id: string; workspaceId: string },
  buttons: BroadcastButton[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const b of buttons) {
    if (b.kind !== "link") continue;
    const existing = await prisma.broadcastLink.findUnique({
      where: { broadcastId_buttonId: { broadcastId: broadcast.id, buttonId: b.id } },
      select: { id: true, slug: true, destinationUrl: true, label: true },
    });
    if (existing) {
      if (existing.destinationUrl !== b.url || existing.label !== b.label) {
        await prisma.broadcastLink.update({ where: { id: existing.id }, data: { destinationUrl: b.url, label: b.label } });
      }
      map.set(b.id, existing.slug);
      continue;
    }
    const created = await prisma.broadcastLink.create({
      data: {
        workspaceId: broadcast.workspaceId,
        broadcastId: broadcast.id,
        buttonId: b.id,
        slug: await freeLinkSlug(),
        label: b.label,
        destinationUrl: b.url,
      },
      select: { slug: true },
    });
    map.set(b.id, created.slug);
  }
  return map;
}

/**
 * /r/<slug> for a broadcast link: records the click (credited to the
 * recipient when the URL carries the signed IGSID) and returns where to go.
 * null = not a broadcast link. Never throws (the redirect must not break).
 */
export async function recordBroadcastLinkClick(input: {
  slug: string;
  request: Request;
  contactIgUserId: string | null;
}): Promise<string | null> {
  try {
    const link = await prisma.broadcastLink.findUnique({
      where: { slug: input.slug },
      select: {
        id: true,
        broadcastId: true,
        destinationUrl: true,
        broadcast: {
          select: {
            name: true,
            workspaceId: true,
            instagramAccount: { select: { id: true, workspaceId: true, instagramId: true } },
          },
        },
      },
    });
    if (!link) return null;
    try {
      const recipient = input.contactIgUserId
        ? await prisma.broadcastRecipient.findFirst({
            where: { broadcastId: link.broadcastId, igUserId: input.contactIgUserId },
            select: { id: true },
          })
        : null;
      const click = await prisma.broadcastLinkClick.create({
        data: {
          broadcastLinkId: link.id,
          broadcastId: link.broadcastId,
          recipientId: recipient?.id ?? null,
          contactIgUserId: input.contactIgUserId,
          ipHash: hashClickIp(getRequestIp(input.request)),
          userAgent: input.request.headers.get("user-agent"),
        },
        select: { id: true, createdAt: true },
      });
      const account = link.broadcast?.instagramAccount;
      if (input.contactIgUserId && account && click?.id) {
        await trackInteraction({
          account,
          igUserId: input.contactIgUserId,
          event: {
            type: "CLICK",
            refId: `bc:${click.id}`,
            occurredAt: click.createdAt ?? new Date(),
            text: link.broadcast?.name ?? null,
            meta: { broadcastId: link.broadcastId },
          },
          tags: [AUTO_TAGS.clicked],
        });
      }
    } catch (error) {
      console.warn("[Broadcasts] click not recorded:", error instanceof Error ? error.message : error);
    }
    return link.destinationUrl;
  } catch {
    return null;
  }
}
