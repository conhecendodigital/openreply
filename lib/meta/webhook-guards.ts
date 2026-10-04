/**
 * Cheap guards in front of the Meta webhook (app/api/webhook/route.ts).
 * Kept out of the route file because a route may only export handlers.
 */
import { timingSafeEqual } from "node:crypto";

// Meta's webhook payloads are a few KB; anything this big is not from Meta.
// Generous on purpose so a large legit batch is never refused.
export const MAX_WEBHOOK_BODY_BYTES = 5 * 1024 * 1024;

// A bad-signature flood must not write one row per request.
const SIGNATURE_FAILURE_EVENT_EVERY_MS = 60_000;
let lastSignatureFailureEventAt = 0;

/** True at most once a minute per process: record this bad-signature hit. */
export function shouldRecordSignatureFailure(now = Date.now()): boolean {
  if (now - lastSignatureFailureEventAt < SIGNATURE_FAILURE_EVENT_EVERY_MS) return false;
  lastSignatureFailureEventAt = now;
  return true;
}

/** Test hook: forget when the last bad-signature event was recorded. */
export function resetSignatureFailureThrottle() {
  lastSignatureFailureEventAt = 0;
}

/** Constant-time check of hub.verify_token. A missing token never matches. */
export function verifyTokenMatches(received: string | null, expected: string | undefined): boolean {
  if (!received || !expected) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
