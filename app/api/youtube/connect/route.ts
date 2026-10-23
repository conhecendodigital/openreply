import { NextRequest, NextResponse } from "next/server";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { getBaseUrl } from "@/lib/env";
import { createOAuthState } from "@/lib/meta/oauth";
import { getMissingYouTubeEnv, getYouTubeAuthorizationUrl } from "@/lib/youtube/oauth";
import { parseYouTubeReturn, YOUTUBE_RETURN_COOKIE, youtubeReturnPath } from "@/lib/youtube/return";

export const dynamic = "force-dynamic";

/** 23/10/2026: conecta um canal do YouTube (Google OAuth). `?return=channels` volta para a página Canais. */
export async function GET(request: NextRequest) {
  const where = parseYouTubeReturn(request.nextUrl.searchParams.get("return"));
  const base = `${getBaseUrl()}${youtubeReturnPath(where)}`;
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.redirect(`${getBaseUrl()}/login`);
  if (!canManageWorkspace(context.role)) return NextResponse.redirect(`${base}?youtube=forbidden`);

  if (getMissingYouTubeEnv().length > 0) return NextResponse.redirect(`${base}?youtube=misconfigured`);

  const redirectUri = `${getBaseUrl()}/api/youtube/callback`;
  const response = NextResponse.redirect(getYouTubeAuthorizationUrl(redirectUri, createOAuthState(context.workspaceId)));
  response.cookies.set(YOUTUBE_RETURN_COOKIE, where, { httpOnly: true, sameSite: "lax", secure: true, path: "/api/youtube", maxAge: 600 });
  return response;
}
