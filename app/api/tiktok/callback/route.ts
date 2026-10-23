import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getBaseUrl } from "@/lib/env";
import { encryptToken, verifyOAuthState } from "@/lib/meta/oauth";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { exchangeTikTokCode, getMissingTikTokEnv, getTikTokProfile } from "@/lib/tiktok/oauth";

export const dynamic = "force-dynamic";

/** 23/10/2026: volta do TikTok. Guarda os tokens cifrados e manda pra aba Posts. */
export async function GET(request: NextRequest) {
  const baseUrl = getBaseUrl();
  const back = (result: string) => NextResponse.redirect(`${baseUrl}/posts?tiktok=${result}`);

  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.redirect(`${baseUrl}/login`);
  if (!canManageWorkspace(context.role)) return back("forbidden");

  const params = request.nextUrl.searchParams;
  if (params.get("error")) return back("denied");

  const state = verifyOAuthState(params.get("state"));
  if (!state || state.workspaceId !== context.workspaceId) return back("invalid");
  const code = params.get("code");
  if (!code) return back("invalid");
  if (getMissingTikTokEnv().length > 0) return back("misconfigured");

  try {
    const tokens = await exchangeTikTokCode(code, `${baseUrl}/api/tiktok/callback`);
    const profile = await getTikTokProfile(tokens.accessToken);
    const openId = profile.openId || tokens.openId;

    const existing = await prisma.socialAccount.findUnique({
      where: { platform_externalId: { platform: "TIKTOK", externalId: openId } },
      select: { workspaceId: true },
    });
    if (existing && existing.workspaceId !== context.workspaceId) return back("already_connected");

    const now = new Date();
    const fields = {
      displayName: profile.displayName || "TikTok",
      username: profile.username,
      avatarUrl: profile.avatarUrl,
      accessToken: encryptToken(tokens.accessToken),
      refreshToken: tokens.refreshToken ? encryptToken(tokens.refreshToken) : null,
      tokenExpiresAt: new Date(now.getTime() + tokens.expiresIn * 1000),
      refreshExpiresAt: tokens.refreshExpiresIn ? new Date(now.getTime() + tokens.refreshExpiresIn * 1000) : null,
      scopes: tokens.scopes,
      status: "ACTIVE" as const,
      lastError: null,
      disconnectedAt: null,
    };
    await prisma.socialAccount.upsert({
      where: { platform_externalId: { platform: "TIKTOK", externalId: openId } },
      create: { workspaceId: context.workspaceId, platform: "TIKTOK", externalId: openId, ...fields },
      update: fields,
    });
    return back("connected");
  } catch (error) {
    console.error("[TikTok Callback]", error instanceof Error ? error.message : error);
    return back("failed");
  }
}
