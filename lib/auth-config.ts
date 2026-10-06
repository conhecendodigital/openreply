/**
 * Fase 0 (06/10/2026): login novo com Better Auth, no lugar do NextAuth.
 *
 * Três jeitos de entrar, todos presos à mesma allowlist:
 * - e-mail e senha (sem cadastro aberto: a senha é criada depois de entrar
 *   pelo link ou pelo Google, em "Criar senha");
 * - Google (só liga a uma conta que já existe se o Google confirmou o e-mail);
 * - link mágico por e-mail (Resend ou SMTP), como era antes.
 *
 * 2FA por app autenticador (TOTP) com 10 códigos de recuperação. O plugin do
 * Better Auth só pede o código no login por senha; aqui ele também é pedido
 * depois do link mágico e do Google (enforceTwoFactor), então ligar o 2FA
 * protege os três caminhos.
 *
 * Esta é uma fábrica sem dependência do Prisma nem do Next, pra dar pra testar
 * com o banco em memória. A instância de produção fica em lib/better-auth.ts.
 */
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { deleteSessionCookie } from "better-auth/cookies";
import { generateRandomString } from "better-auth/crypto";
import { nextCookies } from "better-auth/next-js";
import { magicLink, twoFactor } from "better-auth/plugins";
import type { GoogleOptions } from "better-auth/social-providers";

export const MIN_PASSWORD_LENGTH = 10;
/** O link mágico vale 15 minutos (o e-mail diz isso). */
export const MAGIC_LINK_TTL_SECONDS = 15 * 60;
/** Tempo pra digitar o código do 2FA depois da senha, do link ou do Google. */
export const TWO_FACTOR_CHALLENGE_SECONDS = 10 * 60;
export const TWO_FACTOR_PAGE = "/login/2fa";

export type GoogleConfig = {
  clientId: string;
  clientSecret: string;
  /** Só nos testes: troca a checagem do id_token do Google. */
  verifyIdToken?: (token: string, nonce?: string) => Promise<boolean>;
  /** Só nos testes: troca a busca do perfil no Google. */
  getUserInfo?: GoogleOptions["getUserInfo"];
};

export type AuthDeps = {
  database: BetterAuthOptions["database"];
  secret: string;
  baseURL: string;
  /** Envia o e-mail com o link de acesso. */
  sendMagicLink: (email: string, url: string) => Promise<void>;
  /** Allowlist: ALLOWED_EMAILS, BetaAllowlist ou convite de workspace. */
  canSignIn: (email: string) => Promise<boolean>;
  /** Limite de links por e-mail (true = pode mandar). */
  canSendMagicLink: (email: string) => Promise<boolean>;
  /** Limite de tentativas de senha por e-mail (true = pode tentar). */
  canTryPassword: (email: string) => Promise<boolean>;
  /** Já existe alguém com este e-mail, ignorando maiúsculas? Evita conta duplicada. */
  emailTakenInsensitive?: (email: string) => Promise<boolean>;
  /** Usuário novo: cria o workspace dele e aceita convites (ensureWorkspaceForUser). */
  onUserCreated: (user: { id: string; email: string }) => Promise<void>;
  /** E-mail de um usuário pelo id (pra checar a allowlist em toda sessão nova). */
  emailOfUser: (userId: string) => Promise<string | null>;
  google?: GoogleConfig | null;
  /** Grava cookies pelas server actions do Next (desligado nos testes). */
  useNextCookies?: boolean;
  trustedOrigins?: string[];
  /** Limite do próprio Better Auth por IP (desligado nos testes). Padrão: ligado. */
  builtInRateLimit?: boolean;
};

function forbidden(message: string, code: string): APIError {
  return new APIError("FORBIDDEN", { message, code });
}

