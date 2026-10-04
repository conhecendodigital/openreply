/**
 * Flow engine: one FlowRun per person per flow, moved node by node.
 *
 * - Started by a "flow-start" job (lib/flows/dispatch.ts queued it after no
 *   campaign matched the event). Unique (flowId, triggerKey) + one open run
 *   per (flow, contact) (partial unique index): the same event, a webhook
 *   retry or a second comment never puts the person in twice.
 * - Every step is CLAIMED before it runs: UPDATE ... WHERE currentNodeId and
 *   stepCount still match (same idea as lib/sequences/engine.ts). A duplicated
 *   job, a late tap or a wait racing a tap finds nothing to claim and stops.
 * - Before every message: channel ACTIVE (sendTracked asserts it again), flow
 *   still on, no human takeover, the 24 h window open (the comment's one
 *   private reply excepted), the hourly ceiling and the monthly quota. Nothing
 *   is ever sent outside the window.
 * - Waits: "delay" re-enters through a delayed "flow-step" job and must fit in
 *   the window; "reply" parks the run (WAITING_REPLY) until the person's next
 *   DM no campaign matched, or the timeout job.
 * - Meta's ambiguous "unknown error" ends the run as maybe_sent: never resent.
 * - The flow never sends a draft (propose_draft only creates one for a human
 *   to approve) and never approves anything.
 */
import { prisma } from "@/lib/db/client";
import { getDMQueue, type DmQueueJob } from "@/lib/queue/client";
import {
  getUserFollowStatus,
  sendFlowMessage,
  sendImageMessage,
  type FlowMessageButton,
  type FlowRecipient,
} from "@/lib/meta/client";
import { sendTracked } from "@/lib/meta/send";
import { decryptToken } from "@/lib/meta/oauth";
import { isChannelOffError } from "@/lib/channels/status";
import { canAutomate } from "@/lib/messaging/guard";
import { isTakeoverActive, startTakeover } from "@/lib/messaging/takeover";
import { isWindowClosedError, latest, windowRemainingMs } from "@/lib/messaging/window";
import { errorMessage, isAmbiguousDeliveryError } from "@/lib/messaging/errors";
import { addTag, normalizeTagName, recordEvent, removeTag, upsertContact } from "@/lib/contacts/record";
import { createDraft } from "@/lib/drafts/drafts";
import { releaseWorkspaceDMReservation, reserveWorkspaceDMSend } from "@/lib/billing/usage";
import { reserveDMSlot, reserveFlowSlot } from "@/lib/utils/rate-limiter";
import { buildTrackedUrl } from "@/lib/tracking/message";
import { recipientQuery } from "@/lib/tracking/recipient";
import {
  MAX_RUN_STEPS,
  MAX_WAIT_MIN,
  parseFlowDefinition,
  triggerIsComment,
  type FlowDefinition,
  type FlowNode,
  type MessageNode,
} from "@/lib/flows/schema";
import { renderFlowText } from "@/lib/flows/render";
import { noteFollowStatus } from "@/lib/contacts/follows";
import {
  FLOW_REPLY_TIMEOUT_JOB_NAME,
  FLOW_STEP_JOB_NAME,
  flowJobIds,
  flowPayload,
  type FlowReplyTimeoutJob,
  type FlowStartJob,
  type FlowStepJob,
} from "@/lib/flows/jobs";
import type { FlowRunStatus } from "@/app/generated/prisma/client";

export const OPEN_RUN_STATUSES: FlowRunStatus[] = ["ACTIVE", "WAITING_DELAY", "WAITING_REPLY", "WAITING_TAP"];
/** An open run untouched this long is stale (the window closed long ago). */
const STALE_RUN_MS = 24 * 3_600_000;

type FinalStatus = Extract<
  FlowRunStatus,
  "DONE" | "HANDED_OFF" | "STOPPED_WINDOW" | "STOPPED_TAKEOVER" | "STOPPED_OFF" | "STOPPED_LIMIT" | "FAILED"
>;

