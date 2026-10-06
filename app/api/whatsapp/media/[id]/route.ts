import { NextRequest, NextResponse } from "next/server";
import { fail, requireContext } from "@/lib/api-helpers";
import { humanOnly } from "@/lib/flows/api";
import { messageMedia, PainelError } from "@/lib/whatsapp/painel";
import { painelDeps } from "@/lib/whatsapp/painel-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteProps = { params: Promise<{ id: string }> };

/**
 * Foto, vídeo, áudio ou arquivo de uma mensagem, buscado no gateway na hora
 * (o navegador nunca fala com o gateway). Tipo desconhecido vai como download.
 */
export async function GET(_request: NextRequest, { params }: RouteProps) {
  const auth = await requireContext();
  if ("response" in auth) return auth.response;
  const blocked = await humanOnly("read WhatsApp media");
  if (blocked) return blocked;
  const { id } = await params;
  try {
    const media = await messageMedia({ userId: auth.context.userId, workspaceId: auth.context.workspaceId }, id, painelDeps());
    const name = (media.filename ?? "arquivo").replace(/[^\w.\- ]+/g, "_").slice(0, 80) || "arquivo";
    return new NextResponse(Buffer.from(media.bytes), {
      status: 200,
      headers: {
        "Content-Type": media.contentType,
        "Content-Disposition": `${media.inline ? "inline" : "attachment"}; filename="${name}"`,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    if (error instanceof PainelError) return fail(error.message, error.status, { code: error.code });
    return fail("Media not found.", 404, { code: "not_found" });
  }
}