function headerLocation(returned: unknown): string | null {
  if (!returned || typeof returned !== "object" || !("headers" in returned)) return null;
  const headers = (returned as { headers?: unknown }).headers;
  if (!headers) return null;
  if (headers instanceof Headers) return headers.get("location");
  const value = (headers as Record<string, unknown>).location ?? (headers as Record<string, unknown>).Location;
  return typeof value === "string" ? value : null;
}

/** Só caminhos do próprio site (nada de //outro-site ou /\outro-site). */
export function safeCallbackPath(target: string | null | undefined, baseURL: string): string {
  if (!target) return "/dashboard";
  try {
    const base = new URL(baseURL);
    const url = new URL(target, base);
    if (url.origin !== base.origin) return "/dashboard";
    const path = `${url.pathname}${url.search}`;
    if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) return "/dashboard";
    return path;
  } catch {
    return "/dashboard";
  }
}

/** Caminhos que criam sessão sem passar pelo 2FA do plugin. */
const PASSWORDLESS_SIGN_IN_PATHS = new Set(["/magic-link/verify", "/callback/:id", "/sign-in/social"]);

export function createAuth(deps: AuthDeps) {
  const plugins = [
    magicLink({
      expiresIn: MAGIC_LINK_TTL_SECONDS,
      sendMagicLink: async ({ email, url }) => {
        await deps.sendMagicLink(email, url);
      },
    }),
    twoFactor({
      issuer: "Lead Engine",
      // Quem só entra pelo link ou pelo Google também pode ligar o 2FA.
      // Quem tem senha precisa digitar a senha pra ligar e desligar.
      allowPasswordless: true,
      backupCodeOptions: { amount: 10, length: 10 },
      twoFactorCookieMaxAge: TWO_FACTOR_CHALLENGE_SECONDS,
    }),
    ...(deps.useNextCookies ? [nextCookies()] : []),
  ];

  const google = deps.google?.clientId && deps.google.clientSecret ? deps.google : null;

  return betterAuth({
    appName: "Lead Engine",
    baseURL: deps.baseURL,
    secret: deps.secret,
    basePath: "/api/auth",
    database: deps.database,
    trustedOrigins: deps.trustedOrigins ?? [deps.baseURL],
    user: {
      modelName: "user",
      // A coluna emailVerified do NextAuth é uma data; o login novo usa a
      // authEmailVerified (true/false) e não mexe na antiga.
      fields: { emailVerified: "authEmailVerified" },
      additionalFields: {
        role: { type: "string", required: false, defaultValue: "USER", input: false },
      },
    },
    session: {
      modelName: "authSession",
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    account: {
      modelName: "authAccount",
      encryptOAuthTokens: true,
      accountLinking: {
        enabled: true,
        // Nenhum provedor "confiável" sem checar: só liga o Google a uma conta
        // existente quando o Google confirmou o e-mail.
        trustedProviders: [],
      },
    },
    verification: { modelName: "authVerification" },
    emailAndPassword: {
      enabled: true,
      // Sem cadastro aberto por senha: evita alguém criar a conta antes do
      // dono do e-mail. A senha nasce depois de entrar (link ou Google).
      disableSignUp: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
    },
    socialProviders: google
      ? {
          google: {
            clientId: google.clientId,
            clientSecret: google.clientSecret,
            prompt: "select_account",
            ...(google.verifyIdToken ? { verifyIdToken: google.verifyIdToken } : {}),
            ...(google.getUserInfo ? { getUserInfo: google.getUserInfo } : {}),
          },
        }
      : {},
    plugins,
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const email = String(user.email ?? "").trim().toLowerCase();
            if (!email || !(await deps.canSignIn(email).catch(() => false))) {
              throw forbidden("Este e-mail não tem acesso ao Lead Engine.", "EMAIL_NOT_ALLOWED");
            }
            if (deps.emailTakenInsensitive && (await deps.emailTakenInsensitive(email))) {
              // Conta antiga com maiúsculas no e-mail: nunca criar uma segunda.
              throw forbidden("Já existe uma conta com este e-mail. Fale com o suporte.", "EMAIL_CASE_CONFLICT");
            }
            return { data: { ...user, email } };
          },
          after: async (user) => {
            await deps.onUserCreated({ id: user.id, email: user.email });
          },
        },
      },
      session: {
        create: {
          // Tirou a pessoa da lista? Ela não entra mais, por nenhum caminho.
          before: async (session) => {
            const email = await deps.emailOfUser(session.userId);
            if (!email || !(await deps.canSignIn(email).catch(() => false))) {
              throw forbidden("Este e-mail não tem acesso ao Lead Engine.", "EMAIL_NOT_ALLOWED");
            }
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/sign-in/magic-link") {
          const email = String(ctx.body?.email ?? "").trim().toLowerCase();
          // Resposta igual pra quem tem e pra quem não tem acesso: ninguém
          // descobre pela tela quais e-mails estão na lista.
          const allowed = email ? await deps.canSignIn(email).catch(() => false) : false;
          if (!allowed) return ctx.json({ status: true });
          if (!(await deps.canSendMagicLink(email))) {
            throw new APIError("TOO_MANY_REQUESTS", {
              message: "Você pediu muitos links. Espere um pouco e tente de novo.",
              code: "MAGIC_LINK_RATE_LIMIT",
            });
          }
          return { context: { body: { ...ctx.body, email } } };
        }
        if (ctx.path === "/sign-in/email") {
          const email = String(ctx.body?.email ?? "").trim().toLowerCase();
          if (email && !(await deps.canTryPassword(email))) {
            throw new APIError("TOO_MANY_REQUESTS", {
              message: "Muitas tentativas. Espere alguns minutos ou entre pelo link do e-mail.",
              code: "PASSWORD_RATE_LIMIT",
            });
          }
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (!PASSWORDLESS_SIGN_IN_PATHS.has(ctx.path)) return;
        return enforceTwoFactor(ctx, deps.baseURL);
      }),
    },
    rateLimit: { enabled: deps.builtInRateLimit ?? true, window: 60, max: 100 },
    advanced: {
      ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
    },
  });
}

