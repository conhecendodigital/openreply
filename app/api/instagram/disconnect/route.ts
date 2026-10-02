import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import {
  canManageWorkspace,
  getCurrentWorkspaceContext,
} from "@/lib/workspace-access";

export async function POST(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  if (!canManageWorkspace(context.role)) {
    return NextResponse.json(
      { success: false, error: "Only owners and admins can disconnect accounts" },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const instagramAccountId =
    typeof body.instagramAccountId === "string" ? body.instagramAccountId : null;

  // Deleting the account cascades to its campaigns, tracked links, clicks and
  // DM logs. An expired token does not need this: connecting again refreshes
  // the token in place. So refuse while campaigns exist, unless the caller
  // explicitly asks to delete them too.
  if (body.deleteCampaigns !== true) {
    const campaigns = await prisma.automation.count({
      where: {
        workspaceId: context.workspaceId,
        ...(instagramAccountId ? { instagramAccountId } : {}),
      },
    });
    if (campaigns > 0) {
      return NextResponse.json(
        {
          success: false,
          error: `This account has ${campaigns} campaign(s). Disconnecting deletes them for good. To fix an expired or invalid token, just click Connect again: campaigns are kept.`,
          campaigns,
        },
        { status: 409 }
      );
    }
  }

  await prisma.instagramAccount.deleteMany({
    where: {
      workspaceId: context.workspaceId,
      ...(instagramAccountId ? { id: instagramAccountId } : {}),
    },
  });

  return NextResponse.json({ success: true });
}
