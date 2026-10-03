import NextAuth, { type NextAuthConfig } from "next-auth";
import Nodemailer from "next-auth/providers/nodemailer";
import Resend from "next-auth/providers/resend";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { headers } from "next/headers";
import { resolveApiToken, resolveApiTokenUserId } from "@/lib/api-token-auth";
import { prisma } from "@/lib/db/client";
import { ensureWorkspaceForUser, getPrimaryWorkspace } from "@/lib/workspace";
import { isEmailAllowedToSignIn } from "@/lib/env";

type AdapterPrismaClient = Parameters<typeof PrismaAdapter>[0];

const emailFrom = process.env.EMAIL_FROM ?? "Lead Engine <login@example.com>";
// Setting EMAIL_SERVER switches magic links to your own SMTP server, for
// self-hosters who do not want a third-party mail service. Resend stays the
// default, so an existing deployment is unaffected.
const smtpServer = process.env.EMAIL_SERVER;

/**
 * Provider id the login form has to sign in with. It differs per transport,
 * so it is derived here rather than hardcoded at the call site.
 */
export const EMAIL_PROVIDER_ID = smtpServer ? "nodemailer" : "resend";

export const authConfig = {
  adapter: PrismaAdapter(prisma as unknown as AdapterPrismaClient),
  providers: [
    smtpServer
      ? Nodemailer({ server: smtpServer, from: emailFrom })
      : Resend({
          apiKey: process.env.RESEND_API_KEY ?? "missing-resend-api-key",
          from: emailFrom,
        }),
  ],
  callbacks: {
    // Runs before the magic link is sent, so a blocked address never receives
    // one, and again when the link is verified.
    async signIn({ user }) {
      return isEmailAllowedToSignIn(user?.email);
    },
    async session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
      }
      return session;
    },
  },
  events: {
    async createUser({ user }) {
      if (user.id) {
        await ensureWorkspaceForUser(user.id, user.email);
      }
    },
  },
  pages: {
    signIn: "/login",
    verifyRequest: "/verify-request",
  },
  session: {
    strategy: "database",
  },
  trustHost: true,
  secret: process.env.NEXTAUTH_SECRET,
} satisfies NextAuthConfig;

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

/**
 * User an `Authorization: Bearer <key>` request acts as (see
 * resolveApiTokenUserId). Lets the MCP endpoint and scripts reuse every
 * session-guarded route.
 */
async function getApiTokenUserId(): Promise<string | null> {
  let authorization: string | null = null;
  try {
    authorization = (await headers()).get("authorization");
  } catch {
    // Outside a request (worker, cron script) there is no header to read.
    return null;
  }
  return resolveApiTokenUserId(authorization);
}

/** True when the current request authenticates with an API key, not a session. */
export async function isApiTokenRequest(): Promise<boolean> {
  try {
    return Boolean((await headers()).get("authorization"));
  } catch {
    return false;
  }
}

export type ApiCaller =
  | { kind: "session" }
  /** tokenId null: an Authorization header that is not a valid key. */
  | { kind: "token"; tokenId: string | null; scopes: string[] };

/**
 * Who is calling: a signed-in human (session) or an API key (MCP, scripts).
 * Any Authorization header counts as a key, even an invalid one, so a request
 * can never pass as "human" just by also carrying a cookie.
 */
export async function getApiCaller(): Promise<ApiCaller> {
  let authorization: string | null = null;
  try {
    authorization = (await headers()).get("authorization");
  } catch {
    return { kind: "session" };
  }
  if (!authorization) return { kind: "session" };
  const resolved = await resolveApiToken(authorization);
  return resolved
    ? { kind: "token", tokenId: resolved.tokenId, scopes: resolved.scopes }
    : { kind: "token", tokenId: null, scopes: [] };
}

export async function getCurrentUserId(): Promise<string | null> {
  const apiUserId = await getApiTokenUserId();
  if (apiUserId) return apiUserId;

  const session = await auth();
  return session?.user?.id ?? null;
}

export async function getCurrentWorkspaceId(): Promise<string | null> {
  const userId = await getCurrentUserId();
  if (!userId) return null;

  const workspace = await getPrimaryWorkspace(userId);
  if (workspace) return workspace.id;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });

  const createdWorkspace = await ensureWorkspaceForUser(userId, user?.email);
  return createdWorkspace.id;
}
