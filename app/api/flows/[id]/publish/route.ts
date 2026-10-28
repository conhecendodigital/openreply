import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { fail, ok, requireContext } from "@/lib/api-helpers";
import { FLOW_SELECT, findFlow, humanOnly, openRunsByFlow } from "@/lib/flows/api";
import { findCampaignConflicts, presentFlow, publishFlowChecked } from "@/lib/flows/service";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

// Publish = the draft becomes what runs. Human only (session): an API key
// gets 403 human_only. A flow that is on starts using the new version on its
// next step; one that is off stays off.
export async function POST(_request: NextRequest, { params }: RouteProps) {
  const auth = await requireContext({ manage: true });
  if ("response" in auth) return auth.response;
  const blocked = await humanOnly("publish flows");
  if (blocked) return blocked;
  const { id } = await params;
  const flow = await findFlow(id, auth.context.workspaceId);
  if (!flow) return fail("Flow not found", 404);

  const result = await publishFlowChecked({ flow, userId: auth.context.userId });
  if (!result.ok) return fail(result.message, result.status, result.details);
  const { version, definition } = result;
  const trigger = definition.trigger;
  const fresh = await prisma.flow.findUnique({ where: { id: flow.id }, select: FLOW_SELECT });
  const open = await openRunsByFlow([flow.id]);
  const conflicts = await findCampaignConflicts(flow.instagramAccountId, trigger);
  return ok({ ...presentFlow(fresh ?? flow, open.get(flow.id) ?? 0), version, conflicts, warnings: result.warnings });
}
