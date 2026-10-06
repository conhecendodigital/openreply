/**
 * Webhook do WhatsApp (OpenWA e Cloud API oficial).
 *
 * Só aceita requisição assinada: X-OpenWA-Signature (segredo do número) ou
 * X-Hub-Signature-256 (segredo do app Meta). Não está em lib/api-key-routes.ts:
 * chave de API não chega aqui. A lógica fica em lib/whatsapp/webhook.ts.
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyTokenMatches } from "@/lib/meta/webhook-guards";
import { getWhatsAppRuntime, metaAppSecretsFromEnv } from "@/lib/whatsapp/runtime";
import { declaredTooLarge, handleWhatsAppWebhook, MAX_WA_WEBHOOK_BYTES, readBodyLimited } from "@/lib/whatsapp/webhook";

export const dynamic = "force-dynamic";

function clientIp(request: NextRequest): string {
  return (
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    ""
  );
}

/** Verificação do webhook pela Meta (hub.challenge). */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  if (
    params.get("hub.mode") === "subscribe" &&
    verifyTokenMatches(params.get("hub.verify_token"), process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN)
  ) {
    return new NextResponse(params.get("hub.challenge"), { status: 200 });
  }
  return NextResponse.json({ ok: false, error: "Verificação falhou" }, { status: 403 });
}

export async function POST(request: NextRequest) {
  const runtime = getWhatsAppRuntime();
  if (!runtime) return NextResponse.json({ ok: false, error: "WhatsApp ainda não está ligado" }, { status: 503 });

  // Recusa antes de ler o corpo quando o tamanho declarado já passa do limite.
  if (declaredTooLarge(request.headers)) {
    return NextResponse.json({ ok: false, error: "Corpo grande demais" }, { status: 413 });
  }
  // Lê aos pedaços e para no limite (corpo sem content-length também).
  const rawBody = await readBodyLimited(request.body, MAX_WA_WEBHOOK_BYTES);
  if (rawBody === null) {
    return NextResponse.json({ ok: false, error: "Corpo grande demais" }, { status: 413 });
  }

  const result = await handleWhatsAppWebhook(
    { headers: request.headers, rawBody, ip: clientIp(request) },
    { repo: runtime.repo, queue: runtime.queue, metaAppSecrets: metaAppSecretsFromEnv() }
  );
  return NextResponse.json(result.body, { status: result.status });
}
