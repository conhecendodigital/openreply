import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getBaseUrl } from "@/lib/env";
import { encryptToken, verifyOAuthState } from "@/lib/meta/oauth";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";
import {
  exchangeYouTubeCode,
  getMissingYouTubeEnv,
  getYouTubeChannel,
  missingYouTubeScopes,
  YouTubeApiError,
  YouTubeAuthError,
} from "@/lib/youtube/oauth";
import { parseYouTubeReturn, shortScope, YOUTUBE_RETURN_COOKIE, youtubeReturnPath } from "@/lib/youtube/return";

export const dynamic = "force-dynamic";

/**
 * 23/10/2026: volta do Google. Guarda os tokens cifrados e os escopos que a
 * pessoa realmente concedeu (ela pode desmarcar algum). Se faltar algum,
 * a conexão vale e o aviso diz o que faltou.
 */
export async function GET(request: NextRequest) {
  const baseUrl = getBaseUrl();
  const where = parseYouTubeReturn(request.cookies.get(YOUTUBE_RETURN_COOKIE)?.value);
  const back = (result: string, extra?: Record<string, string>) => {
    const url = new URL(`${baseUrl}${youtubeReturnPath(where)}`);
    url.searchParams.set("youtube", result);
    for (const [k, v] of Object.entries(extra ?? {})) url.searchParams.set(k, v);
    const response = NextResponse.redirect(url);
    response.cookies.delete({ name: YOUTUBE_RETURN_COOKIE, path: "/api/youtube" });
    return response;
  };

  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.redirect(`${baseUrl}/login`);
  if (!canManageWorkspace(context.role)) return back("forbidden");

  const params = request.nextUrl.searchParams;
  if (params.get("error")) return back("denied");

  const state = verifyOAuthState(params.get("state"));
  if (!state || state.workspaceId !== context.workspaceId) return back("invalid");
  const code = params.get("code");
  if (!code) return back("invalid");
  if (getMissingYouTubeEnv().length > 0) return back("misconfigured");

  try {
    const tokens = await exchangeYouTubeCode(code, `${baseUrl}/api/youtube/callback`);
    const channel = await getYouTubeChannel(tokens.accessToken);

    const existing = await prisma.socialAccount.findUnique({
      where: { platform_externalId: { platform: "YOUTUBE", externalId: channel.channelId } },
      select: { workspaceId: true, refreshToken: true },
    });
    if (existing && existing.workspaceId !== context.workspaceId) return back("already_connected");
    // Sem refresh token (o Google só manda com consent) e sem um guardado: não dá para publicar depois.
    if (!tokens.refreshToken && !existing?.refreshToken) return back("failed");

    const now = new Date();
    const fields = {
      displayName: channel.title,
      username: channel.handle,
      avatarUrl: channel.avatarUrl,
      accessToken: encryptToken(tokens.accessToken),
      ...(tokens.refreshToken ? { refreshToken: encryptToken(tokens.refreshToken) } : {}),
      tokenExpiresAt: new Date(now.getTime() + tokens.expiresIn * 1000),
      scopes: tokens.scopes,
      status: "ACTIVE" as const,
      lastError: null,
      disconnectedAt: null,
    };
    await prisma.socialAccount.upsert({
      where: { platform_externalId: { platform: "YOUTUBE", externalId: channel.channelId } },
      create: { workspaceId: context.workspaceId, platform: "YOUTUBE", externalId: channel.channelId, ...fields, refreshToken: tokens.refreshToken ? encryptToken(tokens.refreshToken) : null },
      update: fields,
    });

    const missing = missingYouTubeScopes(tokens.scopes);
    if (missing.length > 0) return back("partial", { missing: missing.map(shortScope).join(",") });
    return back("connected");
  } catch (error) {
    console.error("[YouTube Callback]", error instanceof Error ? error.message : error);
    if (error instanceof YouTubeApiError) {
      if (error.apiDisabled) return back("api_disabled");
      if (error.reason === "no_channel") return back("no_channel");
    }
    if (error instanceof YouTubeAuthError && error.code === "misconfigured") return back("misconfigured");
    return back("failed");
  }
}
