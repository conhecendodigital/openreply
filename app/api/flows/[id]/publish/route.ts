import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { fail, ok, requireContext } from "@/lib/api-helpers";
import { FLOW_SELECT, findFlow, humanOnly, openRunsByFlow } from "@/lib/flows/api";
import { parseFlowDefinition } from "@/lib/flows/schema";
import { validateFlow } from "@/lib/flows/validate";
import { findCampaignConflicts, presentFlow, publishFlow } from "@/lib/flows/service";

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

  const parsed = parseFlowDefinition(flow.draft);
  if (!parsed.ok) return fail("Invalid flow definition", 400, parsed.issues);
  const validation = validateFlow(parsed.definition);
  if (!validation.ok) return fail("Fix the flow before publishing", 400, { code: "invalid_flow", ...validation });

  const trigger = parsed.definition.trigger;
  if (trigger.type === "CONVERSATION_LINK") {
    const link = await prisma.conversationLink.findFirst({
      where: { id: trigger.conversationLinkId ?? "", workspaceId: auth.context.workspaceId, instagramAccountId: flow.instagramAccountId },
      select: { id: true },
    });
    if (!link) return fail("Conversation link not found on this account", 400, { code: "link_not_found" });
  }

  const { version } = await publishFlow({
    flow: { id: flow.id, workspaceId: flow.workspaceId },
    definition: parsed.definition,
    userId: auth.context.userId,
  });
  const fresh = await prisma.flow.findUnique({ where: { id: flow.id }, select: FLOW_SELECT });
  const open = await openRunsByFlow([flow.id]);
  const conflicts = await findCampaignConflicts(flow.instagramAccountId, trigger);
  return ok({ ...presentFlow(fresh ?? flow, open.get(flow.id) ?? 0), version, conflicts, warnings: validation.warnings });
}
