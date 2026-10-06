/**
 * Quem pode entrar (allowlist), separado do login pra dar pra testar.
 *
 * Fase 0 (06/10/2026, login novo): vale pros três caminhos (senha, Google e
 * link por e-mail). Roda antes de mandar o link (verificationRequest = true),
 * então um e-mail barrado nunca recebe nada, e de novo sempre que uma sessão
 * vai ser criada (lib/auth-config.ts).
 *
 * Entra quem está no ALLOWED_EMAILS, na tabela BetaAllowlist (o beta) ou foi
 * convidado pra um workspace. Com as duas listas vazias, fica aberto como era
 * antes (instalação nova de quem hospeda o próprio Lead Engine).
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

export async function allowSignIn(
  params: {
    user?: { email?: string | null } | null;
    email?: { verificationRequest?: boolean } | null;
  },
  accessLookup: (email: string) => Promise<boolean> = hasSignInAccess,
  openLookup: () => Promise<boolean> = isSignInOpen
): Promise<boolean> {
  const address = params.user?.email;
  // ALLOWED_EMAILS vazio deixa todo mundo passar no isEmailAllowedToSignIn;
  // agora uma linha na BetaAllowlist também fecha o login.
  const envListSet = Boolean((process.env.ALLOWED_EMAILS ?? "").replace(/[\s,]/g, ""));
  const allowed = envListSet ? isEmailAllowedToSignIn(address) : await openLookup();
  if (!allowed) {
    if (!address) return false;
    // Not on the list: let in only who was invited or already is on a team.
    // A database hiccup fails closed (no link is sent).
    const invited = await accessLookup(address).catch(() => false);
    if (!invited) return false;
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
