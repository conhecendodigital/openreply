import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok, requireContext } from "@/lib/api-helpers";
import { readFunnelJson, TOO_LARGE } from "@/lib/funnels/limits";
import { findFunnel, humanOnly, presentFunnelDetail } from "@/lib/funnels/api";
import { funnelStats7d, unpublishFunnel } from "@/lib/funnels/service";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

const bodySchema = z.object({ archive: z.boolean().optional() }).strict();

// Off the air (DRAFT, or ARCHIVED with archive: true). Human only. The last
// published version stays saved: publishing again brings it back.
export async function POST(request: NextRequest, { params }: RouteProps) {
  const auth = await requireContext({ manage: true });
  if ("response" in auth) return auth.response;
  const blocked = await humanOnly("unpublish quizzes");
  if (blocked) return blocked;
  const { id } = await params;
  const row = await findFunnel(id, auth.context.workspaceId);
  if (!row) return fail("Funnel not found", 404);
  const body = await readFunnelJson(request);
  if (body === TOO_LARGE) return fail("Too large", 413, { code: "too_large" });
  const parsed = bodySchema.safeParse(body ?? {});
  if (!parsed.success) return fail("Invalid body", 400, parsed.error.issues);
  const updated = await unpublishFunnel({ funnel: row, archive: parsed.data.archive === true });
  const stats = await funnelStats7d([row.id]);
  return ok(presentFunnelDetail(updated, stats.get(row.id)));
}
