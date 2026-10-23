import { NextRequest } from "next/server";
import { fail, ok, readJson, requireContext } from "@/lib/api-helpers";
import { prisma } from "@/lib/db/client";
import { humanOnly } from "@/lib/flows/api";
import { findPostableAccount } from "@/lib/social/accounts";
import { providerFor } from "@/lib/social/providers";
import { EDITABLE, findPost, mediaLimitsProblem, mediaUrlProblem, POST_INCLUDE, updatePostSchema, validateDraftSettings } from "@/lib/social/posts-api";
import { postDto } from "@/lib/tiktok/dto";

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
  let account: Awaited<ReturnType<typeof findPostableAccount>> = null;
  const currentAccountId = post.socialAccountId ?? post.channelId;
  if (data.socialAccountId && data.socialAccountId !== currentAccountId) {
    account = await findPostableAccount(auth.context.workspaceId, data.socialAccountId);
    if (!account) return fail("Account not found", 404);
  }

  // Legenda, vídeo e opções valem pela rede final do post (a nova conta, se trocou).
  const provider = providerFor(account?.platform ?? post.platform ?? "TIKTOK");
  const limits = mediaLimitsProblem(provider, {
    caption: data.caption ?? post.caption,
    mediaBytes: data.mediaBytes ?? post.mediaBytes,
    mediaContentType: data.mediaContentType ?? post.mediaContentType,
  });
  if (limits) return fail(limits, 400, { code: "invalid_media" });
  let settings: unknown;
  if (data.settings) {
    const checked = validateDraftSettings(provider, data.settings);
    if (!checked.ok) return fail("Invalid body", 400, { code: "invalid_body", issues: checked.issues });
    settings = checked.data;
  } else if (account && account.platform !== (post.platform ?? "TIKTOK")) {
    // Trocou de rede sem mandar opções novas: volta para as opções padrão da nova rede.
    settings = provider.defaultSettings;
  }

  const updated = await prisma.scheduledPost.update({
    where: { id },
    data: {
      ...(account
        ? {
            socialAccountId: account.source === "social" ? account.id : null,
            channelId: account.source === "channel" ? account.id : null,
            platform: account.platform,
          }
        : {}),
      ...(data.caption !== undefined ? { caption: data.caption } : {}),
      ...(data.mediaUrl ? { mediaUrl: data.mediaUrl } : {}),
      ...(data.mediaBytes ? { mediaBytes: data.mediaBytes } : {}),
      ...(data.mediaContentType ? { mediaContentType: data.mediaContentType } : {}),
      ...(settings !== undefined ? { settings: settings as never } : {}),
      ...(data.scheduledAt !== undefined ? { scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null } : {}),
      ...(post.status === "FAILED" ? { status: "DRAFT" as const, lastError: null } : {}),
    },
    include: POST_INCLUDE,
  });
  return ok(postDto(updated));
}

/** Apaga o post (rascunho, agendado, com falha ou já publicado: só o registro, o vídeo na rede continua). Só pessoa logada. */
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
