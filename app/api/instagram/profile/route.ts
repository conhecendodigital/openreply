import { NextRequest, NextResponse } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { requireActiveInstagramAccount } from "@/lib/instagram-accounts";
import { noteMetaError } from "@/lib/channels/status";
import { getUserInfo } from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";

export const dynamic = "force-dynamic";

// Live profile lookup (username + avatar) for the campaign preview.
export async function GET(request: NextRequest) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const resolved = await requireActiveInstagramAccount(
    workspaceId,
    request.nextUrl.searchParams.get("instagramAccountId")
  );
  if (!resolved.ok) return resolved.response;
  const account = resolved.account;

  try {
    const token = decryptToken(account.accessToken);
    const info = await getUserInfo(token);
    return NextResponse.json(
      {
        success: true,
        data: {
          username: info.username,
          name: info.name ?? null,
          profilePictureUrl: info.profile_picture_url ?? null,
        },
      },
      { headers: { "Cache-Control": "private, max-age=300" } }
    );
  } catch (err) {
    console.error("[Instagram Profile] Error:", err);
    await noteMetaError({ id: account.id }, err);
    return NextResponse.json(
      { success: false, error: "Failed to load profile" },
      { status: 500 }
    );
  }
}
