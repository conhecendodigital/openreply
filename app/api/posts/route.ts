import { NextRequest } from "next/server";
import { fail, ok, readJson, requireContext } from "@/lib/api-helpers";
import { prisma } from "@/lib/db/client";
import { findPostableAccount } from "@/lib/social/accounts";
import { providerFor } from "@/lib/social/providers";
import { createPostSchema, mediaLimitsProblem, mediaUrlProblem, POST_INCLUDE, validateDraftSettings } from "@/lib/social/posts-api";
import { postDto } from "@/lib/tiktok/dto";
import { getApiCaller } from "@/lib/auth";

export const dynamic = "force-dynamic";

const STATUSES = ["DRAFT", "SCHEDULED", "PUBLISHING", "PUBLISHED", "FAILED", "CANCELED"];

/** 23/10/2026: lista os posts da aba Posts. `?status=` filtra. */
export async function GET(request: NextRequest) {
  const auth = await requireContext();
  if ("response" in auth) return auth.response;
  const status = request.nextUrl.searchParams.get("status");
  if (status && !STATUSES.includes(status)) return fail("Invalid status", 400);
  const rows = await prisma.scheduledPost.findMany({
    where: { workspaceId: auth.context.workspaceId, ...(status ? { status: status as never } : {}) },
    include: POST_INCLUDE,
    orderBy: [{ scheduledAt: "asc" }, { createdAt: "desc" }],
    take: 200,
  });
  return ok((rows ?? []).map(postDto));
}

/**
 * Cria SEMPRE um rascunho. Agendar e publicar são ações só da pessoa, na tela
 * (/schedule e /publish), nunca pela chave de API nem pelo MCP.
 */
export async function POST(request: NextRequest) {
  const auth = await requireContext({ manage: true });
  if ("response" in auth) return auth.response;

  const parsed = createPostSchema.safeParse(await readJson(request));
  if (!parsed.success) return fail("Invalid body", 400, { code: "invalid_body", issues: parsed.error.issues });
  const data = parsed.data;

  // A conta pode ser de TikTok/YouTube (SocialAccount) ou de Instagram/Facebook (canal).
  const account = await findPostableAccount(auth.context.workspaceId, data.socialAccountId);
  if (!account) return fail("Account not found", 404);
  const provider = providerFor(account.platform);

  const urlProblem = mediaUrlProblem(auth.context.workspaceId, data.mediaUrl);
  if (urlProblem) return fail(urlProblem, 400, { code: "invalid_media" });
  const limits = mediaLimitsProblem(provider, data);
  if (limits) return fail(limits, 400, { code: "invalid_media" });
  let settings: unknown = provider.defaultSettings;
  if (data.settings) {
    const checked = validateDraftSettings(provider, data.settings);
    if (!checked.ok) return fail("Invalid body", 400, { code: "invalid_body", issues: checked.issues });
    settings = checked.data;
  }

  const caller = await getApiCaller();
  const created = await prisma.scheduledPost.create({
    data: {
      workspaceId: auth.context.workspaceId,
      socialAccountId: account.source === "social" ? account.id : null,
      channelId: account.source === "channel" ? account.id : null,
      platform: account.platform,
      status: "DRAFT",
      caption: data.caption,
      mediaUrl: data.mediaUrl,
      mediaBytes: data.mediaBytes,
      mediaContentType: data.mediaContentType,
      settings: settings as never,
      scheduledAt: null,
      createdVia: caller.kind === "token" ? "MCP" : "UI",
      createdBy: auth.context.userId,
    },
    include: POST_INCLUDE,
  });
  return ok(postDto(created), 201);
}