export type FlowOutcome =
  | "started"
  | "skipped"
  | "duplicate"
  | "busy"
  | "noop"
  | "paused"
  | FinalStatus;

const RUN_INCLUDE = {
  flow: { include: { instagramAccount: true } },
  contact: {
    select: {
      id: true,
      workspaceId: true,
      igUserId: true,
      username: true,
      name: true,
      lastInboundAt: true,
      humanTakeover: true,
      humanTakeoverUntil: true,
    },
  },
} as const;

type LoadedRun = NonNullable<Awaited<ReturnType<typeof loadRun>>>;

async function loadRun(runId: string) {
  return prisma.flowRun.findUnique({ where: { id: runId }, include: RUN_INCLUDE });
}

async function enqueue(name: string, data: unknown, jobId: string, delayMs = 0) {
  await getDMQueue().add(name, data as DmQueueJob, {
    jobId,
    ...(delayMs > 0 ? { delay: delayMs } : {}),
    attempts: 1,
  });
}

async function step(
  run: { id: string; flowId: string },
  node: { id: string; type: string },
  outcome: string,
  extra: { detail?: string | null; mid?: string | null } = {}
) {
  await prisma.flowStep
    .create({
      data: {
        runId: run.id,
        flowId: run.flowId,
        nodeId: node.id,
        nodeType: node.type,
        outcome,
        detail: extra.detail ? extra.detail.slice(0, 500) : null,
        mid: extra.mid ?? null,
      },
    })
    .catch((error: unknown) => console.warn("[Flows] step not recorded:", errorMessage(error)));
}

async function timeline(
  run: LoadedRun,
  type: "FLOW_STARTED" | "FLOW_STEP" | "FLOW_DONE",
  refId: string,
  text: string | null,
  meta: Record<string, unknown>
) {
  await recordEvent(
    { id: run.contact.id, workspaceId: run.contact.workspaceId },
    { type, refId, occurredAt: new Date(), text, meta: { flowId: run.flowId, runId: run.id, ...meta } }
  ).catch(() => false);
}

/** End a run (only if still open). Counts DONE / HANDED_OFF as completed. */
async function finish(
  run: LoadedRun,
  status: FinalStatus,
  reason: string,
  node: { id: string; type: string } | null
): Promise<FinalStatus> {
  const { count } = await prisma.flowRun.updateMany({
    where: { id: run.id, status: { in: OPEN_RUN_STATUSES } },
    data: { status, stopReason: reason, finishedAt: new Date(), waitingUntil: null },
  });
  if (count === 0) return status;
  if (node) {
    await step(run, node, status === "DONE" ? "done" : status === "HANDED_OFF" ? "handed_off" : "stopped", { detail: reason });
  }
  if (status === "DONE" || status === "HANDED_OFF") {
    await prisma.flow
      .update({ where: { id: run.flowId }, data: { completedCount: { increment: 1 } } })
      .catch(() => undefined);
  }
  await timeline(run, "FLOW_DONE", `${run.id}:end`, run.flow.name, { status, reason });
  return status;
}

function definitionOf(run: LoadedRun): FlowDefinition | null {
  const parsed = parseFlowDefinition(run.flow.published);
  return parsed.ok ? parsed.definition : null;
}

// ─── Start ───────────────────────────────────────────────────────────────────

