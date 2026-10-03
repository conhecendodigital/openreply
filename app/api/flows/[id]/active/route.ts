import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { fail, ok, readJson, requireContext } from "@/lib/api-helpers";
import { FLOW_SELECT, findFlow, humanOnly } from "@/lib/flows/api";
import { definitionOrNull, findCampaignConflicts, presentFlowSummary } from "@/lib/flows/service";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

const bodySchema = z.object({ isActive: z.boolean() });

// Turn a flow on or off. ON: signed-in human only, and only a published flow.
// OFF: anyone who can manage (an API key too): stopping is always safe.
// Conflict rule: an event an active campaign matches never reaches a flow,
// so the answer lists the campaigns that would win over this one.
export async function POST(request: NextRequest, { params }: RouteProps) {
  const auth = await requireContext({ manage: true });
  if ("response" in auth) return auth.response;
  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return fail("Send { isActive: true | false }", 400, parsed.error.issues);
  const { isActive } = parsed.data;
  if (isActive) {
    const blocked = await humanOnly("turn flows on");
    if (blocked) return blocked;
  }
  const { id } = await params;
  const flow = await findFlow(id, auth.context.workspaceId);
  if (!flow) return fail("Flow not found", 404);

  const live = definitionOrNull(flow.published);
  if (isActive && (!live || !flow.triggerType)) {
    return fail("Publish the flow before turning it on", 409, { code: "not_published" });
  }

  const updated = await prisma.flow.update({ where: { id: flow.id }, data: { isActive }, select: FLOW_SELECT });
  // Runs already inside an off flow stop on their next step (STOPPED_OFF).
  const conflicts = live ? await findCampaignConflicts(flow.instagramAccountId, live.trigger) : [];
  return ok({ ...presentFlowSummary(updated), conflicts });
}
