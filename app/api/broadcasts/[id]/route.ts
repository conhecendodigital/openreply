import { NextRequest } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { fail, ok, readJson, requireContext } from "@/lib/api-helpers";
import { parseFilters } from "@/lib/segments/filters";
import { findSegment } from "@/lib/segments/api";
import { updateBroadcastSchema } from "@/lib/broadcasts/schema";
import {
  BROADCAST_SELECT,
  broadcastAudience,
  broadcastStats,
  findBroadcast,
  presentBroadcast,
} from "@/lib/broadcasts/service";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

// The broadcast, its history (sent, failed, clicks, replies, per variant) and,
// while it has not started, the live audience: "X in the segment, Y with the
// conversation open now (only those receive)".
export async function GET(_request: NextRequest, { params }: RouteProps) {
  const auth = await requireContext();
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const broadcast = await findBroadcast(id, auth.context.workspaceId);
  if (!broadcast) return fail("Broadcast not found", 404);
  const notStarted = broadcast.status === "DRAFT" || broadcast.status === "SCHEDULED";
  const [stats, audience] = await Promise.all([
    broadcastStats(broadcast.id),
    notStarted ? broadcastAudience(broadcast) : Promise.resolve(null),
  ]);
  return ok({ ...presentBroadcast(broadcast), stats, audience });
}

// Only a DRAFT changes (an API key too: it is still only a draft).
export async function PATCH(request: NextRequest, { params }: RouteProps) {
  const auth = await requireContext({ manage: true });
  if ("response" in auth) return auth.response;
  const parsed = updateBroadcastSchema.safeParse(await readJson(request));
  if (!parsed.success) return fail("Invalid broadcast", 400, parsed.error.issues);
  const { id } = await params;
  const broadcast = await findBroadcast(id, auth.context.workspaceId);
  if (!broadcast) return fail("Broadcast not found", 404);
  if (broadcast.status !== "DRAFT") return fail("Only a draft can be edited", 409, { code: "not_draft" });

  const input = parsed.data;
  const data: Prisma.BroadcastUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.text !== undefined) data.text = input.text;
  if (input.skipBusy !== undefined) data.skipBusy = input.skipBusy;
  if (input.batchSize !== undefined) data.batchSize = input.batchSize;
  if (input.pauseSeconds !== undefined) data.pauseSeconds = input.pauseSeconds;
  if (input.buttons !== undefined) {
    const flowIds = input.buttons.flatMap((b) => (b.kind === "flow" ? [b.flowId] : []));
    if (flowIds.length > 0) {
      const flows = await prisma.flow.findMany({
        where: { id: { in: flowIds }, workspaceId: auth.context.workspaceId, instagramAccountId: broadcast.instagramAccountId },
        select: { id: true },
      });
      const found = new Set((Array.isArray(flows) ? flows : []).map((f) => f.id));
      if (flowIds.some((fid) => !found.has(fid))) return fail("Flow not found", 404, { code: "flow_not_found" });
    }
    data.buttons = input.buttons as unknown as Prisma.InputJsonValue;
  }
  if (input.variants !== undefined) {
    data.variants =
      input.variants && input.variants.length > 0
        ? (input.variants as unknown as Prisma.InputJsonValue)
        : Prisma.DbNull;
  }
  if (input.segmentId !== undefined) {
    if (input.segmentId) {
      const segment = await findSegment(input.segmentId, auth.context.workspaceId);
      if (!segment) return fail("Segment not found", 404);
      data.segment = { connect: { id: segment.id } };
      data.filtersSnapshot = parseFilters(segment.filters) as unknown as Prisma.InputJsonValue;
    } else {
      data.segment = { disconnect: true };
    }
  }
  if (input.filters !== undefined && !input.segmentId) {
    // Inline filters replace the saved segment (the start would use the
    // segment's filters otherwise).
    data.filtersSnapshot = input.filters as unknown as Prisma.InputJsonValue;
    if (broadcast.segmentId) data.segment = { disconnect: true };
  }
  if (Object.keys(data).length === 0) return fail("Nothing to change", 400);
  const updated = await prisma.broadcast.update({ where: { id: broadcast.id }, data, select: BROADCAST_SELECT });
  return ok(presentBroadcast(updated));
}

// Only a draft is deleted: a broadcast that went out stays as history.
export async function DELETE(_request: NextRequest, { params }: RouteProps) {
  const auth = await requireContext({ manage: true });
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const broadcast = await findBroadcast(id, auth.context.workspaceId);
  if (!broadcast) return fail("Broadcast not found", 404);
  if (broadcast.status !== "DRAFT") return fail("Only a draft can be deleted", 409, { code: "not_draft" });
  await prisma.broadcast.delete({ where: { id: broadcast.id } });
  return ok({ deleted: true });
}
