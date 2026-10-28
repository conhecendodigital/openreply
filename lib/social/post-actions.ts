/**
 * 27/10/2026: agendar e publicar agora, num lugar só. As rotas da tela
 * (/api/posts/[id]/schedule e /publish, só pessoa logada) e as do MCP (/api/mcp-publish, só chave)
 * chamam estas funções: a regra (readyProblem, claimPost, lock) não é duplicada.
 */
import { after } from "next/server";
import { prisma } from "@/lib/db/client";
import { EDITABLE, findPost, POST_INCLUDE, readyProblem } from "@/lib/social/posts-api";
import { claimPost, runClaimedPost } from "@/lib/social/publish";
import { hasOwnKidsAnswer, withKidsDefault } from "@/lib/social/youtube-kids-default";

type Post = NonNullable<Awaited<ReturnType<typeof findPost>>>;
export type ActionResult = { ok: true; post: Post } | { ok: false; status: number; message: string; code?: string };

/**
 * Padrão do canal do YouTube (ligado pelo dono na tela): vídeo sem resposta própria vira "não é para crianças".
 * Só se aplica com o padrão LIGADO e sem resposta no vídeo; a resposta do vídeo sempre prevalece.
 * Devolve o post com as opções resolvidas e se precisa gravá-las (o cron publica lendo do banco).
 */
function resolveKidsDefault(post: Post): { post: Post; persist: boolean } {
  const on = post.platform === "YOUTUBE" && post.socialAccount?.youtubeNotForKidsDefault === true;
  if (!on || hasOwnKidsAnswer(post.settings)) return { post, persist: false };
  return { post: { ...post, settings: withKidsDefault(post.settings, true) } as Post, persist: true };
}

export async function schedulePostAction(id: string, workspaceId: string, when: Date): Promise<ActionResult> {
  if (when.getTime() < Date.now() + 60_000) return { ok: false, status: 400, message: "Pick a time in the future", code: "past_time" };
  const post = await findPost(id, workspaceId);
  if (!post) return { ok: false, status: 404, message: "Post not found" };
  if (!(EDITABLE as readonly string[]).includes(post.status)) return { ok: false, status: 409, message: "This post can no longer be scheduled", code: "not_editable" };
  const resolved = resolveKidsDefault(post);
  const problem = await readyProblem(resolved.post, true);
  if (problem) return { ok: false, status: 400, message: problem.message, code: problem.code };
  const updated = await prisma.scheduledPost.update({
    where: { id },
    data: { status: "SCHEDULED", scheduledAt: when, lastError: null, attempts: 0, ...(resolved.persist ? { settings: resolved.post.settings as never } : {}) },
    include: POST_INCLUDE,
  });
  return { ok: true, post: updated as unknown as Post };
}

export async function publishPostAction(id: string, workspaceId: string): Promise<ActionResult> {
  const post = await findPost(id, workspaceId);
  if (!post) return { ok: false, status: 404, message: "Post not found" };
  if (!(EDITABLE as readonly string[]).includes(post.status)) return { ok: false, status: 409, message: "This post can no longer be published", code: "not_editable" };
  const resolved = resolveKidsDefault(post);
  const problem = await readyProblem(resolved.post, true);
  if (problem) return { ok: false, status: 400, message: problem.message, code: problem.code };
  // O envio lê as opções do banco: grava o padrão do canal antes de pegar o post.
  if (resolved.persist) await prisma.scheduledPost.update({ where: { id }, data: { settings: resolved.post.settings as never } });
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