export async function startFlowRun(data: FlowStartJob, now: Date = new Date()): Promise<FlowOutcome> {
  const flow = await prisma.flow.findFirst({
    where: { id: data.flowId, isActive: true },
    include: { instagramAccount: true },
  });
  if (
    !flow ||
    !flow.published ||
    flow.instagramAccount.instagramId !== data.instagramAccountId ||
    flow.instagramAccount.status !== "ACTIVE"
  ) {
    return "skipped";
  }
  const parsed = parseFlowDefinition(flow.published);
  if (!parsed.ok) return "skipped";
  const def = parsed.definition;

  const contact = await upsertContact({
    workspaceId: flow.workspaceId,
    instagramAccountId: flow.instagramAccountId,
    igUserId: data.igUserId,
    username: data.username,
    at: now,
  });

  // Open runs nobody touched for a day are over (the window closed long ago).
  await prisma.flowRun.updateMany({
    where: { contactId: contact.id, status: { in: OPEN_RUN_STATUSES }, updatedAt: { lt: new Date(now.getTime() - STALE_RUN_MS) } },
    data: { status: "STOPPED_WINDOW", stopReason: "stale", finishedAt: now, waitingUntil: null },
  });
  // Never two flows talking at once: a person whose run is mid-way (sending
  // or in a timed wait) does not start another one. A run parked on a button
  // or a reply does not block (the same flow twice is blocked by the unique
  // index: one open run per flow and person).
  const busy = await prisma.flowRun.findFirst({
    where: { contactId: contact.id, status: { in: ["ACTIVE", "WAITING_DELAY"] } },
    select: { id: true },
  });
  if (busy) return "busy";
  // One event = one flow: the same message can reach two flows (a DM that
  // opened an ig.me link comes as the message AND as the link's referral,
  // both keyed dm:<mid>). Whichever started first keeps it.
  const sameEvent = await prisma.flowRun.findFirst({
    where: { contactId: contact.id, triggerKey: data.triggerKey },
    select: { id: true },
  });
  if (sameEvent) return "duplicate";
  // Like the mention campaigns: someone who mentions us in every story goes
  // through a mention flow once.
  if (data.kind === "STORY_MENTION") {
    const before = await prisma.flowRun.findFirst({ where: { flowId: flow.id, contactId: contact.id }, select: { id: true } });
    if (before) return "duplicate";
  }

  // Etapa 5: a flow started by a broadcast button runs inside the window the
  // tap opened. Even when the flow's own trigger is a comment there is no
  // comment here: never a private reply (triggerRef is the recipient id).
  const isComment = data.kind !== "BROADCAST" && triggerIsComment(def.trigger.type);
  let runId: string;
  try {
    const created = await prisma.flowRun.create({
      data: {
        workspaceId: flow.workspaceId,
        flowId: flow.id,
        flowVersion: flow.publishedVersion,
        contactId: contact.id,
        igUserId: data.igUserId,
        triggerKey: data.triggerKey,
        triggerCommentId: isComment ? data.triggerRef : null,
        currentNodeId: def.trigger.next ?? null,
        status: "ACTIVE",
        startedAt: now,
      },
      select: { id: true },
    });
    runId = created.id;
  } catch (error) {
    // Same event (or an open run of this flow for this person): never twice.
    if ((error as { code?: string })?.code === "P2002") return "duplicate";
    throw error;
  }

  await prisma.flow.update({ where: { id: flow.id }, data: { enteredCount: { increment: 1 } } }).catch(() => undefined);
  const run = await loadRun(runId);
  if (!run) return "skipped";
  await step(run, { id: "trigger", type: "trigger" }, "entered", { detail: data.triggerKey });
  await timeline(run, "FLOW_STARTED", runId, flow.name, { triggerKey: data.triggerKey });

  if (!def.trigger.next) {
    await finish(run, "DONE", "empty", null);
    return "DONE";
  }
  const inboundAt = data.inboundAt ? new Date(data.inboundAt) : null;
  const outcome = await advance(runId, def.trigger.next, 0, ["ACTIVE"], inboundAt);
  return outcome === "noop" ? "started" : outcome;
}

// ─── Jobs that move a run on ────────────────────────────────────────────────

/** A delayed wait elapsed, or a tap / reply moved the run (dispatch.ts). */
export async function runFlowStepJob(data: FlowStepJob): Promise<FlowOutcome> {
  return advance(data.runId, data.nodeId, data.seq, ["ACTIVE", "WAITING_DELAY"], data.inboundAt ? new Date(data.inboundAt) : null);
}

