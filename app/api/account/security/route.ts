/**
 * Fase 0: o que a tela de Segurança precisa saber da conta logada. Só pela
 * sessão do navegador (chave de API não chega aqui, ver proxy.ts).
 */
import { auth } from "@/lib/auth";
import { fail, ok } from "@/lib/api-helpers";
import { getSecurityState } from "@/lib/account-security";
import { isGoogleLoginConfigured } from "@/lib/better-auth";

export async function GET() {
  const session = await auth();
  if (!session) return fail("Unauthorized", 401);
  const state = await getSecurityState(session.user.id);
  return ok({
    email: session.user.email,
    role: session.user.role,
    twoFactorEnabled: session.user.twoFactorEnabled,
    twoFactorRequired: session.user.role === "ADMIN",
    googleEnabled: isGoogleLoginConfigured(),
    ...state,
  });
}
