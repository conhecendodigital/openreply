import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok, requireContext } from "@/lib/api-helpers";
import { prisma } from "@/lib/db/client";
import { findFunnel, humanOnly } from "@/lib/funnels/api";
import { MEDIA_UPLOAD_LIMIT, readFunnelJson, TOO_LARGE } from "@/lib/funnels/limits";
import { checkMediaFile, MAX_VIDEO_BYTES } from "@/lib/funnels/media";
import { hitRateLimit } from "@/lib/http-rate-limit";
import { buildObjectKey, presignPut, readMediaStorageConfig } from "@/lib/media/s3";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

const bodySchema = z
  .object({
    contentType: z.string().trim().min(1).max(100),
    size: z.number().int().positive().max(MAX_VIDEO_BYTES * 2),
    kind: z.enum(["image", "video"]).optional(),
    /** Original name, only shown in the list. Never part of the object key. */
    name: z.string().trim().max(120).optional(),
  })
  .strict();

const cleanName = (name: string | undefined) => {
  const s = (name ?? "").replace(/[\u0000-\u001f\u007f<>"'`\\/]/g, "").trim().slice(0, 120);
  return s || null;
};

/**
 * Pre-signed PUT for one file of the quiz editor (the browser sends it straight
 * to the storage). Signed-in person of the workspace that owns the quiz only:
 * an API key gets 403 (also blocked in proxy.ts, the route is not in
 * lib/api-key-routes.ts). 60 per hour per user.
 */
export async function POST(request: NextRequest, { params }: RouteProps) {
  const auth = await requireContext({ manage: true });
  if ("response" in auth) return auth.response;
  const blocked = await humanOnly("upload files");
  if (blocked) return blocked;

  const config = readMediaStorageConfig();
  if (!config) return fail("File upload is not configured on this server", 503, { code: "not_configured" });

  const { id } = await params;
  const funnel = await findFunnel(id, auth.context.workspaceId);
  if (!funnel) return fail("Funnel not found", 404);

  const body = await readFunnelJson(request);
  if (body === TOO_LARGE) return fail("Too large", 413, { code: "too_large" });
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return fail("Invalid body", 400, { code: "invalid_funnel", issues: parsed.error.issues });

  const check = checkMediaFile({ type: parsed.data.contentType, size: parsed.data.size }, parsed.data.kind);
  if (!check.ok) {
    return fail(check.code === "media_type" ? "File type not accepted" : "File too large", 400, { code: check.code });
  }

  const limited = await hitRateLimit("funnel-media", auth.context.userId, MEDIA_UPLOAD_LIMIT.limit, MEDIA_UPLOAD_LIMIT.windowSeconds);
  if (!limited.allowed) return fail("Too many uploads", 429, { code: "rate_limited" });

  const key = buildObjectKey({ workspaceId: funnel.workspaceId, funnelId: funnel.id, ext: check.ext });
  const signed = presignPut(config, { key, contentType: check.contentType, size: parsed.data.size });

  const media = await prisma.funnelMedia.create({
    data: {
      workspaceId: funnel.workspaceId,
      funnelId: funnel.id,
      key,
      url: signed.publicUrl,
      kind: check.kind,
      contentType: check.contentType,
      size: parsed.data.size,
      name: cleanName(parsed.data.name),
      createdBy: auth.context.userId,
    },
    select: { id: true },
  });

  return ok({
    uploadUrl: signed.uploadUrl,
    publicUrl: signed.publicUrl,
    headers: signed.headers,
    expiresAt: signed.expiresAt,
    mediaId: media?.id ?? null,
  });
}
