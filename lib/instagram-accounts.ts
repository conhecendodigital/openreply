import { NextResponse } from "next/server";
import type { InstagramAccount } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { channelOffCode, channelOffMessage } from "@/lib/channels/status";

/**
 * An account already connected to another workspace blocks the connect, even
 * when it is DISCONNECTED or NEEDS_RECONNECT there: its data is kept, so it
 * still belongs to that workspace until someone deletes it for real.
 */
export async function canConnectInstagramAccount({
  workspaceId,
  instagramId,
}: {
  workspaceId: string;
  instagramId: string;
}) {
  const existingAccount = await prisma.instagramAccount.findUnique({
    where: { instagramId },
    select: { workspaceId: true },
  });

  if (existingAccount && existingAccount.workspaceId !== workspaceId) {
    return {
      allowed: false,
      reason: "already_connected" as const,
    };
  }

  return {
    allowed: true,
    reason: null,
  };
}

/**
 * One account of the workspace: the given id, or (without one) the latest
 * connected, preferring an ACTIVE one. Returns it whatever its status, so
 * local settings (moderation, links, contacts) keep working while the channel
 * is off. Anything that calls Meta uses requireActiveInstagramAccount.
 */
export async function getWorkspaceInstagramAccount(
  workspaceId: string,
  instagramAccountId?: string | null
) {
  if (instagramAccountId && instagramAccountId !== "all") {
    return prisma.instagramAccount.findFirst({
      where: { id: instagramAccountId, workspaceId },
    });
  }

  // Postgres orders an enum by its declared order: ACTIVE comes first.
  return prisma.instagramAccount.findFirst({
    where: { workspaceId },
    orderBy: [{ status: "asc" }, { connectedAt: "desc" }],
  });
}

export type ActiveAccountResult =
  | { ok: true; account: InstagramAccount }
  | { ok: false; response: NextResponse };

/**
 * Like getWorkspaceInstagramAccount, for routes that call Meta: a missing
 * account is a 404, a channel that is not ACTIVE a 409 with
 * code "channel_disconnected" | "needs_reconnect" (nothing is called).
 */
export async function requireActiveInstagramAccount(
  workspaceId: string,
  instagramAccountId?: string | null
): Promise<ActiveAccountResult> {
  const account = await getWorkspaceInstagramAccount(workspaceId, instagramAccountId);
  if (!account) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: "Instagram account not connected." },
        { status: 400 }
      ),
    };
  }
  if (account.status !== "ACTIVE" || !account.accessToken) {
    const code = channelOffCode(account.status === "ACTIVE" ? "NEEDS_RECONNECT" : account.status);
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: channelOffMessage(code), code },
        { status: 409 }
      ),
    };
  }
  return { ok: true, account };
}
