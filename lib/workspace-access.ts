import type { Workspace, WorkspaceRole } from "@/app/generated/prisma/client";
import { headers } from "next/headers";
import { getCurrentUserId } from "@/lib/auth";
import { resolveApiToken } from "@/lib/api-token-auth";
import { prisma } from "@/lib/db/client";
import { ensureWorkspaceForUser } from "@/lib/workspace";

export type WorkspaceContext = {
  userId: string;
  workspaceId: string;
  workspace: Workspace;
  role: WorkspaceRole;
};

const ROLE_ORDER: Record<WorkspaceRole, number> = {
  MEMBER: 1,
  ADMIN: 2,
  OWNER: 3,
};

export function hasWorkspaceRole(
  role: WorkspaceRole,
  minimumRole: WorkspaceRole
) {
  return ROLE_ORDER[role] >= ROLE_ORDER[minimumRole];
}

export function canManageWorkspace(role: WorkspaceRole) {
  return hasWorkspaceRole(role, "ADMIN");
}

export function canManageBilling(role: WorkspaceRole) {
  return role === "OWNER";
}

/**
 * Workspace a Settings API key was created in, when this request carries one.
 * undefined = no key (session, or outside a request); null = the deploy-level
 * key or an invalid header (no binding).
 */
async function apiKeyWorkspaceId(): Promise<string | null | undefined> {
  let authorization: string | null = null;
  try {
    authorization = (await headers()).get("authorization");
  } catch {
    return undefined;
  }
  if (!authorization) return undefined;
  return (await resolveApiToken(authorization))?.workspaceId ?? null;
}

export async function getCurrentWorkspaceContext(): Promise<WorkspaceContext | null> {
  const userId = await getCurrentUserId();
  if (!userId) return null;

  // Auditoria 05/10: a Settings key acts only in the workspace it was created
  // in. Its owner's oldest membership could be another workspace.
  const keyWorkspaceId = await apiKeyWorkspaceId();
  if (keyWorkspaceId) {
    const bound = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: keyWorkspaceId, userId } },
      include: { workspace: true },
    });
    if (!bound) return null;
    return { userId, workspaceId: bound.workspaceId, workspace: bound.workspace, role: bound.role };
  }

  const membership = await prisma.workspaceMember.findFirst({
    where: { userId },
    include: { workspace: true },
    orderBy: { createdAt: "asc" },
  });

  if (membership) {
    return {
      userId,
      workspaceId: membership.workspaceId,
      workspace: membership.workspace,
      role: membership.role,
    };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  const workspace = await ensureWorkspaceForUser(userId, user?.email);
  const createdMembership = await prisma.workspaceMember.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId: workspace.id,
        userId,
      },
    },
  });

  return {
    userId,
    workspaceId: workspace.id,
    workspace,
    role: createdMembership?.role ?? "OWNER",
  };
}

