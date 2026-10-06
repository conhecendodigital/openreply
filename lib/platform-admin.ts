/**
 * Fase 0: admin da plataforma (o dono do Lead Engine). Não é o papel dentro de
 * um workspace: vem de User.role = ADMIN no banco.
 */
import { auth, needsTwoFactorSetup, type AppSession } from "@/lib/auth";

/** No beta: 10 usuários + o admin. */
export const BETA_ALLOWLIST_LIMIT = 11;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeAllowlistEmail(value: unknown): string | null {
  const email = String(value ?? "").trim().toLowerCase();
  return EMAIL.test(email) && email.length <= 254 ? email : null;
}

/** Sessão do admin com 2FA ligado, ou null. */
export async function requirePlatformAdmin(): Promise<AppSession | null> {
  const session = await auth().catch(() => null);
  if (!session || session.user.role !== "ADMIN" || needsTwoFactorSetup(session.user)) return null;
  return session;
}
