import { NextRequest } from "next/server";
import { mcpCampaignToggle } from "@/lib/flows/mcp-actions";

export const dynamic = "force-dynamic";

/** Desligar campanha (desativar_automacao). A rota da tela segue com a regra dela; esta é só da chave (MCP). Interruptor: MCP_FLUXOS_DISABLED=1. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return mcpCampaignToggle(request, (await params).id, false);
}
