import { NextRequest } from "next/server";
import { fail, ok, readJson, requireContext } from "@/lib/api-helpers";
import { prisma } from "@/lib/db/client";
import { humanOnly } from "@/lib/flows/api";
import { postDto } from "@/lib/tiktok/dto";
import { EDITABLE, findPost, mediaUrlProblem, POST_INCLUDE, updatePostSchema } from "@/lib/tiktok/posts-api";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteProps) {
  const auth = await requireContext();
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const post = await findPost(id, auth.context.workspaceId);
  if (!post) return fail("Post not found", 404);
  return ok(postDto(post));
}

/** Edita um post que ainda não saiu (rascunho, agendado ou com falha). Não agenda nem publica. */
export async function PATCH(request: NextRequest, { params }: RouteProps) {
  const auth = await requireContext({ manage: true });
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const post = await findPost(id, auth.context.workspaceId);
  if (!post) return fail("Post not found", 404);
  if (!(EDITABLE as readonly string[]).includes(post.status)) return fail("This post can no longer be edited", 409, { code: "not_editable" });

  const parsed = updatePostSchema.safeParse(await readJson(request));
  if (!parsed.success) return fail("Invalid body", 400, { code: "invalid_body", issues: parsed.error.issues });
  const data = parsed.data;

  // Mexer num agendado pelo caminho da chave de API seria agendar por fora: só pessoa logada.
  if (post.status === "SCHEDULED") {
    const blocked = await humanOnly("change a scheduled post");
    if (blocked) return blocked;
  }
  if (data.scheduledAt !== undefined) {
    const blocked = await humanOnly("set the schedule");
    if (blocked) return blocked;
  }
  if (data.mediaUrl) {
    const problem = mediaUrlProblem(auth.context.workspaceId, data.mediaUrl);
    if (problem) return fail(problem, 400, { code: "invalid_media" });
  }

  // A tela deixa trocar a conta do rascunho: a nova conta tem que ser deste workspace e estar conectada.
  let account: { id: string; platform: string } | null = null;
  if (data.socialAccountId && data.socialAccountId !== post.socialAccountId) {
    account = await prisma.socialAccount.findFirst({
      where: { id: data.socialAccountId, workspaceId: auth.context.workspaceId, status: { not: "DISCONNECTED" } },
      select: { id: true, platform: true },
    });
    if (!account) return fail("Account not found", 404);
  }

  const updated = await prisma.scheduledPost.update({
    where: { id },
    data: {
      ...(account ? { socialAccountId: account.id, platform: account.platform } : {}),
      ...(data.caption !== undefined ? { caption: data.caption } : {}),
      ...(data.mediaUrl ? { mediaUrl: data.mediaUrl } : {}),
      ...(data.mediaBytes ? { mediaBytes: data.mediaBytes } : {}),
      ...(data.mediaContentType ? { mediaContentType: data.mediaContentType } : {}),
      ...(data.settings ? { settings: data.settings } : {}),
      ...(data.scheduledAt !== undefined ? { scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null } : {}),
      ...(post.status === "FAILED" ? { status: "DRAFT" as const, lastError: null } : {}),
    },
    include: POST_INCLUDE,
  });
  return ok(postDto(updated));
}

/** Apaga o post (rascunho, agendado, com falha ou já publicado: só o registro, o vídeo no TikTok continua). Só pessoa logada. */
export async function DELETE(_request: NextRequest, { params }: RouteProps) {
  const auth = await requireContext({ manage: true });
  if ("response" in auth) return auth.response;
  const blocked = await humanOnly("delete posts");
  if (blocked) return blocked;
  const { id } = await params;
  const post = await findPost(id, auth.context.workspaceId);
  if (!post) return fail("Post not found", 404);
  if (post.status === "PUBLISHING") return fail("This post is being published right now", 409, { code: "publishing" });
  await prisma.scheduledPost.delete({ where: { id } });
  return ok({ id });
}
