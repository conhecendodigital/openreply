import { NextRequest } from "next/server";
import type { BroadcastStatus, Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { fail, ok, readJson, requireContext } from "@/lib/api-helpers";
import { getWorkspaceInstagramAccount } from "@/lib/instagram-accounts";
import { EMPTY_FILTERS, parseFilters } from "@/lib/segments/filters";
import { callerVia, findSegment } from "@/lib/segments/api";
import { createBroadcastSchema } from "@/lib/broadcasts/schema";
import { BROADCAST_SELECT, presentBroadcast } from "@/lib/broadcasts/service";

export const dynamic = "force-dynamic";

const STATUSES = new Set<BroadcastStatus>(["DRAFT", "SCHEDULED", "SENDING", "DONE", "CANCELED", "FAILED"]);

export async function GET(request: NextRequest) {
  const auth = await requireContext();
  if ("response" in auth) return auth.response;
  const status = request.nextUrl.searchParams.get("status") as BroadcastStatus | null;
  const rows = await prisma.broadcast.findMany({
    where: {
      workspaceId: auth.context.workspaceId,
      ...(status && STATUSES.has(status) ? { status } : {}),
    },
    select: BROADCAST_SELECT,
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return ok((Array.isArray(rows) ? rows : []).map(presentBroadcast));
}

/**
 * A new broadcast is ALWAYS a draft (API keys included; the MCP's
 * criar_rascunho_disparo lands here). Sending it is a separate, human-only
 * step (POST /api/broadcasts/[id]/send).
 */
export async function POST(request: NextRequest) {
  const auth = await requireContext({ manage: true });
  if ("response" in auth) return auth.response;
  const parsed = createBroadcastSchema.safeParse(await readJson(request));
  if (!parsed.success) return fail("Invalid broadcast", 400, parsed.error.issues);
  const input = parsed.data;

  const account = await getWorkspaceInstagramAccount(auth.context.workspaceId, input.instagramAccountId);
  if (!account) return fail("Connect an Instagram account first", 400, { code: "no_account" });

  let filters = input.filters ?? EMPTY_FILTERS;
  let segmentId: string | null = null;
  if (input.segmentId) {
    const segment = await findSegment(input.segmentId, auth.context.workspaceId);
    if (!segment) return fail("Segment not found", 404);
    if (segment.instagramAccountId && segment.instagramAccountId !== account.id) {
      return fail("The segment belongs to another account", 400, { code: "segment_account" });
    }
    segmentId = segment.id;
    filters = parseFilters(segment.filters);
  }

  const flowIds = input.buttons.flatMap((b) => (b.kind === "flow" ? [b.flowId] : []));
  if (flowIds.length > 0) {
    const flows = await prisma.flow.findMany({
      where: { id: { in: flowIds }, workspaceId: auth.context.workspaceId, instagramAccountId: account.id },
      select: { id: true },
    });
    const found = new Set((Array.isArray(flows) ? flows : []).map((f) => f.id));
    if (flowIds.some((id) => !found.has(id))) return fail("Flow not found", 404, { code: "flow_not_found" });
  }

  const broadcast = await prisma.broadcast.create({
    data: {
      workspaceId: auth.context.workspaceId,
      instagramAccountId: account.id,
      segmentId,
      filtersSnapshot: filters as unknown as Prisma.InputJsonValue,
      name: input.name,
      text: input.text,
      buttons: input.buttons as unknown as Prisma.InputJsonValue,
      ...(input.variants && input.variants.length > 0
        ? { variants: input.variants as unknown as Prisma.InputJsonValue }
        : {}),
      skipBusy: input.skipBusy,
      batchSize: input.batchSize,
      pauseSeconds: input.pauseSeconds,
      status: "DRAFT",
      createdBy: auth.context.userId,
      createdVia: await callerVia(),
    },
    select: BROADCAST_SELECT,
  });
  return ok(presentBroadcast(broadcast), 201);
}
