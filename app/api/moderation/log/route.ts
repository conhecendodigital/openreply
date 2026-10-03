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

  return ok({
    logs: rows,
    counts: Object.fromEntries(byAction.map((r) => [r.action, r._count._all])),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}
