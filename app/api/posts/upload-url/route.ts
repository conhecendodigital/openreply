import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok, requireContext } from "@/lib/api-helpers";
import { humanOnly } from "@/lib/flows/api";
import { MEDIA_UPLOAD_LIMIT, readFunnelJson, TOO_LARGE } from "@/lib/funnels/limits";
import { hitRateLimit } from "@/lib/http-rate-limit";
import { buildObjectKey, presignPut, readMediaStorageConfig } from "@/lib/media/s3";
import { UPLOAD_MAX_BYTES, UPLOAD_VIDEO_TYPES } from "@/lib/social/limits";

export const dynamic = "force-dynamic";

const EXT: Record<string, string> = { "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm" };

const bodySchema = z
  .object({
    contentType: z.enum(UPLOAD_VIDEO_TYPES),
    size: z.number().int().positive().max(UPLOAD_MAX_BYTES),
    name: z.string().trim().max(120).optional(),
  })
  .strict();

/**
 * Link assinado pra o navegador mandar o vídeo direto pro armazenamento.
 * Só pessoa logada (chave de API leva 403). Fica em <workspace>/posts/<mês>/<uuid>.<ext>:
 * é essa pasta que o publicador aceita como origem do vídeo.
 */
export async function POST(request: NextRequest) {
  const auth = await requireContext({ manage: true });
  if ("response" in auth) return auth.response;
  const blocked = await humanOnly("upload videos");
  if (blocked) return blocked;

  const config = readMediaStorageConfig();
  if (!config) return fail("File upload is not configured on this server", 503, { code: "not_configured" });

  const body = await readFunnelJson(request);
  if (body === TOO_LARGE) return fail("Too large", 413, { code: "too_large" });
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return fail("Video type or size not accepted", 400, { code: "invalid_body", issues: parsed.error.issues });

  const limited = await hitRateLimit("funnel-media", auth.context.userId, MEDIA_UPLOAD_LIMIT.limit, MEDIA_UPLOAD_LIMIT.windowSeconds);
  if (!limited.allowed) return fail("Too many uploads", 429, { code: "rate_limited" });

  const key = buildObjectKey({ workspaceId: auth.context.workspaceId, funnelId: "posts", ext: EXT[parsed.data.contentType] });
  const signed = presignPut(config, { key, contentType: parsed.data.contentType, size: parsed.data.size });
  return ok({ uploadUrl: signed.uploadUrl, publicUrl: signed.publicUrl, headers: signed.headers, expiresAt: signed.expiresAt });
}
