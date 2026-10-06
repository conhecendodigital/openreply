import { NextRequest } from "next/server";
import { readJson } from "@/lib/api-helpers";
import { withPainel } from "@/lib/whatsapp/painel-http";
import { decideSuggestion } from "@/lib/whatsapp/regras/painel";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

/** { action: "accept" | "reject" }. Aceitar é o clique do dono que muda a regra. Só dono ou admin do workspace. */
export async function POST(request: NextRequest, { params }: RouteProps) {
  const { id } = await params;
  const body = ((await readJson(request)) ?? {}) as Record<string, unknown>;
  return withPainel({ manage: true, action: "change the WhatsApp agents" }, (ctx, deps) => decideSuggestion(ctx, id, { action: body.action }, deps));
}
