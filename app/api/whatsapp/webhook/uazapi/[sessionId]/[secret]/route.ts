/**
 * Webhook da uazapi. A URL é registrada pelo Lead Engine em cada instância e
 * leva o id do número e um segredo dele (a uazapi não assina o corpo). A
 * lógica fica em lib/whatsapp/uazapi-webhook.ts.
 */
import { NextRequest, NextResponse } from "next/server";
import { ensureWhatsAppRuntime } from "@/lib/whatsapp/setup";
import { handleUazapiWebhook } from "@/lib/whatsapp/uazapi-webhook";
import { declaredTooLarge, MAX_WA_WEBHOOK_BYTES, readBodyLimited } from "@/lib/whatsapp/webhook";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ sessionId: string; secret: string }> };

function clientIp(request: NextRequest): string {
  return request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
}

export async function POST(request: NextRequest, { params }: RouteProps) {
  const runtime = ensureWhatsAppRuntime();
  if (!runtime) return NextResponse.json({ ok: false, error: "WhatsApp ainda não está ligado" }, { status: 503 });
  if (declaredTooLarge(request.headers)) {
    return NextResponse.json({ ok: false, error: "Corpo grande demais" }, { status: 413 });
  }
  const rawBody = await readBodyLimited(request.body, MAX_WA_WEBHOOK_BYTES);
  if (rawBody === null) return NextResponse.json({ ok: false, error: "Corpo grande demais" }, { status: 413 });
  const { sessionId, secret } = await params;
  const result = await handleUazapiWebhook(
    { headers: request.headers, rawBody, ip: clientIp(request), sessionId, secret },
    { repo: runtime.repo, queue: runtime.queue }
  );
  return NextResponse.json(result.body, { status: result.status });
}
