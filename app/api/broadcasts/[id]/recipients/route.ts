import { NextRequest } from "next/server";
import type { BroadcastRecipientStatus } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { fail, intParam, ok, requireContext } from "@/lib/api-helpers";
import { findBroadcast } from "@/lib/broadcasts/service";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

const STATUSES = new Set<string>([
  "PENDING",
  "SENDING",
  "SENT",
  "FAILED",
  "MAYBE_SENT",
  "SKIPPED_WINDOW",
  "SKIPPED_TAKEOVER",
  "SKIPPED_OPTOUT",
  "SKIPPED_CHANNEL",
  "SKIPPED_LIMIT",
  "SKIPPED_BUSY",
  "SKIPPED_CANCELED",
]);

// Who got it (or why not), 50 per page, newest first.
export async function GET(request: NextRequest, { params }: RouteProps) {
  const auth = await requireContext();
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const broadcast = await findBroadcast(id, auth.context.workspaceId);
  if (!broadcast) return fail("Broadcast not found", 404);
  const status = request.nextUrl.searchParams.get("status");
  const page = intParam(request.nextUrl.searchParams.get("page"), 1, 1, 1000);
  const rows = await prisma.broadcastRecipient.findMany({
    where: {
      broadcastId: broadcast.id,
      ...(status && STATUSES.has(status) ? { status: status as BroadcastRecipientStatus } : {}),
    },
    select: {
      id: true,
      igUserId: true,
      variantKey: true,
      status: true,
      error: true,
      sentAt: true,
      updatedAt: true,
      contact: { select: { id: true, username: true, name: true } },
    },
    orderBy: { updatedAt: "desc" },
    skip: (page - 1) * 50,
    take: 50,
  });
  return ok(Array.isArray(rows) ? rows : []);
}
