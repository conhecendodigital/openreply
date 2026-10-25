import { NextResponse } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { pickDefaultInstagramAccount } from "@/lib/instagram-accounts";

export const runtime = "nodejs";

/**
 * The workspace's connected Instagram accounts — just enough for an account
 * selector. This is a single indexed query, unlike /api/dashboard/stats which
 * runs the full analytics aggregation. Pages that only need the account list
 * (e.g. the inbox) should use this so they aren't gated on heavy stats.
 */
export async function GET() {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const instagramAccounts = await prisma.instagramAccount.findMany({
    where: { workspaceId },
    orderBy: { connectedAt: "desc" },
    select: { id: true, username: true, instagramId: true, name: true, status: true, platform: true },
  });

  return NextResponse.json({
    success: true,
    data: {
      instagramAccounts,
      // Prefer a working Instagram; a Facebook Page only when there is no
      // Instagram (25/10/2026). A disconnected one is still listed.
      selectedInstagramAccountId: pickDefaultInstagramAccount(instagramAccounts)?.id ?? null,
    },
  });
}
