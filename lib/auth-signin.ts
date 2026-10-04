/**
 * NextAuth signIn callback, kept apart from lib/auth.ts so it can be tested.
 *
 * Runs before the magic link is sent (email.verificationRequest = true), so
 * a blocked address never receives one, and again when the link is verified.
 */
import { isEmailAllowedToSignIn } from "@/lib/env";
import { hitRateLimit, MAGIC_LINK_LIMIT } from "@/lib/http-rate-limit";

export async function allowSignIn(params: {
  user?: { email?: string | null } | null;
  email?: { verificationRequest?: boolean } | null;
}): Promise<boolean> {
  const address = params.user?.email;
  if (!isEmailAllowedToSignIn(address)) return false;
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
