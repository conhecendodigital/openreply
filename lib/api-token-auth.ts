import { prisma } from "@/lib/db/client";
import {
  bearerMatches,
  extractBearer,
  hashApiToken,
  MIN_API_TOKEN_LENGTH,
} from "@/lib/api-token";

/**
 * User a bearer-authenticated request acts as, or null when the header holds
 * no valid key. Accepts the deploy-level OPENREPLY_API_TOKEN (acts as
 * OPENREPLY_API_USER_EMAIL or the oldest workspace owner) and any unrevoked
 * key created in Settings (acts as that workspace's owner).
 */
export async function resolveApiTokenUserId(
  authorization: string | null | undefined
): Promise<string | null> {
  const token = extractBearer(authorization);
  if (!token || token.length < MIN_API_TOKEN_LENGTH) return null;

  if (bearerMatches(authorization, process.env.OPENREPLY_API_TOKEN)) {
    const email = process.env.OPENREPLY_API_USER_EMAIL;
    if (email) {
      const user = await prisma.user.findUnique({
        where: { email },
        select: { id: true },
      });
      return user?.id ?? null;
    }
    const owner = await prisma.workspaceMember.findFirst({
      where: { role: "OWNER" },
      orderBy: { createdAt: "asc" },
      select: { userId: true },
    });
    return owner?.userId ?? null;
  }

  const stored = await prisma.apiToken.findUnique({
    where: { tokenHash: hashApiToken(token) },
    select: {
      id: true,
      revokedAt: true,
      lastUsedAt: true,
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
  return stored.workspace.ownerId;
}
