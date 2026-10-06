/**
 * Fase 0: criar a senha (primeiro acesso de quem só entrava pelo link) ou
 * dizer "agora não". Trocar uma senha que já existe é pelo Better Auth
 * (/api/auth/change-password), que pede a senha atual.
 */
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { fail, ok, readJson } from "@/lib/api-helpers";
import { getAuth } from "@/lib/better-auth";
import { getSecurityState, SKIP_PASSWORD_COOKIE } from "@/lib/account-security";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth-config";

export async function POST(request: Request) {
  const session = await auth();
  if (!session) return fail("Unauthorized", 401);
  const body = (await readJson(request)) as { newPassword?: unknown; skip?: unknown } | null;

  if (body?.skip === true) {
    const res = NextResponse.json({ success: true, data: { skipped: true } });
    res.cookies.set(SKIP_PASSWORD_COOKIE, "1", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
    });
    return res;
  }

  const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return fail("The password needs at least 10 characters.", 400);
  }
  if (newPassword.length > 128) return fail("The password is too long.", 400);
  const state = await getSecurityState(session.user.id);
  if (state.hasPassword) {
    return fail("You already have a password. Change it in Settings, Security.", 409);
  }
  await getAuth().api.setPassword({ body: { newPassword }, headers: new Headers(await headers()) });
  return ok({ created: true });
}
