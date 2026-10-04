/**
 * Etapa 5: remember Meta's answer to "does this person follow us?" whenever a
 * follow gate already asked it (is_user_follow_business), so segments can
 * filter on it. Never asks Meta by itself, never blocks and never throws: the
 * caller does not even await it.
 */
import { prisma } from "@/lib/db/client";

export function noteFollowStatus(
  instagramAccountId: string,
  igUserId: string,
  follows: boolean | null | undefined,
  at: Date = new Date()
): void {
  if (typeof follows !== "boolean" || !instagramAccountId || !igUserId) return;
  void Promise.resolve()
    .then(() =>
      prisma.contact.updateMany({
        where: { instagramAccountId, igUserId },
        data: { followsBusiness: follows, followsCheckedAt: at },
      })
    )
    .catch(() => undefined);
}
