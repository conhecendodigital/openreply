import { timingSafeEqual } from "node:crypto";

// Short tokens are refused outright so a placeholder like "changeme" can never
// unlock the API.
export const MIN_API_TOKEN_LENGTH = 32;

/**
 * True when an `Authorization: Bearer <token>` header carries the configured
 * API token. Unset or too-short tokens disable token access entirely.
 */
export function bearerMatches(
  authorization: string | null | undefined,
  expected: string | null | undefined
): boolean {
  if (!expected || expected.length < MIN_API_TOKEN_LENGTH || !authorization) {
    return false;
  }

  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  if (!match) return false;

  const given = Buffer.from(match[1]);
  const wanted = Buffer.from(expected);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}
