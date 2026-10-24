import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok, readJson, requireContext } from "@/lib/api-helpers";
import { prisma } from "@/lib/db/client";
import { humanOnly } from "@/lib/flows/api";
import { postDto } from "@/lib/tiktok/dto";
import { EDITABLE, findPost, POST_INCLUDE, readyProblem } from "@/lib/social/posts-api";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

const bodySchema = z.object({ scheduledAt: z.string().datetime() }).strict();

/** Marca o horário e passa pra SCHEDULED. Só pessoa logada: a chave de API e o MCP não agendam. */
export async function POST(request: NextRequest, { params }: RouteProps) {
  const auth = await requireContext({ manage: true });
  if ("response" in auth) return auth.response;
  const blocked = await humanOnly("schedule posts");
  if (blocked) return blocked;

  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return fail("Pick a date and time", 400, { code: "invalid_body" });
  const when = new Date(parsed.data.scheduledAt);
  if (when.getTime() < Date.now() + 60_000) return fail("Pick a time in the future", 400, { code: "past_time" });

  const { id } = await params;
  const post = await findPost(id, auth.context.workspaceId);
  if (!post) return fail("Post not found", 404);
  if (!(EDITABLE as readonly string[]).includes(post.status)) return fail("This post can no longer be scheduled", 409, { code: "not_editable" });

  const problem = await readyProblem(post, true);
  if (problem) return fail(problem.message, 400, { code: problem.code });

  const updated = await prisma.scheduledPost.update({
    where: { id },
    data: { status: "SCHEDULED", scheduledAt: when, lastError: null, attempts: 0 },
    include: POST_INCLUDE,
  });
  return ok(postDto(updated));
}
