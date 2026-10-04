/**
 * Tracked links of a flow's link buttons. Created at publish time (one per
 * node + button, slug unique across campaign TrackedLink and FlowLink), and
 * resolved by /r/<slug> only when no campaign link has that slug.
 */
import { prisma } from "@/lib/db/client";
import { generateTrackedLinkSlug, getRequestIp, hashClickIp } from "@/lib/tracking/server";
import { AUTO_TAGS, trackInteraction } from "@/lib/contacts/record";
import type { FlowDefinition } from "@/lib/flows/schema";

async function freeSlug(): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const slug = generateTrackedLinkSlug();
    const [campaign, flow, broadcast] = await Promise.all([
      prisma.trackedLink.findUnique({ where: { slug }, select: { id: true } }),
      prisma.flowLink.findUnique({ where: { slug }, select: { id: true } }),
      // Etapa 5: broadcast buttons share the /r/<slug> namespace.
      prisma.broadcastLink.findUnique({ where: { slug }, select: { id: true } }),
    ]);
    if (!campaign && !flow && !broadcast) return slug;
  }
  throw new Error("Could not create a unique link slug");
}

/** Make sure every link button of the definition has its FlowLink. */
export async function syncFlowLinks(flow: { id: string; workspaceId: string }, def: FlowDefinition): Promise<number> {
  let n = 0;
  for (const node of def.nodes) {
    if (node.type !== "message") continue;
    for (const b of node.buttons) {
      if (b.kind !== "link") continue;
      const existing = await prisma.flowLink.findUnique({
        where: { flowId_nodeId_buttonId: { flowId: flow.id, nodeId: node.id, buttonId: b.id } },
        select: { id: true, destinationUrl: true, label: true },
      });
      if (existing) {
        if (existing.destinationUrl !== b.url || existing.label !== b.label) {
          await prisma.flowLink.update({ where: { id: existing.id }, data: { destinationUrl: b.url, label: b.label } });
        }
      } else {
        await prisma.flowLink.create({
          data: {
            workspaceId: flow.workspaceId,
            flowId: flow.id,
            nodeId: node.id,
            buttonId: b.id,
            slug: await freeSlug(),
            label: b.label,
            destinationUrl: b.url,
          },
        });
      }
      n += 1;
    }
  }
  return n;
}

/**
 * /r/<slug> for a flow link: records the click (credited to the run when the
 * URL carries the signed recipient) and returns where to go. null = not a
 * flow link. Never throws (the redirect must not break).
 */
export async function recordFlowLinkClick(input: {
  slug: string;
  request: Request;
  contactIgUserId: string | null;
}): Promise<string | null> {
  try {
    const link = await prisma.flowLink.findUnique({
      where: { slug: input.slug },
      select: {
        id: true,
        flowId: true,
        nodeId: true,
        destinationUrl: true,
        flow: { select: { name: true, instagramAccountId: true, instagramAccount: { select: { id: true, workspaceId: true, instagramId: true } } } },
      },
    });
    if (!link) return null;
    try {
      const run = input.contactIgUserId
        ? await prisma.flowRun.findFirst({
            where: { flowId: link.flowId, igUserId: input.contactIgUserId },
            orderBy: { startedAt: "desc" },
            select: { id: true },
          })
        : null;
      const click = await prisma.flowLinkClick.create({
        data: {
          flowLinkId: link.id,
          flowId: link.flowId,
          nodeId: link.nodeId,
          runId: run?.id ?? null,
          contactIgUserId: input.contactIgUserId,
          ipHash: hashClickIp(getRequestIp(input.request)),
          userAgent: input.request.headers.get("user-agent"),
        },
        select: { id: true, createdAt: true },
      });
      if (run?.id) {
        await prisma.flowStep
          .create({
            data: { runId: run.id, flowId: link.flowId, nodeId: link.nodeId, nodeType: "message", outcome: "clicked", detail: link.id },
          })
          .catch(() => undefined);
      }
      const account = link.flow?.instagramAccount;
      if (input.contactIgUserId && account && click?.id) {
        await trackInteraction({
          account,
          igUserId: input.contactIgUserId,
          event: {
            type: "CLICK",
            refId: `flow:${click.id}`,
            occurredAt: click.createdAt ?? new Date(),
            text: link.flow?.name ?? null,
            meta: { flowId: link.flowId, nodeId: link.nodeId },
          },
          tags: [AUTO_TAGS.clicked],
        });
      }
    } catch (error) {
      console.warn("[Flows] click not recorded:", error instanceof Error ? error.message : error);
    }
    return link.destinationUrl;
  } catch {
    return null;
  }
}
