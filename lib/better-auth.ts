/**
 * Instância de produção do login (Better Auth). Criada na primeira vez que
 * alguém precisa dela, pra não exigir as variáveis no `next build`.
 */
import { prismaAdapter } from "better-auth/adapters/prisma";
import { getPrisma } from "@/lib/db/client";
import { createAuth, type LeadEngineAuth } from "@/lib/auth-config";
import { allowSignIn } from "@/lib/auth-signin";
import { sendLoginEmail } from "@/lib/auth-email";
import { hitRateLimit, MAGIC_LINK_LIMIT, PASSWORD_LIMIT } from "@/lib/http-rate-limit";
import { ensureWorkspaceForUser } from "@/lib/workspace";

const globalForAuth = globalThis as unknown as { leadEngineAuth?: LeadEngineAuth };

export function authBaseUrl(env: Record<string, string | undefined> = process.env): string {
  return (env.BETTER_AUTH_URL || env.NEXTAUTH_URL || "http://localhost:3000").replace(/\/+$/, "");
}

/**
 * Segredo do login. BETTER_AUTH_SECRET é o novo; enquanto ele não existir no
 * servidor, o NEXTAUTH_SECRET de sempre serve (as sessões são outras tabelas,
 * então reaproveitar o segredo não reabre sessão antiga).
 */
export function authSecret(env: Record<string, string | undefined> = process.env): string {
  const secret = env.BETTER_AUTH_SECRET || env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET não configurado.");
  return secret;
}

export function isGoogleLoginConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

export function getAuth(): LeadEngineAuth {
  if (globalForAuth.leadEngineAuth) return globalForAuth.leadEngineAuth;
  const prisma = getPrisma();
  const baseURL = authBaseUrl();
  const auth = createAuth({
    database: prismaAdapter(prisma, { provider: "postgresql" }),
    secret: authSecret(),
    baseURL,
    trustedOrigins: [baseURL],
    useNextCookies: true,
    sendMagicLink: sendLoginEmail,
    canSignIn: (email) => allowSignIn({ user: { email } }),
    canSendMagicLink: async (email) =>
      (await hitRateLimit("magic-link", email, MAGIC_LINK_LIMIT.limit, MAGIC_LINK_LIMIT.windowSeconds)).allowed,
    canTryPassword: async (email) =>
      (await hitRateLimit("password", email, PASSWORD_LIMIT.limit, PASSWORD_LIMIT.windowSeconds)).allowed,
    emailTakenInsensitive: async (email) =>
      Boolean(
        await prisma.user.findFirst({
          where: { email: { equals: email, mode: "insensitive" } },
          select: { id: true },
        })
      ),
    onUserCreated: async (user) => {
      await ensureWorkspaceForUser(user.id, user.email);
    },
    emailOfUser: async (userId) =>
      (await prisma.user.findUnique({ where: { id: userId }, select: { email: true } }))?.email ?? null,
    google: isGoogleLoginConfigured()
      ? { clientId: process.env.GOOGLE_CLIENT_ID!, clientSecret: process.env.GOOGLE_CLIENT_SECRET! }
      : null,
  });
  globalForAuth.leadEngineAuth = auth;
  return auth;
}
