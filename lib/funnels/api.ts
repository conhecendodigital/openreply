/**
 * Etapa 6: shared bits of the /api/funnels routes (server-only).
 *
 * Owner's rule (same as campaigns and flows): an API key (the AI's MCP key)
 * creates and edits funnels, and every funnel is born DRAFT. Publishing,
 * unpublishing, archiving, deleting and reading or exporting leads (personal
 * data) happen only with a signed-in human: humanOnly() answers 403 to a key.
 */
import type { z } from "zod";
import { prisma } from "@/lib/db/client";
import type { FunnelDetail, FunnelStatus, FunnelSummary } from "@/lib/funnels/types";
import { definitionOrNull } from "@/lib/funnels/schema";
import { validateFunnel } from "@/lib/funnels/validate";

export { humanOnly } from "@/lib/flows/api";

export const FUNNEL_SELECT = {
  id: true,
  workspaceId: true,
  name: true,
  slug: true,
  status: true,
  draft: true,
  published: true,
  publishedVersion: true,
  publishedAt: true,
  templateId: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type FunnelRow = {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  status: FunnelStatus | string;
  draft: unknown;
  published: unknown;
  publishedVersion: number;
  publishedAt: Date | string | null;
  templateId: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type FunnelStats = FunnelSummary["stats"];
export const EMPTY_STATS: FunnelStats = { visits7d: 0, checkouts7d: 0, leads7d: 0 };

export async function findFunnel(id: string, workspaceId: string): Promise<FunnelRow | null> {
  return prisma.funnel.findFirst({ where: { id, workspaceId }, select: FUNNEL_SELECT });
}

const iso = (d: Date | string | null | undefined): string | null =>
  d === null || d === undefined ? null : d instanceof Date ? d.toISOString() : String(d);

export function hasUnpublishedChanges(row: Pick<FunnelRow, "draft" | "published">): boolean {
  if (row.published === null || row.published === undefined) return false;
  return JSON.stringify(row.draft) !== JSON.stringify(row.published);
}

export function publicPath(slug: string): string {
  return `/q/${slug}`;
}

export function presentFunnelSummary(row: FunnelRow, stats: FunnelStats = EMPTY_STATS): FunnelSummary {
  const draft = definitionOrNull(row.draft);
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: (row.status as FunnelStatus) ?? "DRAFT",
    publishedVersion: row.publishedVersion ?? 0,
    publishedAt: iso(row.publishedAt),
    hasUnpublishedChanges: hasUnpublishedChanges(row),
    stepCount: draft?.steps.length ?? 0,
    templateId: row.templateId ?? null,
    publicPath: publicPath(row.slug),
    createdAt: iso(row.createdAt) ?? "",
    updatedAt: iso(row.updatedAt) ?? "",
    stats,
  };
}

export function presentFunnelDetail(row: FunnelRow, stats: FunnelStats = EMPTY_STATS): FunnelDetail {
  const draft = definitionOrNull(row.draft);
  const published = definitionOrNull(row.published);
  return {
    ...presentFunnelSummary(row, stats),
    // A broken draft in the database still opens (the editor fixes it).
    draft: draft ?? (row.draft as FunnelDetail["draft"]),
    published,
    validation: draft
      ? validateFunnel(draft)
      : { ok: false, errors: [{ code: "no_steps", level: "error" }], warnings: [] },
  };
}

/** Body fields that would change what is live: refused with draft_only. */
export const LIVE_KEYS = ["status", "published", "publishedVersion", "publishedAt", "publishedBy"];

export function liveKeyError(error: z.ZodError): boolean {
  return error.issues.some((i) => i.code === "unrecognized_keys" && i.keys.some((k) => LIVE_KEYS.includes(k)));
}
