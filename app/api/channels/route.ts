import { NextResponse } from "next/server";
import { getChannelsOverview } from "@/lib/channels/overview";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";

export const dynamic = "force-dynamic";

/**
 * Channels page data: one card per connected Instagram account (status,
 * token expiry, webhooks, last webhook, campaigns, moderation, contacts,
 * pending drafts, alerts), the "coming soon" channels and the alert list for
 * the dashboard banner. Read-only; API keys (MCP ver_canais) may read it.
 */
export async function GET() {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const data = await getChannelsOverview(context.workspaceId);
  return NextResponse.json({ success: true, data });
}
