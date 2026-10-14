import { NextRequest } from "next/server";
import { withPainelLeitura } from "@/lib/whatsapp/painel-http";
import { listConversations } from "@/lib/whatsapp/painel";

export const dynamic = "force-dynamic";

/** Lista do inbox: ?q= (nome, número ou texto), ?filter=unread|drafts, ?sessionId=, ?stage= (estágio do lead), ?kind=chats|groups (sem kind: tudo). */
export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  return withPainelLeitura(async (ctx, deps) => ({
    conversations: await listConversations(ctx, { q: p.get("q"), filter: p.get("filter"), sessionId: p.get("sessionId"), stage: p.get("stage"), kind: p.get("kind") }, deps),
  }));
}
