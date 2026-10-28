import { NextRequest } from "next/server";
import { mcpCampaignToggle } from "@/lib/flows/mcp-actions";

export const dynamic = "force-dynamic";

/** Ligar campanha (ativar_automacao). A rota da tela segue com a regra dela; esta é só da chave (MCP). Interruptor: MCP_FLUXOS_DISABLED=1. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return mcpCampaignToggle(request, (await params).id, true);
}
