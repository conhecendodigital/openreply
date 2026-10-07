/**
 * Short code of who received a tracked link (07/10/2026):
 * /r/<slug>/<code> instead of /r/<slug>?c=<igsid>.<signature>.
 *
 * The code is random (7 letters and numbers, ~3.5 trillion per link) and only
 * means something together with the slug. One per person and link: the same
 * person gets the same code when the link goes again, and dmLogId keeps the
 * latest DM. Table TrackedLinkRecipient, RLS forced: only the system role
 * (le_system) writes, so everything here runs in withSystemRole.
 *
 * Server-only.
 */
import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@/app/generated/prisma/client";
import { getPrisma } from "@/lib/db/client";
import { withSystemRole } from "@/lib/db/rls";

export const CODE_RE = /^[A-Za-z0-9]{6,8}$/;
export const CODE_LENGTH = 7;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** 7 random letters and numbers (no modulo bias). */
export function generateRecipientCode(length = CODE_LENGTH): string {
  let out = "";
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte >= 248) continue; // 248 = 62 * 4
      out += ALPHABET[byte % 62];
      if (out.length === length) break;
    }
  }
  return out;
}

export type RecipientInput = {
  workspaceId: string;
  slug: string;
  igUserId: string;
  /** DmLog that is delivering the link, when the caller knows it. */
  dmLogId?: string | null;
};

/**
 * The person's code for this link, creating it the first time. Throws when
 * the database refuses (the caller falls back to the old ?c= link).
 */
export async function ensureRecipientCode(input: RecipientInput, base?: PrismaClient): Promise<string> {
  const { workspaceId, slug, igUserId } = input;
  const dmLogId = input.dmLogId ?? null;
  if (!workspaceId || !slug || !igUserId || igUserId.length > 64) throw new Error("invalid recipient");
  return withSystemRole(async (tx) => {
    const key = { slug_igUserId: { slug, igUserId } };
    const existing = await tx.trackedLinkRecipient.findUnique({ where: key, select: { id: true, code: true, dmLogId: true } });
    if (existing) {
      if (dmLogId && existing.dmLogId !== dmLogId) {
        await tx.trackedLinkRecipient.update({ where: { id: existing.id }, data: { dmLogId } });
      }
      return existing.code;
    }
    // ON CONFLICT DO NOTHING: a failed INSERT would abort the transaction.
    for (let attempt = 0; attempt < 5; attempt++) {
      await tx.trackedLinkRecipient.createMany({
        data: [{ workspaceId, slug, igUserId, dmLogId, code: generateRecipientCode() }],
        skipDuplicates: true,
      });
      // Ours, or the one a parallel job saved first. Nothing = the random
      // code was taken for this slug: try another.
      const row = await tx.trackedLinkRecipient.findUnique({ where: key, select: { code: true } });
      if (row) return row.code;
    }
    throw new Error("Could not create a link code");
  }, base ?? getPrisma());
}

export type ResolvedRecipient = { workspaceId: string; igUserId: string; dmLogId: string | null };

/** Who got /r/<slug>/<code>, or null (unknown code, bad format, database down). */
export async function resolveRecipientCode(slug: string, code: string, base?: PrismaClient): Promise<ResolvedRecipient | null> {
  if (!CODE_RE.test(code) || !slug || slug.length > 80) return null;
  try {
    const row = await withSystemRole(
      (tx) =>
        tx.trackedLinkRecipient.findUnique({
          where: { slug_code: { slug, code } },
          select: { workspaceId: true, igUserId: true, dmLogId: true },
        }),
      base ?? getPrisma()
    );
    return row ?? null;
  } catch {
    return null;
  }
}
