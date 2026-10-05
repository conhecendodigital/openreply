import { NextRequest } from "next/server";
import { fail, ok, requireContext } from "@/lib/api-helpers";
import { prisma } from "@/lib/db/client";
import { findFunnel, humanOnly } from "@/lib/funnels/api";
import {
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  mediaPublicBase,
  type FunnelMediaItem,
  type MediaUploadConfig,
} from "@/lib/funnels/media";
import { readMediaStorageConfig } from "@/lib/media/s3";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

/**
 * Upload settings of the editor (is upload on? which base is ours?) and the
 * files already sent in this workspace, newest first, to pick again.
 */
export async function GET(_request: NextRequest, { params }: RouteProps) {
  const auth = await requireContext();
  if ("response" in auth) return auth.response;
  const blocked = await humanOnly("list uploaded files");
  if (blocked) return blocked;
  const { id } = await params;
  const funnel = await findFunnel(id, auth.context.workspaceId);
  if (!funnel) return fail("Funnel not found", 404);

  const enabled = readMediaStorageConfig() !== null;
  const config: MediaUploadConfig = {
    enabled,
    publicBaseUrl: mediaPublicBase(),
    maxImageBytes: MAX_IMAGE_BYTES,
    maxVideoBytes: MAX_VIDEO_BYTES,
  };

  const rows = await prisma.funnelMedia.findMany({
    where: { workspaceId: auth.context.workspaceId, uploadedAt: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 60,
    select: { id: true, url: true, kind: true, contentType: true, size: true, name: true, createdAt: true },
  });
  const files: FunnelMediaItem[] = (rows ?? []).map((r) => ({
    id: r.id,
    url: r.url,
    kind: r.kind === "video" ? "video" : "image",
    contentType: r.contentType,
    size: r.size,
    name: r.name ?? null,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
  }));
  return ok({ ...config, files });
}
