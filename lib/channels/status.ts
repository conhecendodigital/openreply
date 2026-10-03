/**
 * Channel (InstagramAccount) status. Only an ACTIVE account sends anything or
 * runs automations. NEEDS_RECONNECT (Meta rejected the token, code 190) and
 * DISCONNECTED (a person turned it off) keep every campaign, contact, message
 * and setting untouched: connecting the same account again turns it back on.
 */
import type { InstagramAccountStatus } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { clearAccountCache } from "@/lib/contacts/record";

/** Token refresh window and the "token expires soon" alert, in days. */
export const TOKEN_EXPIRY_WARNING_DAYS = 10;
/** No webhook for this long on an ACTIVE channel = "webhooks stalled" alert. */
export const WEBHOOK_STALE_HOURS = 24;

export type ChannelOffCode ="channel_disconnected" | "needs_reconnect";

export function channelOffCode(status: InstagramAccountStatus | null | undefined): ChannelOffCode {
  return status === "NEEDS_RECONNECT" ? "needs_reconnect" : "channel_disconnected";
}

export function channelOffMessage(code: ChannelOffCode): string {
  return code === "needs_reconnect"
    ? "Instagram needs to be reconnected. Reconnect it on the Channels page."
    : "This Instagram channel is disconnected. Reconnect it on the Channels page.";
}

/** Thrown when something tries to send through a channel that is not ACTIVE. */
export class ChannelOffError extends Error {
  readonly code: ChannelOffCode;
  constructor(code: ChannelOffCode) {
    super(channelOffMessage(code));
    this.name = "ChannelOffError";
    this.code = code;
  }
}

export function isChannelOffError(error: unknown): error is ChannelOffError {
  return error instanceof ChannelOffError;
}

/** Throws ChannelOffError unless the account (internal id) is ACTIVE. */
export async function assertAccountActive(instagramAccountId: string): Promise<void> {
  const account = await prisma.instagramAccount.findUnique({
    where: { id: instagramAccountId },
    select: { status: true },
  });
  if (!account) throw new ChannelOffError("channel_disconnected");
  if (account.status !== "ACTIVE") throw new ChannelOffError(channelOffCode(account.status));
}

export type AccountRef = { id: string } | { instagramId: string };

/**
 * Meta rejected the token: mark the account NEEDS_RECONNECT so nothing else
 * tries it and the Channels page shows "Needs reconnect". Only an ACTIVE
 * account moves (a DISCONNECTED one stays as the person left it). Never throws
 * and never deletes anything.
 */
export async function markNeedsReconnect(ref: AccountRef, message: string): Promise<boolean> {
  try {
    const now = new Date();
    const { count } = await prisma.instagramAccount.updateMany({
      where: { ...ref, status: "ACTIVE" },
      data: { status: "NEEDS_RECONNECT", lastError: message.slice(0, 500), lastErrorAt: now },
    });
    if (count > 0) {
      clearAccountCache();
      const account = await prisma.instagramAccount.findFirst({
        where: ref,
        select: { workspaceId: true, username: true },
      });
      await prisma.operationalEvent
        .create({
          data: {
            workspaceId: account?.workspaceId ?? null,
            source: "SYSTEM",
            level: "WARNING",
            message: `Instagram @${account?.username ?? "?"} needs to be reconnected (token rejected by Meta)`,
            payload: { ...ref, reason: message.slice(0, 500) },
          },
        })
        .catch(() => undefined);
    }
    return count > 0;
  } catch (error) {
    console.warn("[Channels] Could not mark needs-reconnect:", error instanceof Error ? error.message : error);
    return false;
  }
}

/**
 * Call from any catch around a Meta call made with an account's token: a
 * TokenExpiredError (code 190) flags the account. Returns true when it did.
 */
export async function noteMetaError(ref: AccountRef, error: unknown): Promise<boolean> {
  if (!isTokenRejected(error)) return false;
  await markNeedsReconnect(ref, (error as Error).message);
  return true;
}

/**
 * Meta's "invalid OAuth access token" (code 190, any subcode: expired,
 * password changed, app removed...). Checked by shape, not instanceof, so it
 * holds across module copies.
 */
export function isTokenRejected(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "TokenExpiredError") return true;
  return error.name === "MetaApiError" && (error as { code?: unknown }).code === 190;
}
