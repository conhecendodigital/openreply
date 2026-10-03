import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { ok, requireContext } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

// Every tag in use, with how many contacts carry it (for the filter chips).
export async function GET(request: NextRequest) {
  const auth = await requireContext();
  if ("response" in auth) return auth.response;
  const { workspaceId } = auth.context;
  const instagramAccountId = request.nextUrl.searchParams.get("instagramAccountId");

  const rows = await prisma.contactTag.groupBy({
    by: ["name"],
    where: {
      workspaceId,
      ...(instagramAccountId && instagramAccountId !== "all"
        ? { contact: { instagramAccountId } }
        : {}),
    },
    _count: { _all: true },
    orderBy: { _count: { name: "desc" } },
    take: 300,
  });

  return ok(rows.map((r) => ({ name: r.name, count: r._count._all })));
}
