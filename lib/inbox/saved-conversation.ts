/**
 * Pure helpers (safe for the browser) for conversations that Instagram does
 * not list among the recent ones. No database, no Meta.
 */
export const SAVED_PREFIX = "saved:";

export const savedConversationId = (igUserId: string) => `${SAVED_PREFIX}${igUserId}`;
export const isSavedConversationId = (id: string | null | undefined): boolean =>
  Boolean(id && id.startsWith(SAVED_PREFIX));

export function profileUrlFor(username: string | null | undefined): string | null {
  const u = (username ?? "").replace(/^@/, "").trim();
  return /^[A-Za-z0-9._]+$/.test(u) ? `https://www.instagram.com/${u}/` : null;
}

/** Puts the resolved conversation in the list (first) without duplicating the person. */
export function mergeResolved<T extends { id: string; contact: { id: string } }>(
  list: T[],
  resolved: T | null
): T[] {
  if (!resolved) return list;
  if (list.some((c) => c.id === resolved.id || (c.contact.id && c.contact.id === resolved.contact.id))) {
    return list;
  }
  return [resolved, ...list];
}

/**
 * A saved-only thread is read-only unless the 24 h window is known to be open
 * (we do not guess: no CRM record / no window = closed). Nothing is sent on
 * its own; this only decides whether the composer is enabled.
 */
export function canReplyToSavedOnly(window: { open: boolean } | null | undefined): boolean {
  return window?.open === true;
}