/** Nobody answered a "wait for reply" in time. */
export async function runReplyTimeout(data: FlowReplyTimeoutJob, now: Date = new Date()): Promise<FlowOutcome> {
  const run = await loadRun(data.runId);
  if (!run || run.status !== "WAITING_REPLY" || run.currentNodeId !== data.nodeId || run.stepCount !== data.seq) {
    return "noop";
  }
  const def = definitionOf(run);
  const node = def?.nodes.find((n) => n.id === data.nodeId);
  if (!node || node.type !== "wait" || node.mode !== "reply") return finish(run, "STOPPED_OFF", "flow_changed", null);
  const target = node.onTimeout ?? null;
  const claim = await prisma.flowRun.updateMany({
    where: { id: run.id, status: "WAITING_REPLY", currentNodeId: node.id, stepCount: data.seq },
    data: target ? { status: "ACTIVE", currentNodeId: target, waitingUntil: null } : { waitingUntil: null },
  });
  if (claim.count === 0) return "noop";
  await step(run, node, "timeout");
  // The "timeout" row above is this step's record (stopReason says no_reply).
  if (!target) return finish(run, "DONE", "no_reply", null);
  return advance(run.id, target, data.seq, ["ACTIVE"], null, now);
}

// ─── The loop ───────────────────────────────────────────────────────────────

type NodeResult =
  | { kind: "next"; nodeId: string | null | undefined }
  | { kind: "pause" }
  | { kind: "finish"; status: FinalStatus; reason: string };

async function advance(
  runId: string,
  startNodeId: string,
  startSeq: number,
  claimFrom: FlowRunStatus[],
  inboundAt: Date | null,
  nowArg?: Date
): Promise<FlowOutcome> {
  let nodeId = startNodeId;
  let seq = startSeq;
  let from = claimFrom;
  for (;;) {
    const now = nowArg ?? new Date();
    const run = await loadRun(runId);
    if (!run || !from.includes(run.status)) return "noop";
    if (run.currentNodeId !== nodeId || run.stepCount !== seq) return "noop";

    const account = run.flow.instagramAccount;
    if (!run.flow.isActive) return finish(run, "STOPPED_OFF", "flow_off", null);
    if (account.status !== "ACTIVE" || !account.accessToken) return finish(run, "STOPPED_OFF", "channel_off", null);
    if (seq >= MAX_RUN_STEPS) return finish(run, "STOPPED_LIMIT", "max_steps", null);
    const def = definitionOf(run);
    const node = def?.nodes.find((n) => n.id === nodeId);
    if (!def || !node) return finish(run, "STOPPED_OFF", "flow_changed", null);
    if (isTakeoverActive(run.contact, now)) return finish(run, "STOPPED_TAKEOVER", "takeover", node);

    // Claim: a duplicate job, a stale tap or a racing wait finds nothing.
    const claim = await prisma.flowRun.updateMany({
      where: { id: run.id, status: run.status, currentNodeId: nodeId, stepCount: seq },
      data: { status: "ACTIVE", stepCount: seq + 1, waitingUntil: null },
    });
    if (claim.count === 0) return "noop";
    seq += 1;
    from = ["ACTIVE"];

    let result: NodeResult;
    try {
      result = await runNode({ run, def, node, seq, inboundAt, now });
    } catch (error) {
      // After the claim nothing may be retried blindly: end the run.
      console.warn(`[Flows] run ${run.id} node ${node.id} failed:`, errorMessage(error));
      await step(run, node, "error", { detail: errorMessage(error) });
      // "error" keeps the detail; the "stopped" row counts the step (report).
      return finish(run, "FAILED", errorMessage(error).slice(0, 200), node);
    }

    if (result.kind === "pause") return "paused";
    if (result.kind === "finish") return finish(run, result.status, result.reason, node);
    // Nothing after this step: the run is done. The step already has its own
    // row (sent / tagged / ...), so no second "done" row (report counts).
    if (!result.nodeId) return finish(run, "DONE", "end", null);
    const moved = await prisma.flowRun.updateMany({
      where: { id: run.id, status: "ACTIVE", stepCount: seq },
      data: { currentNodeId: result.nodeId },
    });
    if (moved.count === 0) return "noop";
    nodeId = result.nodeId;
  }
}

