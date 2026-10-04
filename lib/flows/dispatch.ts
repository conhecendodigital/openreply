/**
 * Entry points the worker calls AFTER the campaigns had their turn. Every
 * function here never throws and only enqueues flow jobs, so the campaign
 * path is never slowed down or broken by a flow:
 *
 *  - dispatchFlowEvent: an event no active campaign matched goes to the
 *    first active flow (oldest first) whose published trigger matches it.
 *    1 event = at most 1 flow. With every flow off (the default) nothing is
 *    queued and nothing changes.
 *  - resumeFlowOnReply: a DM no campaign matched resumes the person's run
 *    that is waiting for a reply.
 *  - routeFlowTap: a "flow:<runId>:<nodeId>" button tap moves its run on.
 *
 * Conflict rule (also on the screen): if the event matched ANY active
 * campaign (even one that did not send because of takeover, the window or a
 * dedupe), flows do not see it. Campaigns always win.
 */
import { prisma } from "@/lib/db/client";
import { getDMQueue, type DmQueueJob } from "@/lib/queue/client";
import { matchKeywords } from "@/lib/utils/keyword-matcher";
import {
  FLOW_START_JOB_NAME,
  FLOW_STEP_JOB_NAME,
  flowJobIds,
  parseFlowPayload,
  type FlowEventKind,
  type FlowStartJob,
  type FlowStepJob,
} from "@/lib/flows/jobs";
import { parseFlowDefinition } from "@/lib/flows/schema";

export type FlowEvent = {
  /** Trigger types to try, in order (a story reply tries STORY_REPLY, then DM). */
  kinds: FlowEventKind[];
  /** Our account's instagramId. */
  instagramId: string;
  igUserId: string;
  username?: string | null;
  text?: string | null;
  mediaId?: string | null;
  originalMediaId?: string | null;
  storyId?: string | null;
  conversationLinkId?: string | null;
  triggerKey: string;
  triggerRef: string;
  inboundAt?: Date | null;
};

export type FlowTriggerRow = {
  id: string;
  triggerType: string | null;
  triggerPostId: string | null;
  triggerMatchAnyPost: boolean;
  triggerStoryId: string | null;
  conversationLinkId: string | null;
  keywords: string[];
  matchAnyWord: boolean;
  wholeWordMatch: boolean;
};

const OPEN_STATUSES = ["ACTIVE", "WAITING_DELAY", "WAITING_REPLY", "WAITING_TAP"] as const;

function words(flow: FlowTriggerRow, text: string | null | undefined): boolean {
  if (flow.matchAnyWord) return true;
  return matchKeywords(text ?? "", flow.keywords, flow.wholeWordMatch).matched;
}

/** Does this flow's PUBLISHED trigger (columns copied at publish) take the event? */
export function flowMatchesEvent(flow: FlowTriggerRow, kind: FlowEventKind, event: FlowEvent): boolean {
  if (flow.triggerType !== kind) return false;
  switch (kind) {
    case "COMMENT": {
      const onPost =
        flow.triggerMatchAnyPost ||
        (Boolean(flow.triggerPostId) &&
          (flow.triggerPostId === event.mediaId || flow.triggerPostId === event.originalMediaId));
      return onPost && words(flow, event.text);
    }
    case "LIVE_COMMENT":
    case "DM":
      return words(flow, event.text);
    case "STORY_REPLY":
      return (!flow.triggerStoryId || flow.triggerStoryId === event.storyId) && words(flow, event.text);
    case "STORY_MENTION":
      return true;
    case "CONVERSATION_LINK":
      return Boolean(flow.conversationLinkId) && flow.conversationLinkId === event.conversationLinkId;
    case "BROADCAST":
      // Etapa 5: a broadcast button names its flow directly (lib/broadcasts/tap.ts);
      // no flow trigger is ever "BROADCAST", so no event matches by trigger.
      return false;
  }
}

/** Picks the flow for an event (pure, for tests): kinds in order, oldest flow first, story-bound first. */
export function pickFlow(flows: FlowTriggerRow[], event: FlowEvent): { flow: FlowTriggerRow; kind: FlowEventKind } | null {
  for (const kind of event.kinds) {
    const candidates = flows.filter((f) => flowMatchesEvent(f, kind, event));
    if (kind === "STORY_REPLY") {
      // A flow for THIS story wins over an "any story" one (stable sort).
      candidates.sort((a, b) => Number(!a.triggerStoryId) - Number(!b.triggerStoryId));
    }
    if (candidates[0]) return { flow: candidates[0], kind };
  }
  return null;
}

