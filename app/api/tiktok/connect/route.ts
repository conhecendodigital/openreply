import { NextRequest, NextResponse } from "next/server";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { getBaseUrl } from "@/lib/env";
import { createOAuthState } from "@/lib/meta/oauth";
import { getMissingTikTokEnv, getTikTokAuthorizationUrl } from "@/lib/tiktok/oauth";

export const dynamic = "force-dynamic";

/** 23/10/2026: conecta uma conta do TikTok (Login Kit). */
export async function GET(request: NextRequest) {
  // `?return=channels` volta para a página Canais (cookie curto, lido no callback).
  const where = request.nextUrl.searchParams.get("return") === "channels" ? "channels" : "posts";
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.redirect(`${getBaseUrl()}/login`);
  if (!canManageWorkspace(context.role)) return NextResponse.redirect(`${getBaseUrl()}/${where}?tiktok=forbidden`);

  const missing = getMissingTikTokEnv();
  if (missing.length > 0) return NextResponse.redirect(`${getBaseUrl()}/${where}?tiktok=misconfigured`);

  const redirectUri = `${getBaseUrl()}/api/tiktok/callback`;
  const response = NextResponse.redirect(getTikTokAuthorizationUrl(redirectUri, createOAuthState(context.workspaceId)));
  response.cookies.set("tt_return", where, { httpOnly: true, sameSite: "lax", secure: true, path: "/api/tiktok", maxAge: 600 });
  return response;
}
