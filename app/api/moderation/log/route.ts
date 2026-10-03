import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { ModerationAction, type Prisma } from "@/app/generated/prisma/client";
import { intParam, ok, requireContext } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireContext();
  if ("response" in auth) return auth.response;
  const { workspaceId } = auth.context;

  const params = request.nextUrl.searchParams;
  const page = intParam(params.get("page"), 1, 1, 10_000);
  const limit = intParam(params.get("limit"), 20, 1, 100);
  const action = params.get("action");
  const instagramAccountId = params.get("instagramAccountId");
  const parsedAction =
    action && Object.values(ModerationAction).includes(action as ModerationAction)
      ? (action as ModerationAction)
      : null;

  const where: Prisma.CommentModerationWhereInput = {
    workspaceId,
    ...(parsedAction ? { action: parsedAction } : {}),
    ...(instagramAccountId && instagramAccountId !== "all" ? { instagramAccountId } : {}),
  };

  const [rows, total, byAction] = await Promise.all([
    prisma.commentModeration.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: { instagramAccount: { select: { username: true } } },
    }),
    prisma.commentModeration.count({ where }),
    prisma.commentModeration.groupBy({
      by: ["action"],
      where: { ...where, action: undefined },
      _count: { _all: true },
    }),
  ]);

  // The commenter's contact (name / photo / @ filled later by the profile
  // lookup), for the "unknown user" fallback. No relation in the schema:
  // joined by (account, IGSID). Never breaks the log.
  let contacts = new Map<string, { id: string; username: string | null; name: string | null; profilePicUrl: string | null }>();
  try {
    const found = rows.length
      ? await prisma.contact.findMany({
          where: {
            workspaceId,
            OR: rows.map((r) => ({ instagramAccountId: r.instagramAccountId, igUserId: r.commenterIgId })),
          },
          select: { id: true, instagramAccountId: true, igUserId: true, username: true, name: true, profilePicUrl: true },
        })
      : [];
    contacts = new Map(
      found.map((c) => [
        `${c.instagramAccountId}:${c.igUserId}`,
        { id: c.id, username: c.username, name: c.name, profilePicUrl: c.profilePicUrl },
      ])
    );
  } catch (error) {
    console.warn("[Moderation log] Could not join contacts:", error instanceof Error ? error.message : error);
  }

  return ok({
    logs: rows.map((r) => ({ ...r, contact: contacts.get(`${r.instagramAccountId}:${r.commenterIgId}`) ?? null })),
    counts: Object.fromEntries(byAction.map((r) => [r.action, r._count._all])),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}
