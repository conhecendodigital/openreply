import { NextRequest } from "next/server";
import { mcpPublish } from "@/lib/social/mcp-post-actions";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Publicar agora pelo MCP (publicar_post). A rota da tela, /api/posts/[id]/publish, segue só da pessoa logada. */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return mcpPublish((await params).id);
}
