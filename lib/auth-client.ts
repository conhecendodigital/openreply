"use client";

/**
 * Fase 0: cliente do login novo no navegador (fala com /api/auth/*).
 */
import { createAuthClient } from "better-auth/react";
import { magicLinkClient, twoFactorClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  basePath: "/api/auth",
  plugins: [magicLinkClient(), twoFactorClient()],
});

/** Mensagem curta em inglês (chave do t()) pra cada erro conhecido do login. */
export function authErrorKey(error: { code?: string | null; status?: number } | null | undefined): string {
  const code = error?.code ?? "";
  if (code === "INVALID_EMAIL_OR_PASSWORD") return "Wrong email or password.";
  if (code === "EMAIL_NOT_ALLOWED") return "This email does not have access to Lead Engine.";
  if (code === "PASSWORD_RATE_LIMIT" || code === "MAGIC_LINK_RATE_LIMIT" || error?.status === 429)
    return "Too many tries. Wait a few minutes and try again.";
  if (code === "INVALID_CODE" || code === "INVALID_BACKUP_CODE" || code === "INVALID_TWO_FACTOR_COOKIE")
    return "Wrong or expired code. Try again.";
  if (code === "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE" || code === "ACCOUNT_TEMPORARILY_LOCKED")
    return "Too many wrong codes. Sign in again in a few minutes.";
  if (code === "PASSWORD_TOO_SHORT") return "The password needs at least 10 characters.";
  if (code === "PASSWORD_TOO_LONG") return "The password is too long.";
  if (code === "INVALID_PASSWORD") return "Wrong password.";
  return "Something went wrong. Try again.";
}