async function enqueue(name: string, data: unknown, opts: { jobId: string; delay?: number }) {
  await getDMQueue().add(name, data as DmQueueJob, {
    jobId: opts.jobId,
    ...(opts.delay ? { delay: opts.delay } : {}),
    // A flow step is claimed before it runs; a retry of a failed send could
    // deliver twice, so flow jobs are never retried by BullMQ.
    attempts: 1,
  });
}

/** An event no campaign matched: queue it for the first matching active flow. */
export async function dispatchFlowEvent(event: FlowEvent): Promise<{ queued: boolean; flowId?: string }> {
  try {
    if (!event.igUserId || event.kinds.length === 0) return { queued: false };
    const rows = await prisma.flow.findMany({
      where: {
        isActive: true,
        // triggerType is only set by a publish, and only a published flow
        // can be turned on (app/api/flows/[id]/active).
        triggerType: { in: event.kinds },
        instagramAccount: { instagramId: event.instagramId, status: "ACTIVE" },
      },
      select: {
        id: true,
        triggerType: true,
        triggerPostId: true,
        triggerMatchAnyPost: true,
        triggerStoryId: true,
        conversationLinkId: true,
        keywords: true,
        matchAnyWord: true,
        wholeWordMatch: true,
      },
      orderBy: { createdAt: "asc" },
    });
    if (!Array.isArray(rows) || rows.length === 0) return { queued: false };
    const picked = pickFlow(rows, event);
    if (!picked) return { queued: false };

    const data: FlowStartJob = {
      instagramAccountId: event.instagramId,
      flowId: picked.flow.id,
      kind: picked.kind,
      triggerKey: event.triggerKey,
      triggerRef: event.triggerRef,
      igUserId: event.igUserId,
      username: event.username ?? null,
      text: event.text ? event.text.slice(0, 1000) : null,
      inboundAt: event.inboundAt ? event.inboundAt.getTime() : null,
    };
    await enqueue(FLOW_START_JOB_NAME, data, { jobId: flowJobIds.start(picked.flow.id, event.triggerKey) });
    return { queued: true, flowId: picked.flow.id };
  } catch (error) {
    console.warn("[Flows] dispatch skipped:", error instanceof Error ? error.message : error);
    return { queued: false };
  }
}

/**
 * Active flows' words on this account, so comment moderation never hides a
 * comment a flow would answer (it only widens the protection). [] on error.
 */
export async function activeFlowKeywordGuards(
  instagramId: string
): Promise<{ keywords: string[]; wholeWordMatch: boolean; matchAnyWord: boolean }[]> {
  try {
    const rows = await prisma.flow.findMany({
      where: {
        isActive: true,
        triggerType: "COMMENT",
        instagramAccount: { instagramId, status: "ACTIVE" },
      },
      select: { keywords: true, wholeWordMatch: true, matchAnyWord: true },
    });
    if (!Array.isArray(rows)) return [];
    // An "any word" flow would protect every comment from moderation: only
    // flows with real words widen the protection.
    return rows
      .filter((r) => !r.matchAnyWord && r.keywords.length > 0)
      .map((r) => ({ keywords: r.keywords, wholeWordMatch: r.wholeWordMatch, matchAnyWord: false }));
  } catch {
    return [];
  }
}

/**
 * A DM no campaign matched: if this person has a run waiting for a reply on
 * this account, it moves on (and no new flow starts). Never throws.
 * Only text DMs get here (a DM with only an attachment is not parsed).
 */
