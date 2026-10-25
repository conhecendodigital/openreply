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
 * The same preference as pickDefaultInstagramAccount, as a database order:
 * "INSTAGRAM" sorts after "FACEBOOK", so platform desc puts Instagram first;
 * Postgres orders the status enum by its declared order (ACTIVE first).
 */
export const DEFAULT_ACCOUNT_ORDER = [
  { platform: "desc" as const },
  { status: "asc" as const },
  { connectedAt: "desc" as const },
];

type DefaultCandidate = { platform?: string | null; status: string };

/**
 * 25/10/2026: the default account of the workspace. Since 23/10 the table also
 * holds Facebook Pages (platform FACEBOOK), so "the latest connected" picked
 * the Page as soon as one was connected after the Instagram. Order of
 * preference: Instagram ACTIVE, then any Instagram, then an ACTIVE Page, then
 * anything. `accounts` must already be ordered by connectedAt desc.
 */
export function pickDefaultInstagramAccount<T extends DefaultCandidate>(accounts: readonly T[]): T | null {
  const isInstagram = (a: T) => (a.platform ?? "INSTAGRAM") !== "FACEBOOK";
  return (
    accounts.find((a) => isInstagram(a) && a.status === "ACTIVE") ??
    accounts.find(isInstagram) ??
    accounts.find((a) => a.status === "ACTIVE") ??
    accounts[0] ??
    null
  );
}

/**
 * One account of the workspace: the given id, or (without one) the default
 * from pickDefaultInstagramAccount. Returns it whatever its status, so local
 * settings (moderation, links, contacts) keep working while the channel is
 * off. Anything that calls Meta uses requireActiveInstagramAccount.
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

  return prisma.instagramAccount.findFirst({
    where: { workspaceId },
    orderBy: DEFAULT_ACCOUNT_ORDER,
  });
}

/** Posts, overview, profile and stories read the Instagram Graph API only. */
export const FACEBOOK_PAGE_NOT_INSTAGRAM =
  "Essa conta é uma Página do Facebook, não um Instagram. Escolha a conta do Instagram (listar_contas_instagram mostra as duas).";

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
  instagramAccountId?: string | null,
  options: { instagramOnly?: boolean } = {}
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
  if (options.instagramOnly && account.platform === "FACEBOOK") {
    return {
      ok: false,
      response: NextResponse.json(
        {
          success: false,
          error: FACEBOOK_PAGE_NOT_INSTAGRAM,
          code: "facebook_page",
        },
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