type NodeInput = {
  run: LoadedRun;
  def: FlowDefinition;
  node: FlowNode;
  seq: number;
  inboundAt: Date | null;
  now: Date;
};

async function runNode(input: NodeInput): Promise<NodeResult> {
  const { node } = input;
  switch (node.type) {
    case "message":
      return runMessage({ ...input, node });
    case "condition":
      return runCondition(input);
    case "action":
      return runAction(input);
    case "wait":
      return runWait(input);
    case "end":
      return { kind: "finish", status: "DONE", reason: "end" };
  }
}

function token(run: LoadedRun): string {
  return decryptToken(run.flow.instagramAccount.accessToken);
}

// ─── Message ────────────────────────────────────────────────────────────────

async function runMessage(input: NodeInput & { node: MessageNode }): Promise<NodeResult> {
  const { run, def, node, now } = input;
  const account = run.flow.instagramAccount;
  const isPrivateReply =
    triggerIsComment(def.trigger.type) && !run.privateReplyUsed && Boolean(run.triggerCommentId);

  // Takeover was checked before the claim; the window here (the comment's
  // private reply is the one message allowed without it).
  const gate = canAutomate(run.contact, { now, inboundAt: input.inboundAt, requireWindow: !isPrivateReply });
  if (!gate.ok) {
    return gate.reason === "takeover"
      ? { kind: "finish", status: "STOPPED_TAKEOVER", reason: "takeover" }
      : { kind: "finish", status: "STOPPED_WINDOW", reason: "window_closed" };
  }

  // Hourly ceiling: the private reply shares the campaigns' Meta bucket; the
  // DMs inside the conversation have their own (rate:flow:<account>).
  const rate = isPrivateReply
    ? await reserveDMSlot(account.instagramId, 3)
    : await reserveFlowSlot(account.instagramId);
  if (!rate.allowed) return { kind: "finish", status: "STOPPED_LIMIT", reason: "hourly_limit" };

  const usage = await reserveWorkspaceDMSend(run.workspaceId);
  if (!usage.allowed) return { kind: "finish", status: "STOPPED_LIMIT", reason: "monthly_limit" };

  const igUserId = run.igUserId;
  const text = renderFlowText(node.text, run.contact) || node.text.trim();
  const links = await prisma.flowLink.findMany({
    where: { flowId: run.flowId, nodeId: node.id },
    select: { buttonId: true, slug: true },
  });
  const slugOf = new Map((Array.isArray(links) ? links : []).map((l) => [l.buttonId, l.slug]));
  const buttons: FlowMessageButton[] = node.buttons.map((b) => {
    if (b.kind === "next") return { kind: "postback", title: b.label, payload: flowPayload(run.id, b.next ?? "") };
    const slug = slugOf.get(b.id);
    return {
      kind: "link",
      title: b.label,
      // Tracked (/r/<slug>?c=<signed igsid>) when the publish created the link.
      url: slug ? buildTrackedUrl(slug, undefined, recipientQuery(slug, igUserId)) : b.url,
    };
  });
  const recipient: FlowRecipient = isPrivateReply ? { comment_id: run.triggerCommentId as string } : { id: igUserId };
  const ctx = {
    workspaceId: run.workspaceId,
    instagramAccountId: run.flow.instagramAccountId,
    contactIgUserId: igUserId,
    origin: "flow" as const,
    refId: run.id,
  };

  let mid: string | null = null;
  try {
    const accessToken = token(run);
    if (node.imageUrl && !isPrivateReply) {
      await sendTracked({ ...ctx, text: "[imagem]" }, (o) =>
        sendImageMessage(accessToken, account.instagramId, igUserId, node.imageUrl as string, o)
      );
    }
    const result = await sendTracked({ ...ctx, text }, (o) =>
      sendFlowMessage(accessToken, account.instagramId, recipient, text, buttons, o)
    );
    mid = result?.message_id ?? null;
  } catch (error) {
    await releaseWorkspaceDMReservation(run.workspaceId, usage.periodStart).catch(() => undefined);
    if (isChannelOffError(error)) return { kind: "finish", status: "STOPPED_OFF", reason: "channel_off" };
    if (isAmbiguousDeliveryError(error)) {
      // Maybe delivered: never resent, the run ends here.
      await step(run, node, "maybe_sent", { detail: errorMessage(error) });
      return { kind: "finish", status: "FAILED", reason: "maybe_sent" };
    }
    if (isWindowClosedError(error)) return { kind: "finish", status: "STOPPED_WINDOW", reason: "window_closed" };
    await step(run, node, "error", { detail: errorMessage(error) });
    return { kind: "finish", status: "FAILED", reason: errorMessage(error).slice(0, 200) };
  }

  if (isPrivateReply) {
    await prisma.flowRun.updateMany({ where: { id: run.id }, data: { privateReplyUsed: true } });
  }
  await step(run, node, "sent", { mid, detail: isPrivateReply ? "private_reply" : null });
  await timeline(run, "FLOW_STEP", `${run.id}:${input.seq}`, text, { nodeId: node.id, mid });

  if (node.buttons.some((b) => b.kind === "next")) {
    // Parked until the person taps one of the buttons (routeFlowTap).
    await prisma.flowRun.updateMany({
      where: { id: run.id, status: "ACTIVE", stepCount: input.seq },
      data: { status: "WAITING_TAP" },
    });
    return { kind: "pause" };
  }
  return { kind: "next", nodeId: node.next };
}