type AfterHookCtx = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

/**
 * Mesmo desafio que o plugin de 2FA faz no login por senha: apaga a sessão
 * que acabou de nascer, guarda um cookie assinado de "falta o código" e manda
 * pra tela do código. A sessão só é criada de novo quando o código confere
 * (/two-factor/verify-totp ou /two-factor/verify-backup-code).
 */
async function enforceTwoFactor(ctx: AfterHookCtx, baseURL: string): Promise<unknown> {
  const data = ctx.context.newSession;
  if (!data) return;
  if (!(data.user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled) return;

  const returned = ctx.context.returned;
  const location = headerLocation(returned);

  deleteSessionCookie(ctx, true);
  await ctx.context.internalAdapter.deleteSession(data.session.token);
  ctx.context.setNewSession(null);

  const maxAge = TWO_FACTOR_CHALLENGE_SECONDS;
  const twoFactorCookie = ctx.context.createAuthCookie("two_factor", { maxAge });
  const identifier = `2fa-${generateRandomString(20)}`;
  const expiresAt = new Date(Date.now() + maxAge * 1000);
  await ctx.context.internalAdapter.createVerificationValue({ value: data.user.id, identifier, expiresAt });
  await ctx.context.internalAdapter.createVerificationValue({
    value: "0",
    identifier: `2fa-attempts-${identifier}`,
    expiresAt,
  });
  await ctx.setSignedCookie(twoFactorCookie.name, identifier, ctx.context.secret, twoFactorCookie.attributes);

  if (location) {
    const next = safeCallbackPath(location, baseURL);
    throw ctx.redirect(`${TWO_FACTOR_PAGE}?callbackUrl=${encodeURIComponent(next)}`);
  }
  return ctx.json({ twoFactorRedirect: true, twoFactorMethods: ["totp"] });
}

export type LeadEngineAuth = ReturnType<typeof createAuth>;
