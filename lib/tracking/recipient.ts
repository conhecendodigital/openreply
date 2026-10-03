import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Who received a tracked link. The DM button URL carries `?c=<igsid>.<sig>`,
 * so a click on /r/<slug> can be credited to the person (Contact) instead of
 * only to the campaign. The signature is an HMAC over slug + IGSID: a URL
 * cannot be edited to credit someone else, and a link forwarded to a friend
 * still credits the original recipient (acceptable).
 *
 * Server-only (node:crypto). The shared builders in lib/tracking/message.ts
 * stay browser-safe and only receive the finished query string.
 */
export const RECIPIENT_PARAM = "c";
const SIG_LENGTH = 12;

function secret(): string {
  return process.env.NEXTAUTH_SECRET ?? "lead-engine-recipient-salt";
}

function sign(slug: string, igUserId: string): string {
  return createHmac("sha256", secret())
    .update(`${slug}:${igUserId}`)
    .digest("base64url")
    .slice(0, SIG_LENGTH);
}

export function recipientToken(slug: string, igUserId: string): string {
  return `${igUserId}.${sign(slug, igUserId)}`;
}

/** Query string (without "?") to append to a tracked URL for this recipient. */
export function recipientQuery(slug: string, igUserId: string | null | undefined): string {
  if (!igUserId) return "";
  return `${RECIPIENT_PARAM}=${encodeURIComponent(recipientToken(slug, igUserId))}`;
}

/** IGSID from a `c` param, or null when it is missing or tampered with. */
export function verifyRecipientToken(
  slug: string,
  token: string | null | undefined
): string | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const igUserId = token.slice(0, dot);
  const given = token.slice(dot + 1);
  if (!/^[0-9A-Za-z_-]{1,64}$/.test(igUserId)) return null;
  const expected = sign(slug, igUserId);
  if (given.length !== expected.length) return null;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected)) ? igUserId : null;
}
