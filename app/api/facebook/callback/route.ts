import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { getBaseUrl } from "@/lib/env";
import { canConnectInstagramAccount } from "@/lib/instagram-accounts";
import { FACEBOOK_PAGE_WEBHOOK_FIELDS, subscribeInstagramAccountToWebhooks } from "@/lib/meta/client";
import { clearAccountCache } from "@/lib/contacts/record";
import { encryptToken, verifyOAuthState } from "@/lib/meta/oauth";
import {
  exchangeFacebookCode,
  getFacebookUserId,
  listFacebookPages,
  pageDisplayUsername,
} from "@/lib/meta/facebook-oauth";
import { canManageWorkspace } from "@/lib/workspace-access";

/**
 * 23/10/2026: every Page granted in Meta's dialog becomes a channel
 * (InstagramAccount, platform FACEBOOK). Reconnecting is the same upsert as
 * Instagram: campaigns, contacts and messages of the Page come back untouched.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");
  const state = verifyOAuthState(request.nextUrl.searchParams.get("state"));
  const baseUrl = getBaseUrl();

  if (error) return NextResponse.redirect(`${baseUrl}/channels?facebook=denied`);
  if (!code || !state) return NextResponse.redirect(`${baseUrl}/channels?facebook=invalid`);

  const session = await auth();
  if (!session?.user?.id) return NextResponse.redirect(`${baseUrl}/login`);

  const membership = await prisma.workspaceMember.findFirst({
    where: { workspaceId: state.workspaceId, userId: session.user.id },
  });
  if (!membership || !canManageWorkspace(membership.role)) {
    return NextResponse.redirect(`${baseUrl}/channels?facebook=forbidden`);
  }

  try {
    const redirectUri = `${baseUrl}/api/facebook/callback`;
    const userToken = await exchangeFacebookCode(code, redirectUri);
    const appScopedId = await getFacebookUserId(userToken).catch(() => null);
    const pages = await listFacebookPages(userToken);
    if (pages.length === 0) {
      return NextResponse.redirect(`${baseUrl}/channels?facebook=no_pages`);
    }

    let connected = 0;
    let blocked = 0;
    for (const page of pages) {
      const connection = await canConnectInstagramAccount({
        workspaceId: state.workspaceId,
        instagramId: page.id,
      });
      if (!connection.allowed) {
        blocked += 1;
        continue;
      }

      let webhookSubscribed = false;
      try {
        const subscription = await subscribeInstagramAccountToWebhooks(page.id, page.accessToken);
        webhookSubscribed = Boolean(subscription.success);
      } catch (subscriptionError) {
        console.warn("[Facebook Callback] Webhook subscription failed:", subscriptionError);
      }

      const now = new Date();
      const previous = await prisma.instagramAccount.findUnique({
        where: { instagramId: page.id },
        select: { id: true, status: true },
      });
      const username = pageDisplayUsername(page);
      const connectionFields = {
        platform: "FACEBOOK",
        status: "ACTIVE" as const,
        appScopedId,
        accessToken: encryptToken(page.accessToken),
        tokenExpiresAt: null,
        webhookSubscribed,
        webhookFields: webhookSubscribed ? FACEBOOK_PAGE_WEBHOOK_FIELDS : [],
        profilePictureUrl: page.pictureUrl ?? null,
        disconnectedAt: null,
        disconnectedBy: null,
        lastError: webhookSubscribed ? null : "Webhook subscription failed on connect",
        lastErrorAt: webhookSubscribed ? null : now,
      };
      await prisma.instagramAccount.upsert({
        where: { instagramId: page.id },
        create: {
          workspaceId: state.workspaceId,
          instagramId: page.id,
          username,
          name: page.name,
          ...connectionFields,
        },
        update: {
          workspaceId: state.workspaceId,
          username,
          name: page.name,
          ...connectionFields,
          reconnectedAt: now,
        },
      });
      connected += 1;

      await prisma.operationalEvent
        .create({
          data: {
            source: "SYSTEM",
            level: "INFO",
            workspaceId: state.workspaceId,
            message: `Facebook Page ${page.name} ${previous ? "reconnected" : "connected"}`,
            payload: { pageId: page.id, previousStatus: previous?.status ?? null, webhookSubscribed },
          },
        })
        .catch(() => {});
    }
    clearAccountCache();

    if (connected === 0 && blocked > 0) {
      return NextResponse.redirect(`${baseUrl}/channels?facebook=already_connected`);
    }
    return NextResponse.redirect(`${baseUrl}/channels?connected=true&facebook=connected&pages=${connected}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[Facebook Callback] Error:", err);
    await prisma.operationalEvent
      .create({
        data: {
          source: "SYSTEM",
          level: "ERROR",
          workspaceId: state.workspaceId,
          message: "Facebook Page connection failed",
          payload: { reason: message },
        },
      })
      .catch(() => {});
    return NextResponse.redirect(
      `${baseUrl}/channels?facebook=failed&reason=${encodeURIComponent(message.slice(0, 200))}`
    );
  }
}
