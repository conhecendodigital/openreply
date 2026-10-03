/**
 * Shared bits of the /api/flows routes.
 *
 * Owner's rule: a flow sends DMs by itself, so only a signed-in human
 * publishes it or turns it on. An API key (the AI's MCP key, scripts) may
 * only read, create drafts, edit drafts and turn a flow OFF.
 */
import { prisma } from "@/lib/db/client";
import { fail } from "@/lib/api-helpers";
import { getApiCaller } from "@/lib/auth";

export const FLOW_SELECT = {
  id: true,
  workspaceId: true,
  name: true,
  isActive: true,
  instagramAccountId: true,
  draft: true,
  published: true,
  publishedVersion: true,
  publishedAt: true,
  triggerType: true,
  sourceAutomationId: true,
  enteredCount: true,
  completedCount: true,
  createdAt: true,
  updatedAt: true,
  instagramAccount: { select: { username: true, status: true } },
} as const;

export async function findFlow(id: string, workspaceId: string) {
  return prisma.flow.findFirst({ where: { id, workspaceId }, select: FLOW_SELECT });
}

/** 403 human_only for an API key; null for a signed-in human. */
export async function humanOnly(action: string) {
  if ((await getApiCaller()).kind === "token") {
    return fail(`API keys cannot ${action}. Do it in the Lead Engine.`, 403, { code: "human_only" });
  }
  return null;
}

export async function openRunsByFlow(flowIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (flowIds.length === 0) return map;
  const rows = await prisma.flowRun.groupBy({
    by: ["flowId"],
    where: { flowId: { in: flowIds }, status: { in: ["ACTIVE", "WAITING_DELAY", "WAITING_REPLY", "WAITING_TAP"] } },
    _count: { _all: true },
  });
  for (const r of rows ?? []) map.set(r.flowId, r._count._all);
  return map;
}
