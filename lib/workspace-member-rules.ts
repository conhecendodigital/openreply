import type { WorkspaceRole } from "@/app/generated/prisma/client";

/**
 * Quem pode remover quem do workspace. Regra única, usada pela API
 * (DELETE /api/workspace/members) e pela tela de Configurações.
 *
 * - Ninguém remove o dono nem a si mesmo.
 * - O dono remove Admin e Membro.
 * - O Admin remove só Membro (nunca outro Admin).
 * - Membro não remove ninguém.
 */
export function canRemoveMember(
  actor: { role: WorkspaceRole; userId: string },
  target: { role: WorkspaceRole; userId: string }
): boolean {
  if (target.role === "OWNER") return false;
  if (target.userId === actor.userId) return false;
  if (actor.role === "OWNER") return true;
  if (actor.role === "ADMIN") return target.role === "MEMBER";
  return false;
}
