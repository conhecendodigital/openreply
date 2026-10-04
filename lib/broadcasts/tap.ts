/**
 * A tap on a broadcast button that starts a flow (payload
 * bc:<recipientId>:<buttonId>). The flow id comes from the broadcast row,
 * never from the payload, and only for the person who received it. The tap
 * itself opened the window (processPostback recorded POSTBACK_IN before this),
 * and startFlowRun re-checks that the flow is published, on and its channel
 * ACTIVE: a flow turned off since the broadcast simply does not start.
 */
import { prisma } from "@/lib/db/client";
import { getDMQueue, type DmQueueJob } from "@/lib/queue/client";
import { FLOW_START_JOB_NAME, flowJobIds, type FlowStartJob } from "@/lib/flows/jobs";
import { parseBroadcastPayload } from "@/lib/broadcasts/jobs";
import { parseButtons } from "@/lib/broadcasts/schema";

export type TapOutcome = "invalid" | "not_recipient" | "no_flow" | "flow_off" | "queued";

export async function routeBroadcastTap(input: {
  instagramId: string;
  igUserId: string;
  payload: string;
  at: Date;
}): Promise<TapOutcome> {
  const parsed = parseBroadcastPayload(input.payload);
  if (!parsed) return "invalid";
  try {
    const recipient = await prisma.broadcastRecipient.findUnique({
      where: { id: parsed.recipientId },
      select: {
        id: true,
        igUserId: true,
        broadcast: {
          select: {
            id: true,
            workspaceId: true,
            instagramAccountId: true,
            buttons: true,
            instagramAccount: { select: { instagramId: true } },
          },
        },
      },
    });
    if (
      !recipient ||
      recipient.igUserId !== input.igUserId ||
      recipient.broadcast.instagramAccount.instagramId !== input.instagramId
    ) {
      return "not_recipient";
    }
    const button = parseButtons(recipient.broadcast.buttons).find((b) => b.id === parsed.buttonId);
    if (!button || button.kind !== "flow") return "no_flow";
    const flow = await prisma.flow.findFirst({
      where: {
        id: button.flowId,
        workspaceId: recipient.broadcast.workspaceId,
        instagramAccountId: recipient.broadcast.instagramAccountId,
        isActive: true,
      },
      select: { id: true },
    });
    if (!flow) return "flow_off";

    const triggerKey = `bc:${recipient.id}:${button.id}`;
    const job: FlowStartJob = {
      instagramAccountId: input.instagramId,
      flowId: flow.id,
      kind: "BROADCAST",
      triggerKey,
      // Not a comment: the engine never private-replies a BROADCAST start.
      triggerRef: recipient.id,
      igUserId: input.igUserId,
      inboundAt: input.at.getTime(),
    };
    await getDMQueue().add(FLOW_START_JOB_NAME, job as DmQueueJob, {
      jobId: flowJobIds.start(flow.id, triggerKey),
      attempts: 1,
    });
    return "queued";
  } catch (error) {
    console.warn("[Broadcasts] tap not routed:", error instanceof Error ? error.message : error);
    return "invalid";
  }
}
