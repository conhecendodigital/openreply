import { NextRequest } from "next/server";
import { fail, ok, readJson, requireContext } from "@/lib/api-helpers";
import { prisma } from "@/lib/db/client";
import { findPostableAccount } from "@/lib/social/accounts";
import { providerFor } from "@/lib/social/providers";
import { createPostSchema, mediaLimitsProblem, mediaUrlProblem, POST_INCLUDE, validateDraftSettings } from "@/lib/social/posts-api";
import { postDto } from "@/lib/tiktok/dto";
import { getApiCaller } from "@/lib/auth";
import { parseListQuery } from "@/lib/posts/list-query";
import { stripKidsAnswer, withKidsDefault } from "@/lib/social/youtube-kids-default";

export const dynamic = "force-dynamic";

const STATUSES = ["DRAFT", "SCHEDULED", "PUBLISHING", "PUBLISHED", "FAILED", "CANCELED"];

/**
 * 23/10/2026: lista os posts da aba Posts. `?status=` filtra.
 * 28/10/2026 (calendário, aditivo): `?from=&to=` (to exclusivo) traz só os posts agendados ou
 * publicados dentro do intervalo; `?limit=` (1 a 500, padrão 200). Mesma auth e mesmo workspace.
 */
export async function GET(request: NextRequest) {
  const auth = await requireContext();
  if ("response" in auth) return auth.response;
  const status = request.nextUrl.searchParams.get("status");
  if (status && !STATUSES.includes(status)) return fail("Invalid status", 400);
  const query = parseListQuery(request.nextUrl.searchParams);
  if (!query.ok) return fail(query.message, 400, { code: "invalid_query" });
  const range = query.from && query.to ? { gte: query.from, lt: query.to } : null;
  const rows = await prisma.scheduledPost.findMany({
    where: {
      workspaceId: auth.context.workspaceId,
      ...(status ? { status: status as never } : {}),
      ...(range ? { OR: [{ scheduledAt: range }, { publishedAt: range }] } : {}),
    },
    include: POST_INCLUDE,
    orderBy: [{ scheduledAt: "asc" }, { createdAt: "desc" }],
    take: query.limit,
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
  const caller = await getApiCaller();
  let settings: unknown = provider.defaultSettings;
  if (data.settings) {
    // A declaração "para crianças" é só da pessoa na tela: chave de API/MCP não consegue mandar.
    const incoming = caller.kind === "token" ? stripKidsAnswer(data.settings) : data.settings;
    const checked = validateDraftSettings(provider, incoming);
    if (!checked.ok) return fail("Invalid body", 400, { code: "invalid_body", issues: checked.issues });
    settings = checked.data;
    // Slides do carrossel (27/10): também têm que estar na pasta de posts deste workspace, já no rascunho.
    const slides = (settings as { slides?: { url: string }[] } | null)?.slides ?? [];
    for (const [index, slide] of slides.entries()) {
      const problem = mediaUrlProblem(auth.context.workspaceId, slide.url);
      if (problem) return fail(`Slide ${index + 1}: ${problem}`, 400, { code: "invalid_media" });
    }
  }

  // Padrão do canal (ligado pelo dono na tela): rascunho do YouTube sem resposta própria nasce "não é para crianças".
  if (account.platform === "YOUTUBE") settings = withKidsDefault(settings, account.youtubeNotForKidsDefault);

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
