/**
 * Auth for the cron routes (app/api/cron/*) and the detailed /api/health.
 *
 * The secret is CRON_SECRET, falling back to NEXTAUTH_SECRET as before so the
 * running crons keep working (dropping the fallback is an owner decision: set
 * CRON_SECRET in the server first). Fails CLOSED when neither is set (before,
 * three routes compared against "Bearer undefined"), and compares in
 * constant time.
 */
import { timingSafeEqual } from "node:crypto";

export function cronSecret(): string | null {
  const secret = process.env.CRON_SECRET || process.env.NEXTAUTH_SECRET;
  return secret && secret.trim() ? secret : null;
}

export function isCronAuthorized(authorization: string | null | undefined): boolean {
  const secret = cronSecret();
  if (!secret || !authorization) return false;
  const given = Buffer.from(authorization);
  const wanted = Buffer.from(`Bearer ${secret}`);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}