export async function resumeFlowOnReply(input: {
  instagramId: string;
  igUserId: string;
  at: Date;
}): Promise<boolean> {
  try {
    const run = await prisma.flowRun.findFirst({
      where: {
        igUserId: input.igUserId,
        status: "WAITING_REPLY",
        flow: { isActive: true, instagramAccount: { instagramId: input.instagramId, status: "ACTIVE" } },
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        flowId: true,
        currentNodeId: true,
        stepCount: true,
        flow: { select: { published: true } },
      },
    });
    if (!run?.currentNodeId) return false;
    const parsed = parseFlowDefinition(run.flow?.published);
    if (!parsed.ok) return false;
    const node = parsed.definition.nodes.find((n) => n.id === run.currentNodeId);
    if (!node || node.type !== "wait" || node.mode !== "reply") return false;

    const next = node.next ?? null;
    const claim = await prisma.flowRun.updateMany({
      where: { id: run.id, status: "WAITING_REPLY", currentNodeId: node.id, stepCount: run.stepCount },
      data: next
        ? { status: "ACTIVE", currentNodeId: next, waitingUntil: null }
        : { status: "DONE", stopReason: "replied", finishedAt: input.at, waitingUntil: null },
    });
    if (claim.count === 0) return false;
    await prisma.flowStep
      .create({ data: { runId: run.id, flowId: run.flowId, nodeId: node.id, nodeType: "wait", outcome: "replied" } })
      .catch(() => undefined);
    if (!next) {
      await prisma.flow
        .update({ where: { id: run.flowId }, data: { completedCount: { increment: 1 } } })
        .catch(() => undefined);
      return true;
    }
    const data: FlowStepJob = {
      instagramAccountId: input.instagramId,
      runId: run.id,
      nodeId: next,
      seq: run.stepCount,
      inboundAt: input.at.getTime(),
    };
    await enqueue(FLOW_STEP_JOB_NAME, data, { jobId: `${flowJobIds.step(run.id, run.stepCount)}_r` });
    return true;
  } catch (error) {
    console.warn("[Flows] reply not routed:", error instanceof Error ? error.message : error);
    return false;
  }
}

/**
 * "flow:<runId>:<targetNodeId>": the run must be WAITING_TAP on a message
 * whose button leads to that target, for this same person. A stale tap (old
 * message, run moved on or ended) is ignored with a log. Never throws.
 */
export async function routeFlowTap(input: {
  instagramId: string;
  igUserId: string;
  payload: string;
  at: Date;
}): Promise<"moved" | "ignored"> {
  try {
    const parsed = parseFlowPayload(input.payload);
    if (!parsed) return "ignored";
    const run = await prisma.flowRun.findUnique({
      where: { id: parsed.runId },
      select: {
        id: true,
        flowId: true,
        igUserId: true,
        status: true,
        currentNodeId: true,
        stepCount: true,
        flow: { select: { isActive: true, published: true, instagramAccount: { select: { instagramId: true } } } },
      },
    });
    if (
      !run ||
      run.igUserId !== input.igUserId ||
      run.flow?.instagramAccount?.instagramId !== input.instagramId ||
      run.status !== "WAITING_TAP" ||
      !run.currentNodeId
    ) {
      console.log(`[Flows] Stale or foreign tap ignored (${input.payload})`);
      return "ignored";
    }
    const def = parseFlowDefinition(run.flow.published);
    if (!def.ok) return "ignored";
    const node = def.definition.nodes.find((n) => n.id === run.currentNodeId);
    if (!node || node.type !== "message" || !node.buttons.some((b) => b.kind === "next" && b.next === parsed.targetNodeId)) {
      console.log(`[Flows] Tap for a button the current step does not have, ignored (${input.payload})`);
      return "ignored";
    }
    const claim = await prisma.flowRun.updateMany({
      where: { id: run.id, status: "WAITING_TAP", currentNodeId: node.id, stepCount: run.stepCount },
      data: { status: "ACTIVE", currentNodeId: parsed.targetNodeId, waitingUntil: null },
    });
    if (claim.count === 0) return "ignored";
    await prisma.flowStep
      .create({
        data: { runId: run.id, flowId: run.flowId, nodeId: node.id, nodeType: "message", outcome: "tapped", detail: parsed.targetNodeId },
      })
      .catch(() => undefined);
    const data: FlowStepJob = {
      instagramAccountId: input.instagramId,
      runId: run.id,
      nodeId: parsed.targetNodeId,
      seq: run.stepCount,
      inboundAt: input.at.getTime(),
    };
    await enqueue(FLOW_STEP_JOB_NAME, data, { jobId: `${flowJobIds.step(run.id, run.stepCount)}_t` });
    return "moved";
  } catch (error) {
    console.warn("[Flows] tap not routed:", error instanceof Error ? error.message : error);
    return "ignored";
  }
}

export { OPEN_STATUSES };