// ─── Condition ──────────────────────────────────────────────────────────────

async function runCondition(input: NodeInput): Promise<NodeResult> {
  const { run, node } = input;
  if (node.type !== "condition") return { kind: "next", nodeId: null };
  let yes = false;
  let detail: string | null = null;
  switch (node.check.kind) {
    case "follows": {
      // null (Meta could not tell, e.g. no open conversation) counts as no:
      // fail-closed, like the campaigns' first contact.
      const follows = await getUserFollowStatus(token(run), run.igUserId);
      noteFollowStatus(run.flow.instagramAccountId, run.igUserId, follows);
      yes = follows === true;
      detail = follows === null ? "unknown" : null;
      break;
    }
    case "has_tag": {
      const name = normalizeTagName(node.check.tag);
      const tag = await prisma.contactTag.findUnique({
        where: { contactId_name: { contactId: run.contactId, name } },
        select: { id: true },
      });
      yes = Boolean(tag);
      break;
    }
    case "clicked": {
      const click = await prisma.flowLinkClick.findFirst({
        where: { runId: run.id, ...(node.check.nodeId ? { nodeId: node.check.nodeId } : {}) },
        select: { id: true },
      });
      yes = Boolean(click);
      break;
    }
  }
  await step(run, node, yes ? "yes" : "no", { detail });
  return { kind: "next", nodeId: yes ? node.yes : node.no };
}

// ─── Action ─────────────────────────────────────────────────────────────────

