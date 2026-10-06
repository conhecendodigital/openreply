/**
 * Fase 0: estado de segurança da conta (tem senha? Google ligado? 2FA?), pra
 * tela de Segurança e pro aviso de "crie sua senha" no primeiro acesso.
 */
import { prisma } from "@/lib/db/client";

export const SKIP_PASSWORD_COOKIE = "le_skip_password";

export type SecurityState = {
  hasPassword: boolean;
  hasGoogle: boolean;
};

export async function getSecurityState(userId: string): Promise<SecurityState> {
  const accounts = await prisma.authAccount.findMany({
    where: { userId },
    select: { providerId: true, password: true },
  });
  return {
    hasPassword: accounts.some((a) => a.providerId === "credential" && Boolean(a.password)),
    hasGoogle: accounts.some((a) => a.providerId === "google"),
  };
}

/**
 * Primeiro acesso de quem só tinha o link: ainda sem senha e sem Google, e não
 * pediu "agora não" nesta máquina.
 */
export function shouldOfferPassword(state: SecurityState, skipped: boolean): boolean {
  return !state.hasPassword && !state.hasGoogle && !skipped;
}
