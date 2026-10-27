import { NextRequest } from "next/server";
import { mcpSchedule } from "@/lib/social/mcp-post-actions";

export const dynamic = "force-dynamic";

/** Agendar pelo MCP (agendar_post). A rota da tela, /api/posts/[id]/schedule, segue só da pessoa logada. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return mcpSchedule(request, (await params).id);
}
