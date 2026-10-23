import { NextRequest } from "next/server";
import { after } from "next/server";
import { fail, ok, requireContext } from "@/lib/api-helpers";
import { prisma } from "@/lib/db/client";
import { humanOnly } from "@/lib/flows/api";
import { postDto } from "@/lib/tiktok/dto";
import { EDITABLE, findPost, readyProblem } from "@/lib/tiktok/posts-api";
import { claimPost, runClaimedPost } from "@/lib/tiktok/publish";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type RouteProps = { params: Promise<{ id: string }> };

/** "Publicar agora". Só pessoa logada. O envio do vídeo roda depois da resposta; a tela acompanha pelo status. */
export async function POST(_request: NextRequest, { params }: RouteProps) {
  const auth = await requireContext({ manage: true });
  if ("response" in auth) return auth.response;
  const blocked = await humanOnly("publish posts");
  if (blocked) return blocked;

  const { id } = await params;
  const post = await findPost(id, auth.context.workspaceId);
  if (!post) return fail("Post not found", 404);
  if (!(EDITABLE as readonly string[]).includes(post.status)) return fail("This post can no longer be published", 409, { code: "not_editable" });

  const problem = await readyProblem(post, true);
  if (problem) return fail(problem.message, 400, { code: problem.code });

  if (!(await claimPost(id))) return fail("This post is already being published", 409, { code: "publishing" });
  after(async () => {
    try {
      await runClaimedPost(id);
    } catch (error) {
      console.error("[TikTok publish] unexpected", id, error instanceof Error ? error.message : error);
      await prisma.scheduledPost
        .update({ where: { id }, data: { status: "FAILED", lockedAt: null, lastError: "Unexpected error while publishing" } })
        .catch(() => {});
    }
  });
  const current = await findPost(id, auth.context.workspaceId);
  return ok(postDto(current ?? { ...post, status: "PUBLISHING" }), 202);
}

