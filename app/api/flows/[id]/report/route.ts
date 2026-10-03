import { NextRequest } from "next/server";
import { fail, ok, requireContext } from "@/lib/api-helpers";
import { findFlow } from "@/lib/flows/api";
import { flowReport } from "@/lib/flows/service";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

// Per node: how many passed, outcomes (sent / yes / no / ...), link clicks,
// and where runs stopped or are waiting right now.
export async function GET(_request: NextRequest, { params }: RouteProps) {
  const auth = await requireContext();
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const flow = await findFlow(id, auth.context.workspaceId);
  if (!flow) return fail("Flow not found", 404);
  const report = await flowReport(flow.id);
  return ok({
    flowId: flow.id,
    entered: flow.enteredCount,
    completed: flow.completedCount,
    ...report,
  });
}
