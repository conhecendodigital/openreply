import { NextRequest } from "next/server";
import { z } from "zod";
import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { fail, ok, readJson, requireContext } from "@/lib/api-helpers";
import { countSegment, segmentFiltersSchema } from "@/lib/segments/filters";
import { callerVia, findSegment, humanOnly, presentSegment, SEGMENT_SELECT, workspaceAccountId } from "@/lib/segments/api";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteProps) {
  const auth = await requireContext();
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const segment = await findSegment(id, auth.context.workspaceId);
  if (!segment) return fail("Segment not found", 404);
  const now = new Date();
  const count = await countSegment(
    { workspaceId: segment.workspaceId, instagramAccountId: segment.instagramAccountId },
    presentSegment(segment).filters,
    { now }
  );
  await prisma.segment
    .updateMany({ where: { id: segment.id }, data: { lastCount: count.total, lastCountAt: now } })
    .catch(() => undefined);
  return ok(presentSegment(segment, count));
}

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    instagramAccountId: z.string().min(1).optional().nullable(),
    filters: segmentFiltersSchema.optional(),
  })
  .strict();

// Editing a segment changes who a SCHEDULED broadcast of it will reach (the
// recipients are picked when it starts), never one already sending.
export async function PATCH(request: NextRequest, { params }: RouteProps) {
  const auth = await requireContext({ manage: true });
  if ("response" in auth) return auth.response;
  const parsed = patchSchema.safeParse(await readJson(request));
  if (!parsed.success) return fail("Invalid segment", 400, parsed.error.issues);
  const { id } = await params;
  const segment = await findSegment(id, auth.context.workspaceId);
  if (!segment) return fail("Segment not found", 404);
  // A scheduled broadcast picks its people from this segment when it starts:
  // an API key changing the filters would change (widen) an audience a human
  // approved. Only a signed-in person may do that.
  if (parsed.data.filters !== undefined && (await callerVia()) === "mcp") {
    const scheduled = await prisma.broadcast.count({
      where: { segmentId: segment.id, workspaceId: auth.context.workspaceId, status: { in: ["SCHEDULED", "SENDING"] } },
    });
    if (scheduled > 0) {
      return fail("API keys cannot change a segment used by a scheduled broadcast. Do it in the Lead Engine.", 403, {
        code: "human_only",
      });
    }
  }

  const data: Prisma.SegmentUpdateInput = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.instagramAccountId !== undefined) {
    const account = await workspaceAccountId(auth.context.workspaceId, parsed.data.instagramAccountId);
    if (!account.ok) return fail("Account not found", 404);
    data.instagramAccountId = account.id;
  }
  if (parsed.data.filters !== undefined) data.filters = parsed.data.filters as unknown as Prisma.InputJsonValue;
  if (Object.keys(data).length === 0) return fail("Nothing to change", 400);
  const updated = await prisma.segment.update({ where: { id: segment.id }, data, select: SEGMENT_SELECT });
  return ok(presentSegment(updated));
}

// Deleting a segment never deletes contacts; broadcasts that used it keep
// their filters snapshot.
export async function DELETE(_request: NextRequest, { params }: RouteProps) {
  const auth = await requireContext({ manage: true });
  if ("response" in auth) return auth.response;
  const blocked = await humanOnly("delete segments");
  if (blocked) return blocked;
  const { id } = await params;
  const segment = await findSegment(id, auth.context.workspaceId);
  if (!segment) return fail("Segment not found", 404);
  await prisma.segment.delete({ where: { id: segment.id } });
  return ok({ deleted: true });
}
