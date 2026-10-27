import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok, requireContext } from "@/lib/api-helpers";
import { getApiCaller } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { readFunnelJson, TOO_LARGE } from "@/lib/funnels/limits";
import { hitRateLimit } from "@/lib/http-rate-limit";
import { buildObjectKey, presignPut, readMediaStorageConfig } from "@/lib/media/s3";
import { UPLOAD_IMAGE_MAX_BYTES, UPLOAD_IMAGE_TYPES, UPLOAD_MAX_BYTES, UPLOAD_VIDEO_TYPES } from "@/lib/social/limits";

export const dynamic = "force-dynamic";

/** 27/10/2026: link de envio só para a ferramenta enviar_midia_post do MCP. */
export const MCP_MEDIA_LIMIT = { limit: 30, windowSeconds: 60 * 60 };
/** Link curto: dá tempo de subir um vídeo grande, não de guardar o link. */
export const MCP_MEDIA_EXPIRES_SECONDS = 15 * 60;

const EXT: Record<string, string> = { "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm", "image/jpeg": "jpg", "image/png": "png" };

/** Nome só para a auditoria: sem pasta, sem "..", sem caractere de controle. O arquivo no armazenamento nunca usa esse nome. */
export function isPlainFileName(name: string): boolean {
  if (!name || name.length > 120) return false;
  if (name.includes("/") || name.includes("\\") || name.includes("..") || name.includes("\0")) return false;
  if (/[\u0000-\u001f\u007f]/.test(name)) return false;
  return name.trim() === name && name !== ".";
}

const bodySchema = z
  .object({
    name: z.string().refine(isPlainFileName, "Invalid file name"),
    contentType: z.enum([...UPLOAD_VIDEO_TYPES, ...UPLOAD_IMAGE_TYPES]),
    size: z.number().int().positive().max(UPLOAD_MAX_BYTES),
  })
  .strict()
  .refine((b) => !b.contentType.startsWith("image/") || b.size <= UPLOAD_IMAGE_MAX_BYTES, { path: ["size"], message: "Image too large" });

/**
 * Link assinado de envio (PUT) pedido pelo MCP. A rota /api/posts/upload-url continua só da
 * pessoa logada; esta é só de chave de API (o MCP). Pessoa logada recebe 403: usa a tela.
 * Só gera o link: não cria post nenhum. Cada pedido fica no registro (OperationalEvent), sem o arquivo.
 */
export async function POST(request: NextRequest) {
  const auth = await requireContext({ manage: true });
  if ("response" in auth) return auth.response;
  const caller = await getApiCaller();
  if (caller.kind !== "token") return fail("This link is for the MCP only. In the app, use the Posts tab.", 403, { code: "api_key_only" });
  if (!caller.tokenId) return fail("Unauthorized", 401);

  const config = readMediaStorageConfig();
  if (!config) return fail("File upload is not configured on this server", 503, { code: "not_configured" });

  const body = await readFunnelJson(request);
  if (body === TOO_LARGE) return fail("Too large", 413, { code: "too_large" });
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return fail("File name, type or size not accepted", 400, { code: "invalid_body", issues: parsed.error.issues });

  // Falha fechado: sem o contador (Redis fora) não gera link novo (count 0 só acontece quando o contador falhou).
  const limited = await hitRateLimit("mcp-media", caller.tokenId, MCP_MEDIA_LIMIT.limit, MCP_MEDIA_LIMIT.windowSeconds);
  if (!limited.allowed) return fail("Too many uploads from this key. Try again in an hour.", 429, { code: "rate_limited" });
  if (limited.count === 0) return fail("Upload limit could not be checked. Try again in a minute.", 503, { code: "limit_unavailable" });

  const { name, contentType, size } = parsed.data;
  const key = buildObjectKey({ workspaceId: auth.context.workspaceId, funnelId: "posts", ext: EXT[contentType] });
  const signed = presignPut(config, { key, contentType, size, expiresSeconds: MCP_MEDIA_EXPIRES_SECONDS });

  // Auditoria obrigatória: se não gravou, não entrega o link.
  try {
    await prisma.operationalEvent.create({
      data: {
        workspaceId: auth.context.workspaceId,
        source: "SYSTEM",
        level: "INFO",
        message: "MCP: link de envio de mídia de post gerado",
        payload: { tokenId: caller.tokenId, userId: auth.context.userId, name, contentType, size, key },
      },
    });
  } catch {
    return fail("Could not record the upload request. Try again.", 500, { code: "audit_failed" });
  }

  return ok({
    uploadUrl: signed.uploadUrl,
    mediaUrl: signed.publicUrl,
    mediaBytes: size,
    mediaContentType: contentType,
    headers: signed.headers,
    expiresAt: signed.expiresAt,
  });
}
