import { NextRequest } from "next/server";
import { readJson } from "@/lib/api-helpers";
import { withPainel } from "@/lib/whatsapp/painel-http";
import { decideDraft } from "@/lib/whatsapp/painel";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

/** { action: "approve", bubbles?: string[] } ou { action: "reject" } no rascunho do agente. */
export async function POST(request: NextRequest, { params }: RouteProps) {
  const { id } = await params;
  const body = ((await readJson(request)) ?? {}) as Record<string, unknown>;
  return withPainel({ action: "approve WhatsApp drafts" }, (ctx, deps) => decideDraft(ctx, id, { action: body.action, bubbles: body.bubbles }, deps));
}
