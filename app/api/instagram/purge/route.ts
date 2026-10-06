import { NextRequest, NextResponse } from "next/server";
import { getApiCaller } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { clearAccountCache } from "@/lib/contacts/record";
import { countKeptChannelData } from "@/lib/channels/overview";
import { purgeInstagramAccountData } from "@/lib/channels/purge";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";

/**
 * Delete a channel FOR REAL, with everything it holds: campaigns, contacts,
 * conversations and media, drafts, sequences, links, moderation, logs, clicks
 * and follower history. Cannot be undone.
 *
 * Guard rails (owner's rule, 2026-10-03):
 *  - signed-in human only (never an API key / MCP);
 *  - workspace OWNER only;
 *  - the channel must already be DISCONNECTED (disconnect first);
 *  - the body must carry the account's @ typed by hand (confirmUsername).
 */
export async function POST(request: NextRequest) {
  const caller = await getApiCaller();
  if (caller.kind !== "session") {
    return NextResponse.json(
      { success: false, error: "Only a signed-in person can delete a channel.", code: "human_only" },
      { status: 403 }
    );
  }

  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  if (context.role !== "OWNER") {
    return NextResponse.json(
      { success: false, error: "Only the workspace owner can delete a channel for real." },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const instagramAccountId =
    typeof body?.instagramAccountId === "string" ? body.instagramAccountId.trim() : "";
  const typed = typeof body?.confirmUsername === "string" ? body.confirmUsername.trim() : "";
  if (!instagramAccountId || !typed) {
    return NextResponse.json(
      { success: false, error: "instagramAccountId and confirmUsername are required" },
      { status: 400 }
    );
  }

  const account = await prisma.instagramAccount.findFirst({
    where: { id: instagramAccountId, workspaceId: context.workspaceId },
    select: { id: true, instagramId: true, username: true, status: true },
  });
  if (!account) {
    return NextResponse.json({ success: false, error: "Instagram account not found" }, { status: 404 });
  }

  const normalize = (value: string) => value.replace(/^@+/, "").trim().toLowerCase();
  if (normalize(typed) !== normalize(account.username)) {
    return NextResponse.json(
      {
        success: false,
        error: `Type @${account.username} exactly to confirm. Nothing was deleted.`,
        code: "confirmation_mismatch",
      },
      { status: 400 }
    );
  }

  if (account.status !== "DISCONNECTED") {
    return NextResponse.json(
      {
        success: false,
        error: "Disconnect the channel first. Disconnecting keeps everything; deleting is a separate step.",
        code: "not_disconnected",
      },
      { status: 409 }
    );
  }

  const deleted = await countKeptChannelData(account.id, account.instagramId).catch(() => null);

  // Explicit order inside one transaction: everything or nothing (shared with
  // Meta's data deletion callback, lib/channels/purge.ts).
  const raw = await purgeInstagramAccountData(account);
  clearAccountCache();

  await prisma.operationalEvent
    .create({
      data: {
        workspaceId: context.workspaceId,
        source: "SYSTEM",
        level: "WARNING",
        message: `Instagram @${account.username} deleted for real by the owner`,
        payload: { instagramAccountId: account.id, instagramId: account.instagramId, by: context.userId, deleted, raw },
      },
    })
    .catch(() => undefined);

  return NextResponse.json({ success: true, data: { id: account.id, username: account.username, deleted } });
}
