import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// Short tokens are refused outright so a placeholder like "changeme" can never
// unlock the API.
export const MIN_API_TOKEN_LENGTH = 32;

// Keys created in Settings start with this, so they are easy to spot in configs.
export const API_TOKEN_PREFIX = "or_";

/** The token from an `Authorization: Bearer <token>` header, or null. */
export function extractBearer(authorization: string | null | undefined): string | null {
  if (!authorization) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  return match ? match[1] : null;
}

/**
 * True when an `Authorization: Bearer <token>` header carries the configured
 * API token. Unset or too-short tokens disable token access entirely.
 */
export function bearerMatches(
  authorization: string | null | undefined,
  expected: string | null | undefined
): boolean {
  if (!expected || expected.length < MIN_API_TOKEN_LENGTH) return false;

  const token = extractBearer(authorization);
  if (!token) return false;

  const given = Buffer.from(token);
  const wanted = Buffer.from(expected);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

export function hashApiToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** A new workspace API key and the parts that get stored. */
export function generateApiToken(): { token: string; tokenHash: string; prefix: string } {
  const token = `${API_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  return {
    token,
    tokenHash: hashApiToken(token),
    prefix: token.slice(0, API_TOKEN_PREFIX.length + 6),
  };
}
