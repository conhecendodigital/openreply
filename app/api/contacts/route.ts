import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import type { Prisma } from "@/app/generated/prisma/client";
import { intParam, ok, requireContext } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

// Counting 400k rows on every page is wasteful; past this the UI shows "10.000+".
const COUNT_CAP = 10_000;

const SORTS: Record<string, Prisma.ContactOrderByWithRelationInput[]> = {
  lastSeen: [{ lastSeenAt: "desc" }, { id: "desc" }],
  first: [{ firstSeenAt: "desc" }, { id: "desc" }],
  comments: [{ commentsCount: "desc" }, { lastSeenAt: "desc" }],
  clicks: [{ clicksCount: "desc" }, { lastSeenAt: "desc" }],
  dms: [{ dmsInCount: "desc" }, { lastSeenAt: "desc" }],
};

export async function GET(request: NextRequest) {
  const auth = await requireContext();
  if ("response" in auth) return auth.response;
  const { workspaceId } = auth.context;

  const params = request.nextUrl.searchParams;
  const page = intParam(params.get("page"), 1, 1, 10_000);
  const limit = intParam(params.get("limit"), 30, 1, 100);
  const instagramAccountId = params.get("instagramAccountId");
  const q = (params.get("q") ?? "").trim().replace(/^@/, "").slice(0, 100);
  const tag = (params.get("tag") ?? "").trim().slice(0, 60);
  const sort = SORTS[params.get("sort") ?? "lastSeen"] ?? SORTS.lastSeen;

  const where: Prisma.ContactWhereInput = {
    workspaceId,
    ...(instagramAccountId && instagramAccountId !== "all" ? { instagramAccountId } : {}),
    // "veio:*" filters by prefix (every conversation-link origin).
    ...(tag
      ? tag.endsWith("*")
        ? { tags: { some: { name: { startsWith: tag.slice(0, -1) } } } }
        : { tags: { some: { name: tag } } }
      : {}),
    ...(q
      ? {
          OR: [
            { username: { contains: q, mode: "insensitive" } },
            { name: { contains: q, mode: "insensitive" } },
            { igUserId: q },
          ],
        }
      : {}),
  };

  const [contacts, counted] = await Promise.all([
    prisma.contact.findMany({
      where,
      orderBy: sort,
      skip: (page - 1) * limit,
      take: limit,
      include: {
        tags: { select: { name: true, source: true }, orderBy: { createdAt: "asc" } },
        instagramAccount: { select: { username: true } },
      },
    }),
    prisma.contact.count({ where, take: COUNT_CAP + 1 }),
  ]);
  const total = Math.min(counted, COUNT_CAP);

  return ok({
    contacts,
    pagination: {
      page,
      limit,
      total,
      totalCapped: counted > COUNT_CAP,
      totalPages: Math.ceil(total / limit),
    },
  });
}
