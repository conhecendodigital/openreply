import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { getBaseUrl } from "@/lib/env";
import { canConnectInstagramAccount } from "@/lib/instagram-accounts";
import {
  getLongLivedToken,
  getUserInfo,
  subscribeInstagramAccountToWebhooks,
  WEBHOOK_SUBSCRIBED_FIELDS,
} from "@/lib/meta/client";
import { clearAccountCache } from "@/lib/contacts/record";
import {
  encryptToken,
  exchangeCodeForToken,
  verifyOAuthState,
} from "@/lib/meta/oauth";
import { canManageWorkspace } from "@/lib/workspace-access";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");
  const state = verifyOAuthState(request.nextUrl.searchParams.get("state"));
  const baseUrl = getBaseUrl();

  if (error) {
    return NextResponse.redirect(`${baseUrl}/channels?instagram=denied`);
  }

  if (!code || !state) {
    return NextResponse.redirect(`${baseUrl}/channels?instagram=invalid`);
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(`${baseUrl}/login`);
  }

  const membership = await prisma.workspaceMember.findFirst({
    where: {
      workspaceId: state.workspaceId,
      userId: session.user.id,
    },
  });

  if (!membership || !canManageWorkspace(membership.role)) {
    return NextResponse.redirect(`${baseUrl}/channels?instagram=forbidden`);
  }

  try {
    const redirectUri = `${baseUrl}/api/instagram/callback`;
    const { accessToken: shortLivedToken } = await exchangeCodeForToken(
      code,
      redirectUri
    );
    const { accessToken: longLivedToken, expiresIn } =
      await getLongLivedToken(shortLivedToken);
    const userInfo = await getUserInfo(longLivedToken);
    // Webhooks and the messaging API key off the professional account ID
    // (user_id), not the app-scoped `id`. Store user_id so comment webhooks
    // can be matched back to this account. Fall back to id if user_id is
    // ever absent.
    const instagramId = userInfo.user_id ?? userInfo.id;
    const connection = await canConnectInstagramAccount({
      workspaceId: state.workspaceId,
      instagramId,
    });

    if (!connection.allowed) {
      return NextResponse.redirect(
        `${baseUrl}/channels?instagram=already_connected`
      );
    }

    const encryptedToken = encryptToken(longLivedToken);
    const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);

    let webhookSubscribed = false;
    try {
      const subscription = await subscribeInstagramAccountToWebhooks(
        instagramId,
        longLivedToken
      );
      webhookSubscribed = Boolean(subscription.success);
    } catch (subscriptionError) {
      console.warn(
        "[Instagram Callback] Webhook subscription failed:",
        subscriptionError
      );
    }

    // Reconnecting the same account is an upsert on the same row (same id):
    // campaigns, contacts, conversations, drafts, sequences, links and
    // settings all come back exactly as they were, each campaign in the
    // on/off state it had. Only the connection itself is refreshed.
    const now = new Date();
    const previous = await prisma.instagramAccount.findUnique({
      where: { instagramId },
      select: { id: true, status: true },
    });
    const connectionFields = {
      status: "ACTIVE" as const,
      accessToken: encryptedToken,
      tokenExpiresAt,
      webhookSubscribed,
      webhookFields: webhookSubscribed ? WEBHOOK_SUBSCRIBED_FIELDS : [],
      profilePictureUrl: userInfo.profile_picture_url ?? null,
      disconnectedAt: null,
      disconnectedBy: null,
      lastError: webhookSubscribed ? null : "Webhook subscription failed on connect",
      lastErrorAt: webhookSubscribed ? null : now,
    };
    await prisma.instagramAccount.upsert({
      where: { instagramId },
      create: {
        workspaceId: state.workspaceId,
        instagramId,
        username: userInfo.username,
        name: userInfo.name,
        ...connectionFields,
      },
      update: {
        workspaceId: state.workspaceId,
        username: userInfo.username,
        name: userInfo.name,
        ...connectionFields,
        reconnectedAt: now,
      },
    });
    clearAccountCache();

    if (previous) {
      await prisma.operationalEvent
        .create({
          data: {
            source: "SYSTEM",
            level: "INFO",
            workspaceId: state.workspaceId,
            message: `Instagram @${userInfo.username} reconnected`,
            payload: { instagramAccountId: previous.id, previousStatus: previous.status, webhookSubscribed },
          },
        })
        .catch(() => {});
    }

    return NextResponse.redirect(`${baseUrl}/channels?connected=true`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[Instagram Callback] Error:", err);
    // The message is the only diagnostic a self-hoster gets for a failed
    // connect, so persist it alongside the other operational events rather
    // than leaving it in server logs they may not be able to reach.
    await prisma.operationalEvent
      .create({
        data: {
          source: "SYSTEM",
          level: "ERROR",
          workspaceId: state.workspaceId,
          message: "Instagram connection failed",
          payload: { reason: message },
        },
      })
      .catch(() => {});

    return NextResponse.redirect(
      `${baseUrl}/channels?instagram=failed&reason=${encodeURIComponent(
        message.slice(0, 200)
      )}`
    );
  }
}
