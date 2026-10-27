import { NextRequest } from "next/server";
import { fail, ok, requireContext } from "@/lib/api-helpers";
import { humanOnly } from "@/lib/flows/api";
import { postDto } from "@/lib/tiktok/dto";
import { publishPostAction } from "@/lib/social/post-actions";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type RouteProps = { params: Promise<{ id: string }> };

/** "Publicar agora". Só pessoa logada (a chave só publica pelo MCP, /api/mcp-publish). O envio roda depois da resposta; a tela acompanha pelo status. */
export async function POST(_request: NextRequest, { params }: RouteProps) {
  const auth = await requireContext({ manage: true });
  if ("response" in auth) return auth.response;
  const blocked = await humanOnly("publish posts");
  if (blocked) return blocked;

  const { id } = await params;
  const result = await publishPostAction(id, auth.context.workspaceId);
  if (!result.ok) return fail(result.message, result.status, result.code ? { code: result.code } : undefined);
  return ok(postDto(result.post), 202);
}
