import { NextRequest } from "next/server";
import { readJson } from "@/lib/api-helpers";
import { withPainel } from "@/lib/whatsapp/painel-http";
import { setConversationAgent } from "@/lib/whatsapp/painel";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

/** { action: "pause" | "resume" | "auto_on" | "auto_off" } pro agente de IA nessa conversa. */
export async function POST(request: NextRequest, { params }: RouteProps) {
  const { id } = await params;
  const body = ((await readJson(request)) ?? {}) as Record<string, unknown>;
  return withPainel({ action: "change the WhatsApp agent" }, (ctx, deps) =>
    setConversationAgent(ctx, id, { action: body.action, hours: body.hours }, deps)
  );
}
