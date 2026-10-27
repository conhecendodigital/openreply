/**
 * 27/10/2026: agendar e publicar agora, num lugar só. As rotas da tela
 * (/api/posts/[id]/schedule e /publish, só pessoa logada) e as do MCP (/api/mcp-publish, só chave)
 * chamam estas funções: a regra (readyProblem, claimPost, lock) não é duplicada.
 */
import { after } from "next/server";
import { prisma } from "@/lib/db/client";
import { EDITABLE, findPost, POST_INCLUDE, readyProblem } from "@/lib/social/posts-api";
import { claimPost, runClaimedPost } from "@/lib/social/publish";

type Post = NonNullable<Awaited<ReturnType<typeof findPost>>>;
export type ActionResult = { ok: true; post: Post } | { ok: false; status: number; message: string; code?: string };

export async function schedulePostAction(id: string, workspaceId: string, when: Date): Promise<ActionResult> {
  if (when.getTime() < Date.now() + 60_000) return { ok: false, status: 400, message: "Pick a time in the future", code: "past_time" };
  const post = await findPost(id, workspaceId);
  if (!post) return { ok: false, status: 404, message: "Post not found" };
  if (!(EDITABLE as readonly string[]).includes(post.status)) return { ok: false, status: 409, message: "This post can no longer be scheduled", code: "not_editable" };
  const problem = await readyProblem(post, true);
  if (problem) return { ok: false, status: 400, message: problem.message, code: problem.code };
  const updated = await prisma.scheduledPost.update({
    where: { id },
    data: { status: "SCHEDULED", scheduledAt: when, lastError: null, attempts: 0 },
    include: POST_INCLUDE,
  });
  return { ok: true, post: updated as unknown as Post };
}

export async function publishPostAction(id: string, workspaceId: string): Promise<ActionResult> {
  const post = await findPost(id, workspaceId);
  if (!post) return { ok: false, status: 404, message: "Post not found" };
  if (!(EDITABLE as readonly string[]).includes(post.status)) return { ok: false, status: 409, message: "This post can no longer be published", code: "not_editable" };
  const problem = await readyProblem(post, true);
  if (problem) return { ok: false, status: 400, message: problem.message, code: problem.code };
  if (!(await claimPost(id))) return { ok: false, status: 409, message: "This post is already being published", code: "publishing" };
  after(async () => {
    try {
      await runClaimedPost(id);
    } catch (error) {
      console.error("[social publish] unexpected", id, error instanceof Error ? error.message : error);
      await prisma.scheduledPost
        .update({ where: { id }, data: { status: "FAILED", lockedAt: null, lastError: "Unexpected error while publishing" } })
        .catch(() => {});
    }
  });
  const current = await findPost(id, workspaceId);
  return { ok: true, post: current ?? ({ ...post, status: "PUBLISHING" } as Post) };
}
