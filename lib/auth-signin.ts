/**
 * NextAuth signIn callback, kept apart from lib/auth.ts so it can be tested.
 *
 * Runs before the magic link is sent (email.verificationRequest = true), so
 * a blocked address never receives one, and again when the link is verified.
 */
import { isEmailAllowedToSignIn } from "@/lib/env";
import { hitRateLimit, MAGIC_LINK_LIMIT } from "@/lib/http-rate-limit";

/**
 * Owner's rule (2026-10-04): with ALLOWED_EMAILS set, someone the owner invited
 * still gets in. An open invitation (PENDING, not expired), or an accepted one
 * whose team the person is still on, counts as allowed. Anyone else stays out.
 */
export async function hasWorkspaceAccess(email: string): Promise<boolean> {
  const { prisma } = await import("@/lib/db/client");
  const address = email.trim();
  const invite = await prisma.workspaceInvitation.findFirst({
    where: {
      email: { equals: address, mode: "insensitive" },
      status: "PENDING",
      expiresAt: { gt: new Date() },
    },
    select: { id: true },
  });
  if (invite) return true;
  // Accepted an invitation and is still on THAT team. A plain membership is
  // not enough: while ALLOWED_EMAILS was empty anyone could sign up and own a
  // workspace of their own.
  const accepted = await prisma.workspaceInvitation.findMany({
    where: { email: { equals: address, mode: "insensitive" }, status: "ACCEPTED" },
    select: { workspaceId: true },
    take: 20,
  });
  if (accepted.length === 0) return false;
  const member = await prisma.workspaceMember.findFirst({
    where: {
      workspaceId: { in: accepted.map((a) => a.workspaceId) },
      user: { email: { equals: address, mode: "insensitive" } },
    },
    select: { id: true },
  });
  return Boolean(member);
}

export async function allowSignIn(
  params: {
    user?: { email?: string | null } | null;
    email?: { verificationRequest?: boolean } | null;
  },
  accessLookup: (email: string) => Promise<boolean> = hasWorkspaceAccess
): Promise<boolean> {
  const address = params.user?.email;
  if (!isEmailAllowedToSignIn(address)) {
    if (!address) return false;
    // Not on the list: let in only who was invited or already is on a team.
    // A database hiccup fails closed (no link is sent).
    const invited = await accessLookup(address).catch(() => false);
    if (!invited) return false;
  }
  // At most a few magic links per address per hour: stops e-mail bombing
  // and protects the Resend quota. Verifying a link is never limited.
  if (params.email?.verificationRequest && address) {
    const check = await hitRateLimit(
      "magic-link",
      address,
      MAGIC_LINK_LIMIT.limit,
      MAGIC_LINK_LIMIT.windowSeconds
    );
    if (!check.allowed) return false;
  }
  return true;
}
