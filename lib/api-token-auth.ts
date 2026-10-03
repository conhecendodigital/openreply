import { prisma } from "@/lib/db/client";
import {
  bearerMatches,
  extractBearer,
  hashApiToken,
  MIN_API_TOKEN_LENGTH,
} from "@/lib/api-token";

/**
 * Rights an API key can carry beyond reading and proposing. Read, propose a
 * draft, tag, etc. need no scope (same as before). Approving a draft does:
 * the key the AI uses to propose must not also be able to approve.
 */
export const API_TOKEN_SCOPES = ["drafts:approve"] as const;
export type ApiTokenScope = (typeof API_TOKEN_SCOPES)[number];

export type ResolvedApiToken = {
  userId: string;
  /** ApiToken.id, or "env" for the deploy-level OPENREPLY_API_TOKEN. */
  tokenId: string;
  scopes: string[];
};

/** Scopes of the deploy-level key: OPENREPLY_API_TOKEN_SCOPES, comma separated. */
function envTokenScopes(): string[] {
  return (process.env.OPENREPLY_API_TOKEN_SCOPES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is ApiTokenScope => (API_TOKEN_SCOPES as readonly string[]).includes(s));
}

/**
 * The key behind an `Authorization: Bearer <key>` header, or null when the
 * header holds no valid key. Accepts the deploy-level OPENREPLY_API_TOKEN (acts
 * as OPENREPLY_API_USER_EMAIL or the oldest workspace owner) and any unrevoked
 * key created in Settings (acts as that workspace's owner).
 */
export async function resolveApiToken(
  authorization: string | null | undefined
): Promise<ResolvedApiToken | null> {
  const token = extractBearer(authorization);
  if (!token || token.length < MIN_API_TOKEN_LENGTH) return null;

  if (bearerMatches(authorization, process.env.OPENREPLY_API_TOKEN)) {
    const email = process.env.OPENREPLY_API_USER_EMAIL;
    let userId: string | null = null;
    if (email) {
      const user = await prisma.user.findUnique({
        where: { email },
        select: { id: true },
      });
      userId = user?.id ?? null;
    } else {
      const owner = await prisma.workspaceMember.findFirst({
        where: { role: "OWNER" },
        orderBy: { createdAt: "asc" },
        select: { userId: true },
      });
      userId = owner?.userId ?? null;
    }
    return userId ? { userId, tokenId: "env", scopes: envTokenScopes() } : null;
  }

  const stored = await prisma.apiToken.findUnique({
    where: { tokenHash: hashApiToken(token) },
    select: {
      id: true,
      revokedAt: true,
      lastUsedAt: true,
      scopes: true,
      workspace: { select: { ownerId: true } },
    },
  });
  if (!stored || stored.revokedAt) return null;

  // Coarse last-used stamp: at most one write per key per minute.
  if (!stored.lastUsedAt || Date.now() - stored.lastUsedAt.getTime() > 60_000) {
    await prisma.apiToken
      .update({ where: { id: stored.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);
  }
  return { userId: stored.workspace.ownerId, tokenId: stored.id, scopes: stored.scopes ?? [] };
}

/** User a bearer-authenticated request acts as (see resolveApiToken). */
export async function resolveApiTokenUserId(
  authorization: string | null | undefined
): Promise<string | null> {
  return (await resolveApiToken(authorization))?.userId ?? null;
}
