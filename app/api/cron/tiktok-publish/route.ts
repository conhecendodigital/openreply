import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { sweepTikTokPosts } from "@/lib/tiktok/publish";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * A cada 5 minutos (scripts/cron.sh): publica os posts do TikTok agendados que
 * venceram, retoma os que pararam no meio do envio e confere com o TikTok os
 * que já foram enviados. Idempotente (cada post é pego por troca de status).
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get("authorization"))) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const result = await sweepTikTokPosts();
  return NextResponse.json({ success: true, data: result });
}
