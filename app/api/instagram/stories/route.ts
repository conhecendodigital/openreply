import { NextRequest, NextResponse } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { requireActiveInstagramAccount } from "@/lib/instagram-accounts";
import { noteMetaError } from "@/lib/channels/status";
import { getStories } from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";

/**
 * The account's stories that are still up (last 24 h), for the "Resposta de
 * story" picker in the campaign builder. Picking none = any story.
 */
export async function GET(request: NextRequest) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const resolved = await requireActiveInstagramAccount(
    workspaceId,
    request.nextUrl.searchParams.get("instagramAccountId")
  );
  if (!resolved.ok) return resolved.response;
  const account = resolved.account;

  try {
    const accessToken = decryptToken(account.accessToken);
    const stories = await getStories(accessToken, account.instagramId);
    return NextResponse.json({ success: true, data: stories });
  } catch (err) {
    console.error("[Instagram Stories] Error:", err);
    await noteMetaError({ id: account.id }, err);
    return NextResponse.json(
      { success: false, error: "Failed to fetch Instagram stories" },
      { status: 500 }
    );
  }
}