async function runAction(input: NodeInput): Promise<NodeResult> {
  const { run, node, now } = input;
  if (node.type !== "action") return { kind: "next", nodeId: null };
  const contactRef = { id: run.contact.id, workspaceId: run.contact.workspaceId };
  const action = node.action;
  switch (action.kind) {
    case "add_tag": {
      const added = await addTag(contactRef, action.tag, "auto", now);
      await step(run, node, "tagged", { detail: `${added ? "+" : "="}${normalizeTagName(action.tag)}` });
      break;
    }
    case "remove_tag": {
      const removed = await removeTag(contactRef, action.tag, now);
      await step(run, node, "tagged", { detail: `${removed ? "-" : "="}${normalizeTagName(action.tag)}` });
      break;
    }
    case "notify_owner": {
      await prisma.operationalEvent.create({
        data: {
          workspaceId: run.workspaceId,
          source: "SYSTEM",
          level: "INFO",
          message: `Fluxo "${run.flow.name}": ${action.note?.trim() || "um contato chegou neste passo"} (@${run.contact.username ?? run.igUserId})`,
          payload: { kind: "flow_notify", flowId: run.flowId, runId: run.id, contactId: run.contactId, nodeId: node.id },
        },
      });
      await step(run, node, "notified");
      break;
    }
    case "propose_draft": {
      // A draft for a human to approve in the Lead Engine: the flow never
      // sends nor approves it. Blocked by takeover and by a closed window.
      const result = await createDraft({
        workspaceId: run.workspaceId,
        contactId: run.contactId,
        text: renderFlowText(action.text, run.contact) || action.text,
        reason: action.reason?.trim() || `Fluxo "${run.flow.name}"`,
        origin: "flow",
        createdBy: `flow:${run.flowId}`,
        now,
      });
      await step(run, node, result.ok ? "proposed" : "skipped", { detail: result.ok ? result.draft.id : result.code });
      break;
    }
    case "handoff": {
      // Ends the run first (so the takeover's own stop finds nothing open),
      // then hands the conversation to a human.
      await finish(run, "HANDED_OFF", "handoff", node);
      await startTakeover({ contactId: run.contactId, by: `flow:${run.flowId}`, reason: "flow", hours: action.hours ?? null, now });
      return { kind: "pause" };
    }
  }
  return { kind: "next", nodeId: node.next };
}

// ─── Wait ───────────────────────────────────────────────────────────────────

async function runWait(input: NodeInput): Promise<NodeResult> {
  const { run, def, node, now, seq } = input;
  if (node.type !== "wait") return { kind: "next", nodeId: null };
  const instagramId = run.flow.instagramAccount.instagramId;

  if (node.mode === "delay") {
    if (!node.next) return { kind: "finish", status: "DONE", reason: "end" };
    const delayMs = node.minutes * 60_000;
    const lastInboundAt = latest(run.contact.lastInboundAt, input.inboundAt);
    // Before the comment's private reply no window is needed yet; after it
    // (or on any other trigger) the wait has to end inside the window.
    const privateReplyPending =
      triggerIsComment(def.trigger.type) && !run.privateReplyUsed && Boolean(run.triggerCommentId);
    if (!privateReplyPending && windowRemainingMs({ lastInboundAt }, now) < delayMs) {
      return { kind: "finish", status: "STOPPED_WINDOW", reason: "wait_beyond_window" };
    }
    const until = new Date(now.getTime() + delayMs);
    const parked = await prisma.flowRun.updateMany({
      where: { id: run.id, status: "ACTIVE", stepCount: seq },
      data: { status: "WAITING_DELAY", currentNodeId: node.next, waitingUntil: until },
    });
    if (parked.count === 0) return { kind: "pause" };
    await step(run, node, "waiting", { detail: `${node.minutes}min` });
    const job: FlowStepJob = {
      instagramAccountId: instagramId,
      runId: run.id,
      nodeId: node.next,
      seq,
      inboundAt: lastInboundAt ? lastInboundAt.getTime() : null,
    };
    await enqueue(FLOW_STEP_JOB_NAME, job, flowJobIds.step(run.id, seq), delayMs);
    return { kind: "pause" };
  }

  // Wait for the person's reply (resumeFlowOnReply) or the timeout.
  const minutes = Math.min(node.timeoutMinutes ?? MAX_WAIT_MIN, MAX_WAIT_MIN);
  const until = new Date(now.getTime() + minutes * 60_000);
  const parked = await prisma.flowRun.updateMany({
    where: { id: run.id, status: "ACTIVE", stepCount: seq },
    data: { status: "WAITING_REPLY", waitingUntil: until },
  });
  if (parked.count === 0) return { kind: "pause" };
  await step(run, node, "waiting", { detail: "reply" });
  const job: FlowReplyTimeoutJob = { instagramAccountId: instagramId, runId: run.id, nodeId: node.id, seq };
  await enqueue(FLOW_REPLY_TIMEOUT_JOB_NAME, job, flowJobIds.timeout(run.id, seq), minutes * 60_000);
  return { kind: "pause" };
}
