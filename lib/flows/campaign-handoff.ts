/**
 * A campaign was turned off and a flow copied from it took its post
 * (Flow.sourceAutomationId). People who got the campaign's opening DM BEFORE
 * the switch still tap its button (payload reveal:<automationId>); with the
 * campaign off that tap used to do nothing. Now it starts the flow, skipping
 * what the person already saw:
 *  - an A/B split is decided the same way the flow would (abSplitIsA);
 *  - an opening (a message whose buttons are all "next", one button, no link)
 *    is skipped, because the person just tapped exactly that button.
 */
import { prisma } from "@/lib/db/client";
import { abSplitIsA } from "@/lib/flows/ab-split";
import { parseFlowDefinition, type FlowDefinition } from "@/lib/flows/schema";

/** Where the run should start for someone who already tapped the opening. */
export function handoffStartNode(def: FlowDefinition, flowId: string, igUserId: string): string | null {
  const byId = new Map(def.nodes.map((n) => [n.id, n]));
  let id = def.trigger.next ?? null;
  for (let hops = 0; id && hops < 5; hops++) {
    const node = byId.get(id);
    if (!node) return null;
    if (node.type === "condition" && node.check.kind === "ab_split") {
      id = abSplitIsA(flowId, igUserId, node.check.percentA) ? (node.yes ?? null) : (node.no ?? null);
      continue;
    }
    if (node.type === "message" && node.buttons.length === 1 && node.buttons[0].kind === "next") {
      const next = node.buttons[0].next ?? null;
      return next && byId.has(next) ? next : id;
    }
    return id;
  }
  return id;
}

export type HandoffTarget = { flowId: string; startNodeId: string };

export async function findHandoffFlow(input: {
  automationId: string;
  instagramId: string;
  igUserId: string;
}): Promise<HandoffTarget | null> {
  const flow = await prisma.flow.findFirst({
    where: {
      sourceAutomationId: input.automationId,
      isActive: true,
      instagramAccount: { instagramId: input.instagramId, status: "ACTIVE" },
    },
    select: { id: true, published: true },
    orderBy: { createdAt: "desc" },
  });
  if (!flow?.published) return null;
  const parsed = parseFlowDefinition(flow.published);
  if (!parsed.ok) return null;
  const start = handoffStartNode(parsed.definition, flow.id, input.igUserId);
  return start ? { flowId: flow.id, startNodeId: start } : null;
}
