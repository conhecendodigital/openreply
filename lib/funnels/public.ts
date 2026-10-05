/**
 * Etapa 6: what the public page /q/<slug> reads (server-only).
 *
 * Live = only status PUBLISHED with a valid `published` copy; anything else
 * is null (404, without saying whether a draft exists). The preview of the
 * draft is only for a signed-in user of the same workspace (version 0, the
 * player records nothing).
 */
import { prisma } from "@/lib/db/client";
import type { PublicFunnel } from "@/lib/funnels/types";
import { definitionOrNull } from "@/lib/funnels/schema";
import { toPublicFunnel } from "@/lib/funnels/render";
import { isValidSlug } from "@/lib/funnels/slug";
import { PIXEL_ID_RE, type StoredCapiSettings } from "@/lib/meta/capi";

const SELECT = {
  id: true,
  workspaceId: true,
  name: true,
  slug: true,
  status: true,
  draft: true,
  published: true,
  publishedVersion: true,
} as const;

/**
 * `capi` = the account's Pixel/Conversions API settings (token still
 * encrypted). Server-only: getPublishedFunnelBySlug strips it (and the
 * workspace) before anything reaches the browser.
 */
export type LivePublicFunnel = PublicFunnel & { workspaceId: string; capi?: StoredCapiSettings | null };

const CAPI_SELECT = {
  workspace: { select: { metaCapi: { select: { pixelId: true, accessTokenEnc: true, testEventCode: true } } } },
} as const;

/** Quiz without its own Pixel id uses the account default Pixel. */
export function withAccountPixel<T extends PublicFunnel>(funnel: T, accountPixelId: string | null | undefined): T {
  const own = funnel.settings.pixelId?.trim();
  if (own || !accountPixelId || !PIXEL_ID_RE.test(accountPixelId)) return funnel;
  return { ...funnel, settings: { ...funnel.settings, pixelId: accountPixelId } };
}

/** Live funnel + its workspace (for the tracking APIs). */
export async function getLiveFunnel(slug: string): Promise<LivePublicFunnel | null> {
  if (!isValidSlug(slug)) return null;
  const row = await prisma.funnel.findUnique({ where: { slug }, select: { ...SELECT, ...CAPI_SELECT } });
  if (!row || row.status !== "PUBLISHED") return null;
  const definition = definitionOrNull(row.published);
  if (!definition) return null;
  const capi = row.workspace?.metaCapi ?? null;
  const funnel = withAccountPixel(
    toPublicFunnel({
      id: row.id,
      slug: row.slug,
      name: row.name,
      version: row.publishedVersion,
      definition,
    }),
    capi?.pixelId
  );
  return { ...funnel, workspaceId: row.workspaceId, capi };
}

export async function getPublishedFunnelBySlug(slug: string): Promise<PublicFunnel | null> {
  const live = await getLiveFunnel(slug);
  if (!live) return null;
  const { workspaceId: _ws, capi: _capi, ...funnel } = live;
  void _ws;
  void _capi;
  return funnel;
}

export async function getDraftPreview(slug: string, workspaceId: string): Promise<PublicFunnel | null> {
  if (!isValidSlug(slug) || !workspaceId) return null;
  const row = await prisma.funnel.findFirst({ where: { slug, workspaceId }, select: SELECT });
  if (!row) return null;
  const definition = definitionOrNull(row.draft);
  if (!definition) return null;
  return toPublicFunnel({ id: row.id, slug: row.slug, name: row.name, version: 0, definition });
}
