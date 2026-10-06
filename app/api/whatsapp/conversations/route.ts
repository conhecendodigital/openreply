import { NextRequest } from "next/server";
import { withPainel } from "@/lib/whatsapp/painel-http";
import { listConversations } from "@/lib/whatsapp/painel";

export const dynamic = "force-dynamic";

/** Lista do inbox: ?q= (nome, número ou texto), ?filter=unread|drafts, ?sessionId=, ?stage= (estágio do lead). */
export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  return withPainel({ action: "read WhatsApp" }, async (ctx, deps) => ({
    conversations: await listConversations(ctx, { q: p.get("q"), filter: p.get("filter"), sessionId: p.get("sessionId"), stage: p.get("stage") }, deps),
  }));
}
