import { NextRequest } from "next/server";
import { z } from "zod";
import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { fail, ok, readJson, requireContext } from "@/lib/api-helpers";
import { countSegment, segmentFiltersSchema } from "@/lib/segments/filters";
import { callerVia, presentSegment, SEGMENT_SELECT, workspaceAccountId } from "@/lib/segments/api";

export const dynamic = "force-dynamic";

// Saved segments of the workspace. ?count=1 adds the live count of each
// ("X contacts, Y with the conversation open now").
export async function GET(request: NextRequest) {
  const auth = await requireContext();
  if ("response" in auth) return auth.response;
  const rows = await prisma.segment.findMany({
    where: { workspaceId: auth.context.workspaceId },
    select: SEGMENT_SELECT,
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const list = Array.isArray(rows) ? rows : [];
  if (request.nextUrl.searchParams.get("count") !== "1") return ok(list.map((s) => presentSegment(s)));
  const now = new Date();
  const out = [];
  for (const s of list) {
    const count = await countSegment(
      { workspaceId: s.workspaceId, instagramAccountId: s.instagramAccountId },
      presentSegment(s).filters,
      { now }
    );
    out.push(presentSegment(s, count));
  }
  return ok(out);
}

const createSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    instagramAccountId: z.string().min(1).optional().nullable(),
    filters: segmentFiltersSchema.default(segmentFiltersSchema.parse({})),
  })
  .strict();

// A segment is only a saved filter: it sends nothing, so an API key may
// create one too (createdVia "mcp").
export async function POST(request: NextRequest) {
  const auth = await requireContext({ manage: true });
  if ("response" in auth) return auth.response;
  const parsed = createSchema.safeParse(await readJson(request));
  if (!parsed.success) return fail("Invalid segment", 400, parsed.error.issues);
  const account = await workspaceAccountId(auth.context.workspaceId, parsed.data.instagramAccountId);
  if (!account.ok) return fail("Account not found", 404);

  const now = new Date();
  const count = await countSegment(
    { workspaceId: auth.context.workspaceId, instagramAccountId: account.id },
    parsed.data.filters,
    { now }
  );
  const segment = await prisma.segment.create({
    data: {
      workspaceId: auth.context.workspaceId,
      instagramAccountId: account.id,
      name: parsed.data.name,
      filters: parsed.data.filters as unknown as Prisma.InputJsonValue,
      createdBy: auth.context.userId,
      createdVia: await callerVia(),
      lastCount: count.total,
      lastCountAt: now,
    },
    select: SEGMENT_SELECT,
  });
  return ok(presentSegment(segment, count), 201);
}
