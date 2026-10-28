import { NextRequest } from "next/server";
import { mcpFlowToggle } from "@/lib/flows/mcp-actions";

export const dynamic = "force-dynamic";

/** Ligar fluxo (ligar_fluxo). A rota da tela segue com a regra dela; esta é só da chave (MCP). Interruptor: MCP_FLUXOS_DISABLED=1. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return mcpFlowToggle(request, (await params).id, true);
}
