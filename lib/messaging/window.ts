/**
 * Instagram's standard messaging window: 24 h after the person's last message
 * (or button tap, or ig.me link into the thread). Inside it we may send
 * anything, promotional included; outside it nothing goes out (we do not use
 * message tags). A safety margin keeps us clear of the edge, where a send that
 * took a few seconds would bounce with error 1545041.
 */
export const WINDOW_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_WINDOW_MARGIN_MIN = 30;

export type WindowContact = { lastInboundAt: Date | string | null | undefined };

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** When the window closes (exact, no margin), or null when it never opened. */
export function windowClosesAt(contact: WindowContact | null | undefined): Date | null {
  const last = toDate(contact?.lastInboundAt);
  return last ? new Date(last.getTime() + WINDOW_MS) : null;
}

/** Milliseconds left before the margin, never negative. 0 = closed. */
export function windowRemainingMs(
  contact: WindowContact | null | undefined,
  now: Date = new Date(),
  marginMin = DEFAULT_WINDOW_MARGIN_MIN
): number {
  const closes = windowClosesAt(contact);
  if (!closes) return 0;
  return Math.max(0, closes.getTime() - marginMin * 60_000 - now.getTime());
}

export function isWindowOpen(
  contact: WindowContact | null | undefined,
  now: Date = new Date(),
  marginMin = DEFAULT_WINDOW_MARGIN_MIN
): boolean {
  return windowRemainingMs(contact, now, marginMin) > 0;
}

/** Latest of two optional instants (e.g. stored lastInboundAt vs the DM being handled). */
export function latest(
  a: Date | string | null | undefined,
  b: Date | string | null | undefined
): Date | null {
  const da = toDate(a);
  const db = toDate(b);
  if (!da) return db;
  if (!db) return da;
  return da > db ? da : db;
}

/**
 * Meta errors that mean "the window is closed" (or the person can no longer be
 * reached): 1545041 "Messaging window closed", 10 / 551 permission-style
 * refusals for this user, and the plain-text variant the API sometimes uses.
 */
export function isWindowClosedError(error: unknown): boolean {
  const e = error as { code?: number; subcode?: number; message?: string } | null;
  if (!e) return false;
  if (e.subcode === 1545041 || e.code === 1545041 || e.code === 551) return true;
  const message = e.message ?? "";
  if (/1545041|outside of allowed window|messaging window|window closed/i.test(message)) return true;
  // Code 10 is "permission denied"; for a send it is the closed-window answer.
  return e.code === 10 && /message|window|send/i.test(message);
}
