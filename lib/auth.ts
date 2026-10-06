/**
 * Quem está usando o Lead Engine: a pessoa logada (sessão do Better Auth, ver
 * lib/better-auth.ts) ou uma chave de API (MCP, scripts).
 *
 * Fase 0 (06/10/2026): o NextAuth saiu. As funções abaixo têm a mesma
 * assinatura de antes, então as rotas não mudam. Chave de API e MCP continuam
 * exatamente iguais (presas ao workspace onde foram criadas).
 */
import { headers } from "next/headers";
import { resolveApiToken, type ResolvedApiToken } from "@/lib/api-token-auth";
import { prisma } from "@/lib/db/client";
import { getAuth } from "@/lib/better-auth";
import { ensureWorkspaceForUser, getPrimaryWorkspace } from "@/lib/workspace";

export type SessionUser = {
  id: string;
  email: string | null;
  name: string | null;
  image: string | null;
  role: "USER" | "ADMIN";
  twoFactorEnabled: boolean;
};

export type AppSession = {
  user: SessionUser;
  session: { id: string; expiresAt: Date };
};

/** Admin da plataforma sem 2FA ligado: só pode ativar o 2FA, mais nada. */
export function needsTwoFactorSetup(user: Pick<SessionUser, "role" | "twoFactorEnabled"> | null | undefined): boolean {
  return Boolean(user && user.role === "ADMIN" && !user.twoFactorEnabled);
}

/** Sessão do navegador (cookie). Mesmo formato do antigo auth() do NextAuth. */
export async function auth(): Promise<AppSession | null> {
  let requestHeaders: Headers;
  try {
    requestHeaders = new Headers(await headers());
  } catch {
    return null;
  }
  const result = await getAuth().api.getSession({ headers: requestHeaders });
  if (!result?.user) return null;
  const u = result.user as typeof result.user & { role?: string | null; twoFactorEnabled?: boolean | null };
  return {
    user: {
      id: u.id,
      email: u.email ?? null,
      name: u.name || null,
      image: u.image ?? null,
      role: u.role === "ADMIN" ? "ADMIN" : "USER",
      twoFactorEnabled: Boolean(u.twoFactorEnabled),
    },
    session: { id: result.session.id, expiresAt: new Date(result.session.expiresAt) },
  };
}

/**
 * User an `Authorization: Bearer <key>` request acts as (see
 * resolveApiToken). Lets the MCP endpoint and scripts reuse every
 * session-guarded route.
 */
async function getApiToken(): Promise<
  { present: false } | { present: true; token: ResolvedApiToken | null }
> {
  let authorization: string | null = null;
  try {
    authorization = (await headers()).get("authorization");
  } catch {
    // Outside a request (worker, cron script) there is no header to read.
    return { present: false };
  }
  if (!authorization) return { present: false };
  return { present: true, token: await resolveApiToken(authorization) };
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
  const api = await getApiToken();
  // Auditoria 05/10: an Authorization header that is not a valid key is a
  // failed login, not "try the cookie instead" (same rule as getApiCaller).
  if (api.present) return api.token?.userId ?? null;

  const session = await auth();
  if (!session) return null;
  // Admin sem 2FA não usa nada do painel até ligar o 2FA (o Better Auth, que
  // cuida de ligar o 2FA, não passa por aqui).
  if (needsTwoFactorSetup(session.user)) return null;
  return session.user.id;
}

export async function getCurrentWorkspaceId(): Promise<string | null> {
  const api = await getApiToken();
  if (api.present) {
    if (!api.token) return null;
    // A Settings key acts only in the workspace it was created in, never in
    // an older workspace its owner also belongs to (auditoria 05/10).
    if (api.token.workspaceId) return api.token.workspaceId;
  }
  const userId = api.present ? api.token?.userId ?? null : await getCurrentUserId();
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
