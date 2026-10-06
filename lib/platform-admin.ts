/**
 * Fase 0: admin da plataforma (o dono do Lead Engine). Não é o papel dentro de
 * um workspace: vem de User.role = ADMIN no banco.
 */
import { auth, needsTwoFactorSetup, type AppSession, type SessionUser } from "@/lib/auth";

/** No beta: 10 usuários + o admin. */
export const BETA_ALLOWLIST_LIMIT = 11;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeAllowlistEmail(value: unknown): string | null {
  const email = String(value ?? "").trim().toLowerCase();
  return EMAIL.test(email) && email.length <= 254 ? email : null;
}

/**
 * Item "Admin" do menu lateral (pedido do dono em 06/10/2026: "quero que
 * apareça no menu só pra mim que sou admin"). Mesma regra de
 * requirePlatformAdmin: role ADMIN e 2FA ligado = "admin" (leva pro /admin);
 * role ADMIN sem 2FA = "needs_2fa" (leva pra tela de ligar o 2FA, com aviso);
 * qualquer outra pessoa = null (o item nem é renderizado).
 * Sempre a partir da sessão do navegador (cookie), nunca de chave de API.
 */
export type AdminMenuState = "admin" | "needs_2fa" | null;

export function adminMenuState(user: Pick<SessionUser, "role" | "twoFactorEnabled"> | null | undefined): AdminMenuState {
  if (!user || user.role !== "ADMIN") return null;
  return needsTwoFactorSetup(user) ? "needs_2fa" : "admin";
}

/** Sessão do admin com 2FA ligado, ou null. */
export async function requirePlatformAdmin(): Promise<AppSession | null> {
  const session = await auth().catch(() => null);
  if (!session || session.user.role !== "ADMIN" || needsTwoFactorSetup(session.user)) return null;
  return session;
}
