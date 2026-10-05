/**
 * Etapa 6: who opened a quiz link that went out by Direct (server-only).
 * /q/<slug>?c=<igsid>.<sig>, signed with the same HMAC as the tracked links
 * (lib/tracking/recipient.ts) over "q:" + slug, so it cannot be edited to
 * credit someone else. Without it the visitor stays anonymous.
 */
import { prisma } from "@/lib/db/client";
import { getBaseUrl } from "@/lib/env";
import { recipientToken, verifyRecipientToken } from "@/lib/tracking/recipient";
import type { ContactRef } from "@/lib/contacts/record";

const scope = (slug: string) => `q:${slug}`;

export function funnelContactToken(slug: string, igUserId: string): string {
  return recipientToken(scope(slug), igUserId);
}

/** IGSID from the token, or null when missing or tampered with. */
export function verifyFunnelContactToken(slug: string, token: string | null | undefined): string | null {
  return verifyRecipientToken(scope(slug), token);
}

/**
 * A tracked link (/r/<slug>) whose destination is a quiz of THIS site
 * (/q/<slugFunil>) gets c=<token> for the person who clicked, so the quiz
 * knows who answered and the option tags land on the contact. Anything else
 * (other site, no contact) comes back unchanged.
 */
export function withFunnelContact(destination: string, igUserId: string | null | undefined): string {
  if (!igUserId) return destination;
  try {
    const url = new URL(destination);
    const base = new URL(getBaseUrl());
    if (url.host !== base.host) return destination;
    const m = /^\/q\/([a-z0-9-]{3,60})\/?$/.exec(url.pathname);
    if (!m) return destination;
    url.searchParams.set("c", funnelContactToken(m[1], igUserId));
    return url.toString();
  } catch {
    return destination;
  }
}

/** The CRM contact behind a valid token, in this workspace. */
export async function contactFromToken(
  workspaceId: string,
  slug: string,
  token: string | null | undefined
): Promise<ContactRef | null> {
  const igUserId = verifyFunnelContactToken(slug, token);
  if (!igUserId) return null;
  const contact = await prisma.contact.findFirst({
    where: { workspaceId, igUserId },
    select: { id: true, workspaceId: true },
  });
  return contact ?? null;
}
