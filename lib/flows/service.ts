/**
 * Server helpers for the flow API: publish (copy the draft and its trigger
 * columns), conflicts with active campaigns, the per-node report and the
 * JSON the screens and the MCP read.
 */
import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { matchKeywords } from "@/lib/utils/keyword-matcher";
import { syncFlowLinks } from "@/lib/flows/links";
import {
  bfsOrder,
  flowTriggerLabel,
  parseFlowDefinition,
  type FlowDefinition,
  type FlowTrigger,
} from "@/lib/flows/schema";
import { validateFlow, type FlowValidation } from "@/lib/flows/validate";

/** Columns the worker filters on, copied from the PUBLISHED trigger. */
export function triggerColumns(trigger: FlowTrigger) {
  const keywords = trigger.keywords.map((k) => k.trim()).filter(Boolean);
  return {
    triggerType: trigger.type,
    triggerPostId: trigger.type === "COMMENT" && !trigger.matchAnyPost ? trigger.postId ?? null : null,
    triggerMatchAnyPost: trigger.type === "COMMENT" ? Boolean(trigger.matchAnyPost) : false,
    triggerStoryId: trigger.type === "STORY_REPLY" ? trigger.storyId ?? null : null,
    conversationLinkId: trigger.type === "CONVERSATION_LINK" ? trigger.conversationLinkId ?? null : null,
    keywords: trigger.type === "STORY_MENTION" || trigger.type === "CONVERSATION_LINK" ? [] : keywords,
    matchAnyWord:
      trigger.type === "STORY_MENTION" || trigger.type === "CONVERSATION_LINK" ? true : Boolean(trigger.matchAnyWord),
    wholeWordMatch: trigger.wholeWordMatch !== false,
  };
}

function wordsOverlap(
  a: { keywords: string[]; matchAnyWord: boolean; wholeWordMatch: boolean },
  b: { keywords: string[]; matchAnyWord: boolean; wholeWordMatch: boolean }
): boolean {
  if (a.matchAnyWord || b.matchAnyWord) return true;
  return (
    a.keywords.some((k) => matchKeywords(k, b.keywords, b.wholeWordMatch).matched) ||
    b.keywords.some((k) => matchKeywords(k, a.keywords, a.wholeWordMatch).matched)
  );
}

export type CampaignConflict = { id: string; name: string; trigger: string };

/**
 * Active campaigns that would take the same events (they always win: the
 * flow would then never run for those). Shown when the flow is turned on.
 */
export async function findCampaignConflicts(instagramAccountId: string, trigger: FlowTrigger): Promise<CampaignConflict[]> {
  const cols = triggerColumns(trigger);
  if (trigger.type === "CONVERSATION_LINK") {
    if (!cols.conversationLinkId) return [];
    const link = await prisma.conversationLink.findFirst({
      where: { id: cols.conversationLinkId, instagramAccountId },
      select: { automation: { select: { id: true, name: true, trigger: true, isActive: true } } },
    });
    const a = link?.automation;
    return a?.isActive ? [{ id: a.id, name: a.name, trigger: a.trigger }] : [];
  }
  const triggers =
    trigger.type === "COMMENT"
      ? ["COMMENT"]
      : trigger.type === "LIVE_COMMENT"
        ? ["LIVE_COMMENT"]
        : trigger.type === "STORY_MENTION"
          ? ["STORY_MENTION"]
          : trigger.type === "STORY_REPLY"
            ? ["STORY_REPLY", "COMMENT", "DM"]
            : ["COMMENT", "DM"];
  const campaigns = await prisma.automation.findMany({
    where: { instagramAccountId, isActive: true, trigger: { in: triggers as Prisma.EnumAutomationTriggerFilter["in"] } },
    select: {
      id: true,
      name: true,
      trigger: true,
      postId: true,
      matchAnyPost: true,
      storyId: true,
      keywords: true,
      matchAnyWord: true,
      wholeWordMatch: true,
      dmTriggerEnabled: true,
    },
    orderBy: { createdAt: "asc" },
  });
  const out: CampaignConflict[] = [];
  for (const c of Array.isArray(campaigns) ? campaigns : []) {
    let same = false;
    switch (trigger.type) {
      case "COMMENT":
        same =
          c.trigger === "COMMENT" &&
          (c.matchAnyPost || cols.triggerMatchAnyPost || (Boolean(c.postId) && c.postId === cols.triggerPostId)) &&
          wordsOverlap(c, cols);
        break;
      case "LIVE_COMMENT":
        same = wordsOverlap(c, cols);
        break;
      case "STORY_MENTION":
        same = true;
        break;
      case "STORY_REPLY":
        same =
          c.trigger === "STORY_REPLY"
            ? (!c.storyId || !cols.triggerStoryId || c.storyId === cols.triggerStoryId) && wordsOverlap(c, cols)
            : c.dmTriggerEnabled && wordsOverlap(c, cols);
        break;
      case "DM":
        same = c.dmTriggerEnabled && wordsOverlap(c, cols);
        break;
    }
    if (same) out.push({ id: c.id, name: c.name, trigger: c.trigger });
  }
  return out;
}

export function definitionOrNull(value: unknown): FlowDefinition | null {
  const parsed = parseFlowDefinition(value);
  return parsed.ok ? parsed.definition : null;
}

