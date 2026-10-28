import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok, readJson, requireContext } from "@/lib/api-helpers";
import { humanOnly } from "@/lib/flows/api";
import { postDto } from "@/lib/tiktok/dto";
import { schedulePostAction } from "@/lib/social/post-actions";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

const bodySchema = z.object({ scheduledAt: z.string().datetime() }).strict();

/** Marca o horário e passa pra SCHEDULED. Só pessoa logada: a chave de API só agenda pelo MCP (/api/mcp-publish). */
export async function POST(request: NextRequest, { params }: RouteProps) {
  const auth = await requireContext({ manage: true });
  if ("response" in auth) return auth.response;
  const blocked = await humanOnly("schedule posts");
  if (blocked) return blocked;

  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return fail("Pick a date and time", 400, { code: "invalid_body" });
  const { id } = await params;
  const result = await schedulePostAction(id, auth.context.workspaceId, new Date(parsed.data.scheduledAt));
  if (!result.ok) return fail(result.message, result.status, result.code ? { code: result.code } : undefined);
  return ok(postDto(result.post));
}
