/**
 * Quem pode entrar.
 *
 * 28/10/2026 (pedido do dono): o login é ABERTO por padrão. Qualquer e-mail
 * recebe o link e cria conta, sem ALLOWED_EMAILS, BetaAllowlist ou convite
 * como requisito. Antes, quem não estava nas listas era barrado em silêncio
 * e nenhum e-mail saía.
 *
 * Interruptor de emergência: SIGNIN_RESTRICTED=1 (ou true/yes/on) volta ao
 * comportamento antigo (ALLOWED_EMAILS, BetaAllowlist ou convite de workspace),
 * sem mexer em código. Convites e a lista beta continuam existindo: o convite
 * ainda leva a pessoa pro workspace dele (lib/workspace.ts), só não é mais
 * requisito pra receber o link.
 *
 * O limite de links por e-mail (e por IP) vale nos dois modos.
 */
import { isEmailAllowedToSignIn } from "@/lib/env";
import { hitRateLimit, MAGIC_LINK_LIMIT } from "@/lib/http-rate-limit";

/**
 * Owner's rule (2026-10-04): with ALLOWED_EMAILS set, someone the owner invited
 * still gets in. An open invitation (PENDING, not expired), or an accepted one
 * whose team the person is still on, counts as allowed. Anyone else stays out.
 */
export async function hasWorkspaceAccess(email: string): Promise<boolean> {
  const { prisma } = await import("@/lib/db/client");
  const address = email.trim();
  const invite = await prisma.workspaceInvitation.findFirst({
    where: {
      email: { equals: address, mode: "insensitive" },
      status: "PENDING",
      expiresAt: { gt: new Date() },
    },
    select: { id: true },
  });
  if (invite) return true;
  // Accepted an invitation and is still on THAT team. A plain membership is
  // not enough: while ALLOWED_EMAILS was empty anyone could sign up and own a
  // workspace of their own.
  const accepted = await prisma.workspaceInvitation.findMany({
    where: { email: { equals: address, mode: "insensitive" }, status: "ACCEPTED" },
    select: { workspaceId: true },
    take: 20,
  });
  if (accepted.length === 0) return false;
  const member = await prisma.workspaceMember.findFirst({
    where: {
      workspaceId: { in: accepted.map((a) => a.workspaceId) },
      user: { email: { equals: address, mode: "insensitive" } },
    },
    select: { id: true },
  });
  return Boolean(member);
}

/** Está na tabela BetaAllowlist (sempre em minúsculo). */
export async function isOnBetaAllowlist(email: string): Promise<boolean> {
  const { prisma } = await import("@/lib/db/client");
  const row = await prisma.betaAllowlist.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { email: true },
  });
  return Boolean(row);
}

/** Beta ou convite de workspace. */
export async function hasSignInAccess(email: string): Promise<boolean> {
  if (await isOnBetaAllowlist(email)) return true;
  return hasWorkspaceAccess(email);
}

/**
 * true quando nenhuma lista está configurada (nem ALLOWED_EMAILS, nem uma
 * linha na BetaAllowlist). Erro no banco = fechado.
 */
export async function isSignInOpen(): Promise<boolean> {
  const envList = (process.env.ALLOWED_EMAILS ?? "").split(",").map((e) => e.trim()).filter(Boolean);
  if (envList.length) return false;
  try {
    const { prisma } = await import("@/lib/db/client");
    const count = await prisma.betaAllowlist.count();
    return !count;
  } catch {
    return false;
  }
}

/** SIGNIN_RESTRICTED ligado = cadastro fechado pelas listas (comportamento antigo). */
export function isSignInRestricted(env: Record<string, string | undefined> = process.env): boolean {
  return /^(1|true|yes|on)$/i.test((env.SIGNIN_RESTRICTED ?? "").trim());
}

export async function allowSignIn(
  params: {
    user?: { email?: string | null } | null;
    email?: { verificationRequest?: boolean } | null;
  },
  accessLookup: (email: string) => Promise<boolean> = hasSignInAccess,
  openLookup: () => Promise<boolean> = isSignInOpen
): Promise<boolean> {
  const address = params.user?.email;
  if (!address || !address.trim()) return false;
  if (isSignInRestricted()) {
    // Interruptor ligado: ALLOWED_EMAILS vazio deixa todo mundo passar no
    // isEmailAllowedToSignIn; uma linha na BetaAllowlist também fecha o login.
    const envListSet = Boolean((process.env.ALLOWED_EMAILS ?? "").replace(/[\s,]/g, ""));
    const allowed = envListSet ? isEmailAllowedToSignIn(address) : await openLookup();
    if (!allowed) {
      // Fora da lista: só entra quem foi convidado ou já está numa equipe.
      // Erro no banco = fechado (nenhum link sai).
      const invited = await accessLookup(address).catch(() => false);
      if (!invited) return false;
    }
  }
  // At most a few magic links per address per hour: stops e-mail bombing
  // and protects the Resend quota. Verifying a link is never limited.
  if (params.email?.verificationRequest && address) {
    const check = await hitRateLimit(
      "magic-link",
      address,
      MAGIC_LINK_LIMIT.limit,
      MAGIC_LINK_LIMIT.windowSeconds
    );
    if (!check.allowed) return false;
  }
  return true;
}
