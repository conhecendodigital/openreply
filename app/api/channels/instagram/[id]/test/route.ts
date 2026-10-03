import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { clearAccountCache } from "@/lib/contacts/record";
import { channelOffCode, channelOffMessage, markNeedsReconnect } from "@/lib/channels/status";
import {
  getSubscribedWebhookFields,
  getUserInfo,
  MetaApiError,
  TokenExpiredError,
} from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

/**
 * "Test connection": GET /me with the stored token (and the subscribed
 * webhook fields). OK -> profile photo / username refreshed, error cleared and
 * a NEEDS_RECONNECT channel whose token works again goes back to ACTIVE.
 * Token rejected (190) -> NEEDS_RECONNECT. A DISCONNECTED channel is not
 * tested (it has no token; reconnect it). Nothing is ever deleted.
 */
export async function POST(_request: NextRequest, { params }: RouteProps) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const account = await prisma.instagramAccount.findFirst({
    where: { id, workspaceId: context.workspaceId },
    select: { id: true, instagramId: true, username: true, accessToken: true, status: true },
  });
  if (!account) {
    return NextResponse.json({ success: false, error: "Instagram account not found" }, { status: 404 });
  }

  const checkedAt = new Date();
  if (account.status === "DISCONNECTED" || !account.accessToken) {
    const code = channelOffCode(account.status === "ACTIVE" ? "NEEDS_RECONNECT" : account.status);
    if (account.status === "ACTIVE") {
      await markNeedsReconnect({ id: account.id }, "No access token stored");
    }
    return NextResponse.json({
      success: true,
      data: {
        ok: false,
        status: account.status === "ACTIVE" ? "NEEDS_RECONNECT" : account.status,
        code,
        error: channelOffMessage(code),
        checkedAt: checkedAt.toISOString(),
      },
    });
  }

  let token: string;
  try {
    token = decryptToken(account.accessToken);
  } catch {
    await markNeedsReconnect({ id: account.id }, "Stored token could not be decrypted");
    return NextResponse.json({
      success: true,
      data: {
        ok: false,
        status: "NEEDS_RECONNECT",
        code: "needs_reconnect",
        error: "Stored token could not be decrypted. Reconnect the account.",
        checkedAt: checkedAt.toISOString(),
      },
    });
  }

  try {
    const info = await getUserInfo(token);
    const metaId = info.user_id ?? info.id;
    if (metaId && metaId !== account.instagramId && info.id !== account.instagramId) {
      const error = `The token belongs to another account (@${info.username})`;
      await prisma.instagramAccount.update({
        where: { id: account.id },
        data: { lastError: error, lastErrorAt: checkedAt },
      });
      return NextResponse.json({
        success: true,
        data: { ok: false, status: account.status, code: "account_mismatch", error, checkedAt: checkedAt.toISOString() },
      });
    }

    // The subscribed fields are informative: their failure is not a failed test.
    let webhookFields: string[] | null = null;
    let webhookError: string | null = null;
    try {
      webhookFields = await getSubscribedWebhookFields(account.instagramId, token);
    } catch (error) {
      webhookError = error instanceof Error ? error.message : "Could not read webhook subscription";
    }

    // A false alarm (or a token Meta accepts again): back on. Conditional, so
    // a channel disconnected while this test ran is never switched back on.
    if (account.status === "NEEDS_RECONNECT") {
      await prisma.instagramAccount.updateMany({
        where: { id: account.id, status: "NEEDS_RECONNECT", accessToken: account.accessToken },
        data: { status: "ACTIVE" },
      });
    }
    const updated = await prisma.instagramAccount.update({
      where: { id: account.id },
      data: {
        username: info.username || account.username,
        ...(info.name !== undefined ? { name: info.name } : {}),
        ...(info.profile_picture_url ? { profilePictureUrl: info.profile_picture_url } : {}),
        ...(webhookFields
          ? {
              webhookFields,
              webhookSubscribed: webhookFields.includes("comments") && webhookFields.includes("messages"),
            }
          : {}),
        lastError: null,
        lastErrorAt: null,
      },
      select: { status: true, webhookSubscribed: true, webhookFields: true, profilePictureUrl: true, username: true },
    });
    if (account.status !== updated.status) clearAccountCache();

    return NextResponse.json({
      success: true,
      data: {
        ok: true,
        status: updated.status,
        username: updated.username,
        followers: info.followers_count ?? null,
        profilePictureUrl: updated.profilePictureUrl,
        webhookSubscribed: updated.webhookSubscribed,
        webhookFields: updated.webhookFields,
        webhookError,
        checkedAt: checkedAt.toISOString(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Connection test failed";
    if (error instanceof TokenExpiredError) {
      await markNeedsReconnect({ id: account.id }, message);
      // Already NEEDS_RECONNECT: keep the latest reason.
      await prisma.instagramAccount
        .updateMany({
          where: { id: account.id, status: "NEEDS_RECONNECT" },
          data: { lastError: message.slice(0, 500), lastErrorAt: checkedAt },
        })
        .catch(() => undefined);
      return NextResponse.json({
        success: true,
        data: {
          ok: false,
          status: "NEEDS_RECONNECT",
          code: "needs_reconnect",
          error: message,
          checkedAt: checkedAt.toISOString(),
        },
      });
    }
    await prisma.instagramAccount
      .update({ where: { id: account.id }, data: { lastError: message.slice(0, 500), lastErrorAt: checkedAt } })
      .catch(() => undefined);
    return NextResponse.json({
      success: true,
      data: {
        ok: false,
        status: account.status,
        code: error instanceof MetaApiError ? `meta_${error.code}` : "error",
        error: message,
        checkedAt: checkedAt.toISOString(),
      },
    });
  }
}
