import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { fail, intParam, ok, readJson, requireContext } from "@/lib/api-helpers";
import { describeTakeover, describeWindow } from "@/lib/inbox/context";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

// One contact with tags, counters, recent moderation and the timeline.
// Timeline is newest first; pass ?before=<nextCursor> for older events.
export async function GET(request: NextRequest, { params }: RouteProps) {
  const auth = await requireContext();
  if ("response" in auth) return auth.response;
  const { workspaceId } = auth.context;
  const { id } = await params;

  const contact = await prisma.contact.findFirst({
    where: { id, workspaceId },
    include: {
      tags: { select: { name: true, source: true, createdAt: true }, orderBy: { createdAt: "asc" } },
      instagramAccount: { select: { id: true, username: true, instagramId: true } },
    },
  });
  if (!contact) return fail("Contact not found", 404);

  const search = request.nextUrl.searchParams;
  const limit = intParam(search.get("limit"), 50, 1, 200);
  const beforeRaw = search.get("before");
  const before = beforeRaw ? new Date(beforeRaw) : null;

  const [events, moderation] = await Promise.all([
    prisma.contactEvent.findMany({
      where: {
        contactId: contact.id,
        ...(before && !Number.isNaN(before.getTime()) ? { occurredAt: { lt: before } } : {}),
      },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    }),
    prisma.commentModeration.findMany({
      where: {
        workspaceId,
        instagramAccountId: contact.instagramAccountId,
        commenterIgId: contact.igUserId,
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);
  const hasMore = events.length > limit;
  const page = hasMore ? events.slice(0, limit) : events;

  return ok({
    contact,
    events: page,
    nextCursor: hasMore ? page[page.length - 1].occurredAt.toISOString() : null,
    moderation,
    // Etapa 2: 24-hour window and "Você assumiu" state for the screens.
    messaging: { window: describeWindow(contact), takeover: describeTakeover(contact) },
    links: {
      inbox: `/inbox?account=${encodeURIComponent(contact.instagramAccountId)}&contact=${encodeURIComponent(contact.igUserId)}`,
      profile: contact.username ? `https://www.instagram.com/${encodeURIComponent(contact.username)}/` : null,
    },
  });
}

const patchSchema = z.object({
  notes: z.string().max(5000).nullable(),
});

export async function PATCH(request: NextRequest, { params }: RouteProps) {
  const auth = await requireContext();
  if ("response" in auth) return auth.response;
  const { id } = await params;

  const parsed = patchSchema.safeParse(await readJson(request));
  if (!parsed.success) return fail("Invalid request", 400, parsed.error.issues);

  const { count } = await prisma.contact.updateMany({
    where: { id, workspaceId: auth.context.workspaceId },
    data: { notes: parsed.data.notes?.trim() || null },
  });
  if (count === 0) return fail("Contact not found", 404);
  return ok({ id, notes: parsed.data.notes?.trim() || null });
}
