/**
 * Shared bits of the /api/segments and /api/broadcasts routes.
 *
 * Owner's rule (same as flows): a broadcast sends DMs, so only a signed-in
 * OWNER/ADMIN sends or schedules it, turns an A/B on or declares a winner.
 * An API key (the AI's MCP key, scripts) may read, create/edit segments,
 * create/edit DRAFT broadcasts and cancel (stopping is always safe).
 */
import { prisma } from "@/lib/db/client";
import { getApiCaller } from "@/lib/auth";
import { parseFilters, type SegmentFilters } from "@/lib/segments/filters";

export { humanOnly } from "@/lib/flows/api";

export async function callerVia(): Promise<"session" | "mcp"> {
  return (await getApiCaller()).kind === "token" ? "mcp" : "session";
}

export const SEGMENT_SELECT = {
  id: true,
  workspaceId: true,
  instagramAccountId: true,
  name: true,
  filters: true,
  createdBy: true,
  createdVia: true,
  lastCount: true,
  lastCountAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type SegmentRow = {
  id: string;
  workspaceId: string;
  instagramAccountId: string | null;
  name: string;
  filters: unknown;
  createdBy: string | null;
  createdVia: string;
  lastCount: number | null;
  lastCountAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export function presentSegment(s: SegmentRow, count?: unknown) {
  const filters: SegmentFilters = parseFilters(s.filters);
  return {
    id: s.id,
    name: s.name,
    instagramAccountId: s.instagramAccountId,
    filters,
    createdVia: s.createdVia,
    lastCount: s.lastCount,
    lastCountAt: s.lastCountAt,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    ...(count !== undefined ? { count } : {}),
  };
}

export async function findSegment(id: string, workspaceId: string) {
  return prisma.segment.findFirst({ where: { id, workspaceId }, select: SEGMENT_SELECT });
}

/** The account must belong to the workspace; null/"all" = every account. */
export async function workspaceAccountId(workspaceId: string, id: string | null | undefined) {
  if (!id || id === "all") return { ok: true as const, id: null };
  const account = await prisma.instagramAccount.findFirst({ where: { id, workspaceId }, select: { id: true } });
  return account ? { ok: true as const, id: account.id } : { ok: false as const };
}
