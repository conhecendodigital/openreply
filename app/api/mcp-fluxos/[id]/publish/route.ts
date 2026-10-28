import { NextRequest } from "next/server";
import { mcpFlowPublish } from "@/lib/flows/mcp-actions";

export const dynamic = "force-dynamic";

/** Publicar fluxo (publicar_fluxo). A rota da tela segue com a regra dela; esta é só da chave (MCP). Interruptor: MCP_FLUXOS_DISABLED=1. */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return mcpFlowPublish((await params).id);
}