type FlowRow = {
  id: string;
  name: string;
  isActive: boolean;
  instagramAccountId: string;
  draft: unknown;
  published: unknown;
  publishedVersion: number;
  publishedAt: Date | null;
  triggerType: string | null;
  sourceAutomationId: string | null;
  enteredCount: number;
  completedCount: number;
  createdAt: Date;
  updatedAt: Date;
  instagramAccount?: { username: string; status: string } | null;
};

/** The draft differs from what is running. */
export function hasUnpublishedChanges(flow: Pick<FlowRow, "draft" | "published">): boolean {
  if (!flow.published) return true;
  return JSON.stringify(flow.draft) !== JSON.stringify(flow.published);
}

export function presentFlowSummary(flow: FlowRow, openRuns = 0) {
  const draft = definitionOrNull(flow.draft);
  const live = definitionOrNull(flow.published);
  const trigger = (live ?? draft)?.trigger ?? null;
  return {
    id: flow.id,
    name: flow.name,
    isActive: flow.isActive,
    instagramAccountId: flow.instagramAccountId,
    account: flow.instagramAccount ? { username: flow.instagramAccount.username, status: flow.instagramAccount.status } : null,
    trigger: trigger ? { type: trigger.type, label: flowTriggerLabel(trigger), keywords: trigger.keywords } : null,
    published: Boolean(flow.published),
    publishedVersion: flow.publishedVersion,
    publishedAt: flow.publishedAt,
    hasUnpublishedChanges: hasUnpublishedChanges(flow),
    sourceAutomationId: flow.sourceAutomationId,
    nodeCount: draft?.nodes.length ?? 0,
    stats: { entered: flow.enteredCount, completed: flow.completedCount, open: openRuns },
    createdAt: flow.createdAt,
    updatedAt: flow.updatedAt,
  };
}

export function presentFlow(flow: FlowRow, openRuns = 0) {
  const draft = definitionOrNull(flow.draft);
  const validation: FlowValidation | null = draft ? validateFlow(draft) : null;
  return {
    ...presentFlowSummary(flow, openRuns),
    draft: flow.draft,
    publishedDefinition: flow.published ?? null,
    validation,
    order: draft ? bfsOrder(draft) : [],
  };
}

/** Copy the draft into what runs. Returns the new version. */
export async function publishFlow(input: {
  flow: { id: string; workspaceId: string };
  definition: FlowDefinition;
  userId: string;
  now?: Date;
}): Promise<{ version: number }> {
  const now = input.now ?? new Date();
  await syncFlowLinks(input.flow, input.definition);
  const updated = await prisma.flow.update({
    where: { id: input.flow.id },
    data: {
      published: input.definition as unknown as Prisma.InputJsonValue,
      draft: input.definition as unknown as Prisma.InputJsonValue,
      publishedVersion: { increment: 1 },
      publishedAt: now,
      publishedBy: input.userId,
      ...triggerColumns(input.definition.trigger),
    },
    select: { publishedVersion: true },
  });
  return { version: updated.publishedVersion };
}

export const OPEN_STATUSES = ["ACTIVE", "WAITING_DELAY", "WAITING_REPLY", "WAITING_TAP"] as const;

const FOLLOW_UP_OUTCOMES = new Set(["tapped", "clicked", "replied", "timeout"]);
/** Extra rows of a step that already has one ("stopped" always follows them). */
const DETAIL_OUTCOMES = new Set(["error", "maybe_sent"]);

/** Per node: how many passed, outcomes, clicks, and runs that stopped / wait there. */
export async function flowReport(flowId: string) {
  const [steps, clicks, runs] = await Promise.all([
    prisma.flowStep.groupBy({ by: ["nodeId", "outcome"], where: { flowId }, _count: { _all: true } }),
    prisma.flowLinkClick.groupBy({ by: ["nodeId"], where: { flowId }, _count: { _all: true } }),
    prisma.flowRun.groupBy({ by: ["currentNodeId", "status"], where: { flowId }, _count: { _all: true } }),
  ]);
  type NodeStats = {
    passed: number;
    outcomes: Record<string, number>;
    clicks: number;
    stoppedHere: Record<string, number>;
    waitingHere: number;
  };
  const nodes: Record<string, NodeStats> = {};
  const get = (id: string) => (nodes[id] ??= { passed: 0, outcomes: {}, clicks: 0, stoppedHere: {}, waitingHere: 0 });
  for (const s of steps ?? []) {
    const n = get(s.nodeId);
    n.outcomes[s.outcome] = (n.outcomes[s.outcome] ?? 0) + s._count._all;
    if (!FOLLOW_UP_OUTCOMES.has(s.outcome) && !DETAIL_OUTCOMES.has(s.outcome)) n.passed += s._count._all;
  }
  for (const c of clicks ?? []) get(c.nodeId).clicks += c._count._all;
  const byStatus: Record<string, number> = {};
  for (const r of runs ?? []) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + r._count._all;
    if (!r.currentNodeId) continue;
    const n = get(r.currentNodeId);
    if ((OPEN_STATUSES as readonly string[]).includes(r.status)) n.waitingHere += r._count._all;
    else if (r.status !== "DONE") n.stoppedHere[r.status] = (n.stoppedHere[r.status] ?? 0) + r._count._all;
  }
  const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
  return { totals: { runs: total, byStatus }, nodes };
}
