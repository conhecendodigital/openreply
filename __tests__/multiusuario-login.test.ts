/**
 * Fase 0 (06/10/2026): login novo (Better Auth) de ponta a ponta, com o banco
 * em memória do próprio Better Auth e a configuração de produção
 * (lib/auth-config.ts):
 * - link por e-mail, senha e Google (Google simulado);
 * - allowlist barra e-mail fora da lista nos três caminhos;
 * - 2FA (TOTP + códigos de recuperação) é pedido no login por senha, por link
 *   e por Google;
 * - tirar a pessoa da lista derruba o login dela.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryAdapter } from "better-auth/adapters/memory";
import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";
import { createAuth, safeCallbackPath, type AuthDeps, type GoogleConfig } from "../lib/auth-config";

const BASE = "http://localhost:3000";
const SECRET = "segredo-de-teste-com-mais-de-32-caracteres-123";

type Db = Record<string, Record<string, unknown>[]>;

function setup(opts: { google?: { email: string; emailVerified: boolean; sub?: string } } = {}) {
  const db: Db = { user: [], authSession: [], authAccount: [], authVerification: [], twoFactor: [] };
  const allowed = new Set(["matheus@ex.com", "kayanne@ex.com", "google@ex.com"]);
  const mails: { email: string; url: string }[] = [];
  const created: string[] = [];
  const google = opts.google;
  const deps: AuthDeps = {
    database: memoryAdapter(db),
    secret: SECRET,
    baseURL: BASE,
    builtInRateLimit: false,
    sendMagicLink: async (email, url) => {
      mails.push({ email, url });
    },
    canSignIn: async (email) => allowed.has(email.toLowerCase()),
    canSendMagicLink: async () => true,
    canTryPassword: async () => true,
    onUserCreated: async (user) => {
      created.push(user.email);
    },
    emailOfUser: async (userId) => (db.user.find((u) => u.id === userId)?.email as string) ?? null,
    google: google
      ? {
          clientId: "google-client",
          clientSecret: "google-secret",
          verifyIdToken: async () => true,
          getUserInfo: (async () => ({
            user: {
              id: google.sub ?? "google-sub-1",
              email: google.email,
              name: "Pessoa do Google",
              emailVerified: google.emailVerified,
            },
            data: { sub: google.sub ?? "google-sub-1", email: google.email, email_verified: google.emailVerified },
          })) as unknown as GoogleConfig["getUserInfo"],
        }
      : null,
  };
  const auth = createAuth(deps);
  return { auth, db, allowed, mails, created, deps };
}

function cookiesFrom(res: Response): string {
  const jar = new Map<string, string>();
  for (const line of res.headers.getSetCookie()) {
    const [pair, ...attrs] = line.split(";");
    const [name, ...rest] = pair.split("=");
    const value = rest.join("=");
    const expired = attrs.some((a) => /max-age=0/i.test(a.trim()));
    if (expired || value === "") jar.delete(name.trim());
    else jar.set(name.trim(), value);
  }
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
}

function post(path: string, body: unknown, cookie = "") {
  return new Request(`${BASE}/api/auth${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE, ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

async function magicLogin(ctx: ReturnType<typeof setup>, email: string) {
  const res = await ctx.auth.handler(post("/sign-in/magic-link", { email, callbackURL: "/dashboard" }));
  expect(res.status).toBe(200);
  const mail = ctx.mails.at(-1);
  if (!mail || mail.email !== email) return { res, verify: null as Response | null, cookie: "" };
  const verify = await ctx.auth.handler(new Request(mail.url, { headers: { origin: BASE } }));
  return { res, verify, cookie: cookiesFrom(verify) };
}

async function sessionOf(ctx: ReturnType<typeof setup>, cookie: string) {
  return ctx.auth.api.getSession({ headers: new Headers({ cookie }) });
}

async function enableTotp(ctx: ReturnType<typeof setup>, cookie: string, password?: string) {
  const out = await ctx.auth.api.enableTwoFactor({
    body: { ...(password ? { password } : {}), method: "totp" } as { password: string },
    headers: new Headers({ cookie }),
  });
  const uri = new URL((out as { totpURI: string }).totpURI);
  const secret = new TextDecoder().decode(base32.decode(uri.searchParams.get("secret")!));
  const code = await createOTP(secret).totp();
  await ctx.auth.api.verifyTOTP({ body: { code }, headers: new Headers({ cookie }) });
  return { secret, backupCodes: (out as { backupCodes: string[] }).backupCodes };
}

beforeEach(() => {
  vi.useRealTimers();
});

describe("link por e-mail", () => {
  it("quem está na lista recebe o link, entra e ganha o workspace", async () => {
    const ctx = setup();
    const { verify, cookie } = await magicLogin(ctx, "matheus@ex.com");
    expect(verify?.status).toBe(302);
    expect(verify?.headers.get("location")).toBe(`${BASE}/dashboard`);
    const session = await sessionOf(ctx, cookie);
    expect(session?.user.email).toBe("matheus@ex.com");
    expect(ctx.created).toEqual(["matheus@ex.com"]);
    // O link só vale uma vez.
    const again = await ctx.auth.handler(new Request(ctx.mails[0].url, { headers: { origin: BASE } }));
    expect(again.headers.get("location")).toContain("error=INVALID_TOKEN");
  });

  it("e-mail fora da lista: a tela responde igual, mas nenhum link sai e nenhuma conta nasce", async () => {
    const ctx = setup();
    const res = await ctx.auth.handler(post("/sign-in/magic-link", { email: "intruso@ex.com", callbackURL: "/dashboard" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: true });
    expect(ctx.mails).toEqual([]);
    expect(ctx.db.user).toEqual([]);
  });

  it("maiúsculas no e-mail não criam uma segunda conta", async () => {
    const ctx = setup();
    await magicLogin(ctx, "matheus@ex.com");
    await ctx.auth.handler(post("/sign-in/magic-link", { email: "Matheus@Ex.com", callbackURL: "/dashboard" }));
    const mail = ctx.mails.at(-1)!;
    expect(mail.email).toBe("matheus@ex.com");
    await ctx.auth.handler(new Request(mail.url, { headers: { origin: BASE } }));
    expect(ctx.db.user).toHaveLength(1);
  });
});

describe("senha", () => {
  it("não tem cadastro aberto por senha", async () => {
    const ctx = setup();
    const res = await ctx.auth.handler(post("/sign-up/email", { email: "matheus@ex.com", password: "senha-bem-forte-1", name: "M" }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(ctx.db.user).toEqual([]);
  });

  it("quem entrou pelo link cria a senha e depois entra com ela", async () => {
    const ctx = setup();
    const { cookie } = await magicLogin(ctx, "matheus@ex.com");
    await ctx.auth.api.setPassword({ body: { newPassword: "senha-bem-forte-1" }, headers: new Headers({ cookie }) });

    const ok = await ctx.auth.handler(post("/sign-in/email", { email: "matheus@ex.com", password: "senha-bem-forte-1" }));
    expect(ok.status).toBe(200);
    expect((await sessionOf(ctx, cookiesFrom(ok)))?.user.email).toBe("matheus@ex.com");

    const wrong = await ctx.auth.handler(post("/sign-in/email", { email: "matheus@ex.com", password: "errada-errada" }));
    expect(wrong.status).toBe(401);
  });

  it("senha curta demais é recusada", async () => {
    const ctx = setup();
    const { cookie } = await magicLogin(ctx, "matheus@ex.com");
    await expect(
      ctx.auth.api.setPassword({ body: { newPassword: "curta" }, headers: new Headers({ cookie }) })
    ).rejects.toThrow();
  });

  it("tirou a pessoa da lista: a senha dela para de funcionar", async () => {
    const ctx = setup();
    const { cookie } = await magicLogin(ctx, "kayanne@ex.com");
    await ctx.auth.api.setPassword({ body: { newPassword: "senha-bem-forte-1" }, headers: new Headers({ cookie }) });
    ctx.allowed.delete("kayanne@ex.com");
    const res = await ctx.auth.handler(post("/sign-in/email", { email: "kayanne@ex.com", password: "senha-bem-forte-1" }));
    expect(res.status).toBe(403);
    expect(cookiesFrom(res)).not.toContain("session_token");
  });

  it("limite de tentativas de senha", async () => {
    const ctx = setup();
    const auth = createAuth({ ...ctx.deps, canTryPassword: async () => false });
    const res = await auth.handler(post("/sign-in/email", { email: "matheus@ex.com", password: "qualquer-coisa" }));
    expect(res.status).toBe(429);
  });
});

describe("Google (simulado)", () => {
  it("e-mail da lista entra com Google e ganha o workspace", async () => {
    const ctx = setup({ google: { email: "google@ex.com", emailVerified: true } });
    const res = await ctx.auth.handler(post("/sign-in/social", { provider: "google", idToken: { token: "id-token-falso" } }));
    expect(res.status).toBe(200);
    expect((await sessionOf(ctx, cookiesFrom(res)))?.user.email).toBe("google@ex.com");
    expect(ctx.created).toEqual(["google@ex.com"]);
    expect(ctx.db.authAccount.some((a) => a.providerId === "google")).toBe(true);
  });

  it("e-mail fora da lista não entra com Google", async () => {
    const ctx = setup({ google: { email: "intruso@ex.com", emailVerified: true } });
    const res = await ctx.auth.handler(post("/sign-in/social", { provider: "google", idToken: { token: "id-token-falso" } }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(ctx.db.user).toEqual([]);
    expect(cookiesFrom(res)).not.toContain("session_token");
  });

  it("liga o Google à conta que já existe só quando o Google confirmou o e-mail", async () => {
    const naoConfirmado = setup({ google: { email: "matheus@ex.com", emailVerified: false } });
    await magicLogin(naoConfirmado, "matheus@ex.com");
    const r1 = await naoConfirmado.auth.handler(post("/sign-in/social", { provider: "google", idToken: { token: "t" } }));
    expect(r1.status).toBeGreaterThanOrEqual(400);
    expect(naoConfirmado.db.authAccount.some((a) => a.providerId === "google")).toBe(false);

    const confirmado = setup({ google: { email: "matheus@ex.com", emailVerified: true } });
    await magicLogin(confirmado, "matheus@ex.com");
    const r2 = await confirmado.auth.handler(post("/sign-in/social", { provider: "google", idToken: { token: "t" } }));
    expect(r2.status).toBe(200);
    expect(confirmado.db.user).toHaveLength(1);
    expect(confirmado.db.authAccount.some((a) => a.providerId === "google")).toBe(true);
  });
});

describe("2FA (app autenticador)", () => {
  it("com 2FA ligado, a senha sozinha não entra: pede o código", async () => {
    const ctx = setup();
    const { cookie } = await magicLogin(ctx, "matheus@ex.com");
    await ctx.auth.api.setPassword({ body: { newPassword: "senha-bem-forte-1" }, headers: new Headers({ cookie }) });
    const { secret } = await enableTotp(ctx, cookie, "senha-bem-forte-1");
    expect(ctx.db.user[0].twoFactorEnabled).toBe(true);

    const res = await ctx.auth.handler(post("/sign-in/email", { email: "matheus@ex.com", password: "senha-bem-forte-1" }));
    expect(await res.json()).toMatchObject({ twoFactorRedirect: true });
    const pending = cookiesFrom(res);
    expect(await sessionOf(ctx, pending)).toBeNull();

    const wrong = await ctx.auth.handler(post("/two-factor/verify-totp", { code: "000000" }, pending));
    expect(wrong.status).toBe(401);

    const code = await createOTP(secret).totp();
    const ok = await ctx.auth.handler(post("/two-factor/verify-totp", { code }, pending));
    expect(ok.status).toBe(200);
    expect((await sessionOf(ctx, cookiesFrom(ok)))?.user.email).toBe("matheus@ex.com");
  });

  it("com 2FA ligado, o link do e-mail também pede o código (e não deixa sessão aberta)", async () => {
    const ctx = setup();
    const first = await magicLogin(ctx, "matheus@ex.com");
    const { secret } = await enableTotp(ctx, first.cookie);

    const { verify, cookie } = await magicLogin(ctx, "matheus@ex.com");
    expect(verify?.status).toBe(302);
    expect(verify?.headers.get("location")).toBe("/login/2fa?callbackUrl=%2Fdashboard");
    expect(await sessionOf(ctx, cookie)).toBeNull();
    const ok = await ctx.auth.handler(post("/two-factor/verify-totp", { code: await createOTP(secret).totp() }, cookie));
    expect(ok.status).toBe(200);
    expect((await sessionOf(ctx, cookiesFrom(ok)))?.user.email).toBe("matheus@ex.com");
  });

  it("com 2FA ligado, o Google também pede o código", async () => {
    const ctx = setup({ google: { email: "google@ex.com", emailVerified: true } });
    const first = await ctx.auth.handler(post("/sign-in/social", { provider: "google", idToken: { token: "t" } }));
    await enableTotp(ctx, cookiesFrom(first));
    const res = await ctx.auth.handler(post("/sign-in/social", { provider: "google", idToken: { token: "t" } }));
    expect(await res.json()).toMatchObject({ twoFactorRedirect: true });
    expect(await sessionOf(ctx, cookiesFrom(res))).toBeNull();
  });

  it("código de recuperação entra uma vez só", async () => {
    const ctx = setup();
    const first = await magicLogin(ctx, "matheus@ex.com");
    const { backupCodes } = await enableTotp(ctx, first.cookie);
    expect(backupCodes).toHaveLength(10);

    const a = await magicLogin(ctx, "matheus@ex.com");
    const ok = await ctx.auth.handler(post("/two-factor/verify-backup-code", { code: backupCodes[0] }, a.cookie));
    expect(ok.status).toBe(200);

    const b = await magicLogin(ctx, "matheus@ex.com");
    const reused = await ctx.auth.handler(post("/two-factor/verify-backup-code", { code: backupCodes[0] }, b.cookie));
    expect(reused.status).toBe(401);
  });
});

describe("volta depois do login", () => {
  it("só aceita caminho do próprio site", () => {
    expect(safeCallbackPath("http://localhost:3000/quizzes?x=1", BASE)).toBe("/quizzes?x=1");
    expect(safeCallbackPath("/settings", BASE)).toBe("/settings");
    expect(safeCallbackPath("https://outro-site.com/roubo", BASE)).toBe("/dashboard");
    expect(safeCallbackPath("//outro-site.com", BASE)).toBe("/dashboard");
    expect(safeCallbackPath(null, BASE)).toBe("/dashboard");
  });
});
