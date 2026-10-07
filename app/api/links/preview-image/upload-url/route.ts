import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok, requireContext } from "@/lib/api-helpers";
import { humanOnly } from "@/lib/flows/api";
import { MEDIA_UPLOAD_LIMIT, readFunnelJson, TOO_LARGE } from "@/lib/funnels/limits";
import { checkMediaFile, MAX_IMAGE_BYTES } from "@/lib/funnels/media";
import { hitRateLimit } from "@/lib/http-rate-limit";
import { buildObjectKey, presignPut, readMediaStorageConfig } from "@/lib/media/s3";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    contentType: z.string().trim().min(1).max(100),
    size: z.number().int().positive().max(MAX_IMAGE_BYTES * 2),
    kind: z.literal("image").optional(),
    name: z.string().trim().max(120).optional(),
  })
  .strict();

/**
 * Pre-signed PUT for the preview image of a tracked link (07/10/2026). Same
 * storage and checks as the quiz files: image only (JPG, PNG, WebP, GIF up
 * to 15 MB), the key never has the file's name. Owner or admin, signed in
 * (an API key gets 403). Shares the 60 per hour per user of the quiz files.
 */
export async function POST(request: NextRequest) {
  const auth = await requireContext({ manage: true });
  if ("response" in auth) return auth.response;
  const blocked = await humanOnly("upload files");
  if (blocked) return blocked;

  const config = readMediaStorageConfig();
  if (!config) return fail("File upload is not configured on this server", 503, { code: "not_configured" });

  const body = await readFunnelJson(request);
  if (body === TOO_LARGE) return fail("Too large", 413, { code: "too_large" });
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return fail("Invalid body", 400, { code: "invalid_body", issues: parsed.error.issues });

  const check = checkMediaFile({ type: parsed.data.contentType, size: parsed.data.size }, "image");
  if (!check.ok) {
    return fail(check.code === "media_type" ? "File type not accepted" : "File too large", 400, { code: check.code });
  }

  const limited = await hitRateLimit("funnel-media", auth.context.userId, MEDIA_UPLOAD_LIMIT.limit, MEDIA_UPLOAD_LIMIT.windowSeconds);
  if (!limited.allowed) return fail("Too many uploads", 429, { code: "rate_limited" });

  // <workspace>/links/<aaaa-mm>/<uuid>.<ext>
  const key = buildObjectKey({ workspaceId: auth.context.workspaceId, funnelId: "links", ext: check.ext });
  const signed = presignPut(config, { key, contentType: check.contentType, size: parsed.data.size });
  return ok({
    uploadUrl: signed.uploadUrl,
    publicUrl: signed.publicUrl,
    headers: signed.headers,
    expiresAt: signed.expiresAt,
    mediaId: null,
  });
}
