import { NextRequest } from "next/server";
import { fail, ok, requireContext } from "@/lib/api-helpers";
import { findFunnel, humanOnly, presentFunnelDetail } from "@/lib/funnels/api";
import { funnelStats7d, publishFunnel } from "@/lib/funnels/service";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

// Publish = the draft becomes the public page. Human only (session): an API
// key gets 403 human_only (here and in proxy.ts). Anything still missing
// (brackets, price, checkout link...) blocks with fix_before_publish.
export async function POST(_request: NextRequest, { params }: RouteProps) {
  const auth = await requireContext({ manage: true });
  if ("response" in auth) return auth.response;
  const blocked = await humanOnly("publish quizzes");
  if (blocked) return blocked;
  const { id } = await params;
  const row = await findFunnel(id, auth.context.workspaceId);
  if (!row) return fail("Funnel not found", 404);

  const result = await publishFunnel({ funnel: row, userId: auth.context.userId ?? null });
  if (!result.ok) {
    if (!result.validation) return fail("Invalid funnel definition", 400, { code: "invalid_funnel", issues: result.issues });
    return fail("Fix the quiz before publishing", 400, { code: "fix_before_publish", validation: result.validation });
  }
  const stats = await funnelStats7d([row.id]);
  return ok({ ...presentFunnelDetail(result.row, stats.get(row.id)), warnings: result.validation.warnings });
}
