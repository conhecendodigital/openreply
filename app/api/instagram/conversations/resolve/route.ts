import { NextRequest, NextResponse } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { getWorkspaceInstagramAccount } from "@/lib/instagram-accounts";
import { resolveConversation } from "@/lib/inbox/open-conversation";

// Opens ONE person's conversation for a deep link (/inbox?contact=...), even
// when Instagram does not list it among the recent ones. Read-only: sends nothing.
export async function GET(request: NextRequest) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const contactId = request.nextUrl.searchParams.get("contactId")?.trim();
  if (!contactId) {
    return NextResponse.json({ success: false, error: "contactId is required" }, { status: 400 });
  }
  const account = await getWorkspaceInstagramAccount(
    workspaceId,
    request.nextUrl.searchParams.get("instagramAccountId")
  );
  if (!account) {
    return NextResponse.json({ success: false, error: "Instagram account not connected." }, { status: 400 });
  }
  const data = await resolveConversation(account, contactId);
  return NextResponse.json({ success: true, data });
}
