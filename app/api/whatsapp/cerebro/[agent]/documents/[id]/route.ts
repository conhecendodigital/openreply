import { NextRequest } from "next/server";
import { fail, ok, requireContext } from "@/lib/api-helpers";
import { humanOnly } from "@/lib/flows/api";
import { cerebroForUser } from "@/lib/whatsapp/cerebro/service";
import { isAgentKind } from "@/lib/whatsapp/cerebro/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteProps = { params: Promise<{ agent: string; id: string }> };

/** Apaga um PDF e os pedaços dele. Só com sessão, só dono ou admin do workspace. */
export async function DELETE(_request: NextRequest, { params }: RouteProps) {
  const auth = await requireContext({ manage: true });
  if ("response" in auth) return auth.response;
  const blocked = await humanOnly("delete files");
  if (blocked) return blocked;

  const { agent, id } = await params;
  if (!isAgentKind(agent)) return fail("Agente inválido", 404, { code: "invalid_agent" });

  const { store } = cerebroForUser(auth.context.userId);
  const doc = await store.getDocument(id, auth.context.workspaceId);
  if (!doc || doc.agentKind !== agent) return fail("PDF não encontrado", 404, { code: "not_found" });
  await store.deleteDocument(id, auth.context.workspaceId);
  return ok({ deleted: true });
}
