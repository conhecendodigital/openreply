import { NextResponse } from "next/server";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { getBaseUrl } from "@/lib/env";
import { createOAuthState } from "@/lib/meta/oauth";
import { getMissingTikTokEnv, getTikTokAuthorizationUrl } from "@/lib/tiktok/oauth";

export const dynamic = "force-dynamic";

/** 23/10/2026: conecta uma conta do TikTok (Login Kit). */
export async function GET() {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.redirect(`${getBaseUrl()}/login`);
  if (!canManageWorkspace(context.role)) return NextResponse.redirect(`${getBaseUrl()}/posts?tiktok=forbidden`);

  const missing = getMissingTikTokEnv();
  if (missing.length > 0) return NextResponse.redirect(`${getBaseUrl()}/posts?tiktok=misconfigured`);

  const redirectUri = `${getBaseUrl()}/api/tiktok/callback`;
  return NextResponse.redirect(getTikTokAuthorizationUrl(redirectUri, createOAuthState(context.workspaceId)));
}
