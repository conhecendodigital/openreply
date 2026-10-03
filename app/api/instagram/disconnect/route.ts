import { NextRequest, NextResponse } from "next/server";
import { getApiCaller } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { clearAccountCache } from "@/lib/contacts/record";
import { unsubscribeInstagramAccountFromWebhooks } from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";
import { countKeptChannelData } from "@/lib/channels/overview";
import {
  canManageWorkspace,
  getCurrentWorkspaceContext,
} from "@/lib/workspace-access";

/**
 * Disconnect = turn the channel OFF. Owner's rule (2026-10-03): disconnecting
 * never deletes anything. The account goes DISCONNECTED, its token is wiped
 * and Meta's webhooks are unsubscribed (best effort), so no automation runs
 * and nothing is sent. Campaigns, contacts, tags, events, conversations,
 * media, drafts, sequences, links, moderation, logs, clicks and follower
 * history all stay. Connecting the same account again (OAuth upsert by
 * instagramId) turns everything back on as it was.
 *
 * Deleting for real is a separate route (/api/instagram/purge).
 */
export async function POST(request: NextRequest) {
  // A key (MCP, scripts) can never switch a channel off.
  const caller = await getApiCaller();
  if (caller.kind === "token") {
    return NextResponse.json(
      {
        success: false,
        error: "API keys cannot disconnect a channel. Do it on the Channels page.",
        code: "human_only",
      },
      { status: 403 }
    );
  }

  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  if (!canManageWorkspace(context.role)) {
    return NextResponse.json(
      { success: false, error: "Only owners and admins can disconnect accounts" },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const instagramAccountId =
    typeof body?.instagramAccountId === "string" && body.instagramAccountId.trim()
      ? body.instagramAccountId.trim()
      : null;
  // Required: never "every account of the workspace".
  if (!instagramAccountId) {
    return NextResponse.json(
      { success: false, error: "instagramAccountId is required" },
      { status: 400 }
    );
  }

  const account = await prisma.instagramAccount.findFirst({
    where: { id: instagramAccountId, workspaceId: context.workspaceId },
    select: { id: true, instagramId: true, username: true, accessToken: true, status: true },
  });
  if (!account) {
    return NextResponse.json(
      { success: false, error: "Instagram account not found" },
      { status: 404 }
    );
  }

  // Stop Meta's webhooks BEFORE wiping the token (it needs it). A failure
  // never blocks the disconnect: the worker ignores a channel that is off.
  let webhookUnsubscribed = false;
  let unsubscribeError: string | null = null;
  if (account.accessToken) {
    try {
      const token = decryptToken(account.accessToken);
      const result = await unsubscribeInstagramAccountFromWebhooks(account.instagramId, token);
      webhookUnsubscribed = Boolean(result?.success);
      if (!webhookUnsubscribed) unsubscribeError = "Meta did not confirm the webhook unsubscribe";
    } catch (error) {
      unsubscribeError = error instanceof Error ? error.message : "Webhook unsubscribe failed";
    }
  } else {
    unsubscribeError = "No token to unsubscribe webhooks with";
  }

  const now = new Date();
  await prisma.instagramAccount.update({
    where: { id: account.id },
    data: {
      status: "DISCONNECTED",
      disconnectedAt: now,
      disconnectedBy: context.userId,
      accessToken: "",
      webhookSubscribed: false,
      ...(webhookUnsubscribed ? { webhookFields: [] } : {}),
      lastError: unsubscribeError ? `Disconnect: ${unsubscribeError}`.slice(0, 500) : null,
      lastErrorAt: unsubscribeError ? now : null,
    },
  });
  clearAccountCache();

  await prisma.operationalEvent
    .create({
      data: {
        workspaceId: context.workspaceId,
        source: "SYSTEM",
        level: "INFO",
        message: `Instagram @${account.username} disconnected (nothing deleted)`,
        payload: {
          instagramAccountId: account.id,
          by: context.userId,
          previousStatus: account.status,
          webhookUnsubscribed,
          unsubscribeError,
        },
      },
    })
    .catch(() => undefined);

  const kept = await countKeptChannelData(account.id, account.instagramId).catch(() => null);

  return NextResponse.json({
    success: true,
    data: {
      id: account.id,
      username: account.username,
      status: "DISCONNECTED",
      webhookUnsubscribed,
      unsubscribeError,
      // Everything below is kept; reconnecting the same account turns it on.
      kept,
    },
  });
}
