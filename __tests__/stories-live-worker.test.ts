/**
 * Etapa 3 no worker: gatilhos novos (resposta de story, menção no story,
 * comentário em live), o filtro por gatilho que impede campanha de post
 * responder live (e vice-versa), o job de perfil e o fallback do runJob.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  prisma: {
    automation: { findMany: vi.fn(), findFirst: vi.fn() },
    dmLog: { findUnique: vi.fn(), findFirst: vi.fn(), upsert: vi.fn(), update: vi.fn(), create: vi.fn() },
    instagramAccount: { findUnique: vi.fn() },
    operationalEvent: { create: vi.fn() },
  },
  queueAdd: vi.fn(),
  sendDm: vi.fn(),
  sendPrivateReply: vi.fn(),
  sendCommentReply: vi.fn(),
  check: vi.fn(),
  track: vi.fn(),
  moderate: vi.fn(),
  reserveSlot: vi.fn(),
  lookup: vi.fn(),
  enroll: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: h.prisma }));
vi.mock("@/lib/meta/client", () => ({
  sendDirectMessage: h.sendDm,
  sendDirectMessageWithButton: vi.fn(),
  sendDirectMessageWithLinkButton: vi.fn(),
  sendPrivateReply: h.sendPrivateReply,
  sendPrivateReplyWithButton: vi.fn(),
  sendPrivateReplyWithLinkButton: vi.fn(),
  sendCommentReply: h.sendCommentReply,
  getUserFollowStatus: vi.fn(async () => true),
  MetaApiError: class MetaApiError extends Error {
    code = 0;
  },
  TokenExpiredError: class TokenExpiredError extends Error {},
  RateLimitError: class RateLimitError extends Error {},
}));
vi.mock("@/lib/meta/oauth", () => ({ decryptToken: (t: string) => `plain:${t}` }));
vi.mock("@/lib/meta/send", () => ({
  sendTracked: vi.fn(async (_c: unknown, send: (o: unknown) => Promise<unknown>) => send({ metadata: "le:x:y" })),
}));
vi.mock("@/lib/billing/usage", () => ({
  reserveWorkspaceDMSend: vi.fn(async () => ({ allowed: true, periodStart: new Date() })),
  releaseWorkspaceDMReservation: vi.fn(),
}));
vi.mock("@/lib/utils/rate-limiter", () => ({ reserveDMSlot: h.reserveSlot }));
vi.mock("@/lib/ops/worker-health", () => ({ recordWorkerAlert: vi.fn() }));
vi.mock("@/lib/moderation/moderate", () => ({ moderateComment: h.moderate }));
vi.mock("@/lib/messaging/guard", () => ({ checkAutomation: h.check }));
vi.mock("@/lib/channels/status", () => ({
  assertAccountActive: vi.fn(),
  isChannelOffError: () => false,
  noteMetaError: vi.fn(),
}));
vi.mock("@/lib/sequences/engine", () => ({ enrollInSequence: h.enroll, onPersonReplied: vi.fn(), runSequenceStep: vi.fn() }));
vi.mock("@/lib/contacts/record", () => ({
  AUTO_TAGS: { cameFrom: (o: string) => `veio:${o}`, commented: () => "c", received: () => "r" },
  addTagSafe: vi.fn(),
  onDmLogSent: vi.fn(),
  onDirectMessage: vi.fn(),
  trackInteraction: h.track,
  resolveAccountByInstagramId: vi.fn(),
}));
vi.mock("@/lib/contacts/profile", () => ({ lookupContactProfile: h.lookup }));
vi.mock("@/lib/queue/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/queue/client")>();
  return { ...real, getDMQueue: () => ({ add: h.queueAdd }), getRedisConnection: vi.fn() };
});
vi.mock("bullmq", () => {
  function MockWorker(_name: string, processor: unknown) {
    (global as Record<string, unknown>).__etapa3Processor = processor;
    return { on: vi.fn(), close: vi.fn() };
  }
  class UnrecoverableError extends Error {}
  return { Worker: MockWorker, UnrecoverableError, Queue: vi.fn() };
});

import { createDMWorker } from "../lib/queue/dm-worker";

type Job = { name: string; data: Record<string, unknown>; id: string; attemptsMade: number; timestamp?: number };
function run(job: Job) {
  createDMWorker();
  return ((global as Record<string, unknown>).__etapa3Processor as (j: Job) => Promise<void>)(job);
}

const base = {
  workspaceId: "ws",
  instagramAccountId: "acc_row",
  isActive: true,
  keywords: ["quero"],
  matchAnyWord: false,
  wholeWordMatch: true,
  dmMessage: "Aqui está, {username}",
  requireFollow: false,
  followUpEnabled: false,
  openingDmEnabled: false,
  publicReplyEnabled: false,
  publicReplyMessages: [],
  publicReplyMessage: null,
  linkButtonLabel: null,
  storyId: null,
  instagramAccount: { instagramId: "ig_owner", accessToken: "enc", status: "ACTIVE" },
  workspace: { id: "ws" },
  trackedLinks: [],
};
const campaign = (over: Record<string, unknown>) => ({ ...base, ...over });

const messageJob = (data: Record<string, unknown>): Job => ({
  name: "process-message",
  id: "m1",
  attemptsMade: 0,
  data: { instagramAccountId: "ig_owner", messageId: "mid_1", messageText: "quero", senderId: "ig_person", ...data },
});
const commentJob = (data: Record<string, unknown>): Job => ({
  name: "process-comment",
  id: "c1",
  attemptsMade: 0,
  data: {
    instagramAccountId: "ig_owner",
    commentId: "cmt_1",
    commentText: "quero o link",
    commenterId: "ig_viewer",
    commenterName: "viewer",
    mediaId: "media_1",
    ...data,
  },
});

/** findMany answers by trigger, like the database would. */
function campaignsByTrigger(rows: Record<string, unknown>[]) {
  h.prisma.automation.findMany.mockImplementation(async (args: { where: Record<string, unknown> }) => {
    const w = args.where as { trigger?: unknown; storyId?: unknown; OR?: { storyId?: unknown }[] };
    const wanted = typeof w.trigger === "string" ? [w.trigger] : ((w.trigger as { in?: string[] })?.in ?? []);
    return rows.filter((r) => {
      if (!wanted.includes(r.trigger as string)) return false;
      if (w.trigger === "STORY_REPLY" && w.OR) {
        return w.OR.some((o) => o.storyId === r.storyId);
      }
      if (typeof w.trigger !== "string" && (args.where as { dmTriggerEnabled?: boolean }).dmTriggerEnabled) {
        return Boolean(r.dmTriggerEnabled);
      }
      return true;
    });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.check.mockResolvedValue({ ok: true, contact: { id: "ct", username: "pessoa_real" } });
  h.track.mockResolvedValue({ contact: { id: "ct", workspaceId: "ws" }, inserted: true });
  h.prisma.dmLog.findUnique.mockResolvedValue(null);
  h.prisma.dmLog.findFirst.mockResolvedValue(null);
  h.prisma.dmLog.upsert.mockImplementation(async (a: { create: { automationId: string } }) => ({ id: `log_${a.create.automationId}`, commenterId: "ig_person" }));
  h.prisma.dmLog.create.mockResolvedValue({ id: "log_c" });
  h.prisma.dmLog.update.mockResolvedValue({ id: "log_c", commenterId: "ig_viewer" });
  h.sendDm.mockResolvedValue({ message_id: "out" });
  h.sendPrivateReply.mockResolvedValue({ message_id: "out" });
  h.reserveSlot.mockResolvedValue({ allowed: true });
  h.moderate.mockResolvedValue({ action: "CLEAN" });
});

describe("story reply", () => {
  it("fires the STORY_REPLY campaign (that story or any) and the DM campaigns skip the same message", async () => {
    campaignsByTrigger([
      campaign({ id: "story_any", trigger: "STORY_REPLY", storyId: null }),
      campaign({ id: "story_other", trigger: "STORY_REPLY", storyId: "story_other" }),
      campaign({ id: "dm_kw", trigger: "COMMENT", dmTriggerEnabled: true }),
    ]);
    await run(messageJob({ storyKind: "reply", storyId: "story_42", timestamp: 1_700_000_000_000 }));

    expect(h.prisma.automation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ trigger: "STORY_REPLY", OR: [{ storyId: null }, { storyId: "story_42" }] }),
      })
    );
    expect(h.sendDm).toHaveBeenCalledTimes(1);
    expect(h.prisma.dmLog.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { automationId_commentId: { automationId: "story_any", commentId: "dm:mid_1" } } })
    );
    // The DM-keyword campaigns never ran for this message: one DM per reply.
    const triggers = h.prisma.automation.findMany.mock.calls.map((c) => c[0].where.trigger);
    expect(triggers).toEqual(["STORY_REPLY"]);
    // {username} comes from the contact when no earlier log had it.
    expect(h.sendDm.mock.calls[0][3]).toBe("Aqui está, pessoa_real");
    // The window opens at the story reply itself.
    expect(h.check).toHaveBeenCalledWith(expect.objectContaining({ inboundAt: new Date(1_700_000_000_000) }));
  });

  it("a retry where the story campaign already sent still keeps the DM campaigns quiet", async () => {
    campaignsByTrigger([
      campaign({ id: "story_any", trigger: "STORY_REPLY" }),
      campaign({ id: "dm_kw", trigger: "COMMENT", dmTriggerEnabled: true }),
    ]);
    h.prisma.dmLog.findUnique.mockResolvedValue({ status: "SENT" });
    await run(messageJob({ storyKind: "reply", storyId: "story_42" }));
    expect(h.sendDm).not.toHaveBeenCalled();
    expect(h.prisma.automation.findMany).toHaveBeenCalledTimes(1);
  });

  it("when no story campaign matches, the DM-keyword campaigns answer as before", async () => {
    campaignsByTrigger([
      campaign({ id: "story_other_word", trigger: "STORY_REPLY", keywords: ["outra"] }),
      campaign({ id: "dm_only", trigger: "DM", dmTriggerEnabled: true }),
    ]);
    await run(messageJob({ storyKind: "reply", storyId: "story_42" }));
    expect(h.sendDm).toHaveBeenCalledTimes(1);
    expect(h.prisma.dmLog.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { automationId_commentId: { automationId: "dm_only", commentId: "dm:mid_1" } } })
    );
  });

  it("a takeover keeps the story campaign quiet", async () => {
    campaignsByTrigger([campaign({ id: "story_any", trigger: "STORY_REPLY" })]);
    h.check.mockResolvedValue({ ok: false, reason: "takeover", contact: null });
    await run(messageJob({ storyKind: "reply" }));
    expect(h.sendDm).not.toHaveBeenCalled();
    expect(h.prisma.dmLog.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ status: "SKIPPED_TAKEOVER" }) }));
  });
});

describe("story mention", () => {
  it("fires STORY_MENTION campaigns without any keyword", async () => {
    campaignsByTrigger([
      campaign({ id: "mention", trigger: "STORY_MENTION", keywords: [], matchAnyWord: true }),
      campaign({ id: "dm_kw", trigger: "COMMENT", dmTriggerEnabled: true }),
    ]);
    await run(messageJob({ messageId: "mid_m", messageText: "", storyKind: "mention" }));
    expect(h.sendDm).toHaveBeenCalledTimes(1);
    expect(h.prisma.dmLog.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { automationId_commentId: { automationId: "mention", commentId: "mention:mid_m" } } })
    );
    expect(h.prisma.automation.findMany.mock.calls.map((c) => c[0].where.trigger)).toEqual(["STORY_MENTION"]);
  });

  it("someone who mentions us again does not get the campaign twice", async () => {
    campaignsByTrigger([campaign({ id: "mention", trigger: "STORY_MENTION", keywords: [], matchAnyWord: true })]);
    h.prisma.dmLog.findFirst.mockResolvedValueOnce({ commentId: "mention:mid_old" });
    await run(messageJob({ messageId: "mid_new", messageText: "", storyKind: "mention" }));
    expect(h.sendDm).not.toHaveBeenCalled();
  });

  it("only ACTIVE channels are searched", async () => {
    campaignsByTrigger([]);
    await run(messageJob({ messageText: "", storyKind: "mention" }));
    expect(h.prisma.automation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ instagramAccount: { instagramId: "ig_owner", status: "ACTIVE" } }) })
    );
  });
});

describe("plain DM", () => {
  it("DM-keyword campaigns are COMMENT (with dmTriggerEnabled) or DM, never story/live ones", async () => {
    campaignsByTrigger([]);
    await run(messageJob({}));
    expect(h.prisma.automation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ dmTriggerEnabled: true, trigger: { in: ["COMMENT", "DM"] } }) })
    );
  });
});

describe("live comment", () => {
  it("only LIVE_COMMENT campaigns, no moderation, no public reply, one private reply", async () => {
    campaignsByTrigger([
      campaign({ id: "live", trigger: "LIVE_COMMENT", publicReplyEnabled: true, publicReplyMessages: ["valeu!"] }),
      campaign({ id: "any_post", trigger: "COMMENT", matchAnyPost: true }),
    ]);
    await run(commentJob({ surface: "live", mediaId: "live_media_1" }));

    expect(h.prisma.automation.findMany.mock.calls[0][0].where).toEqual({
      trigger: "LIVE_COMMENT",
      isActive: true,
      instagramAccount: { instagramId: "ig_owner", status: "ACTIVE" },
    });
    expect(h.moderate).not.toHaveBeenCalled();
    expect(h.sendCommentReply).not.toHaveBeenCalled();
    expect(h.sendPrivateReply).toHaveBeenCalledTimes(1);
    expect(h.sendPrivateReply.mock.calls[0][2]).toBe("cmt_1");
    expect(h.reserveSlot).toHaveBeenCalled();
    expect(h.track).toHaveBeenCalledWith(expect.objectContaining({ event: expect.objectContaining({ type: "COMMENT", meta: { surface: "live" } }) }));
  });

  it("over the hourly limit a live comment is skipped, not requeued for after the live", async () => {
    campaignsByTrigger([campaign({ id: "live", trigger: "LIVE_COMMENT" })]);
    h.reserveSlot.mockResolvedValue({ allowed: false, shouldRequeue: true, shouldSkip: false, requeueDelayMs: 1_800_000 });
    await run(commentJob({ surface: "live" }));
    expect(h.sendPrivateReply).not.toHaveBeenCalled();
    expect(h.queueAdd).not.toHaveBeenCalled();
    expect(h.prisma.dmLog.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "SKIPPED_RATE_LIMIT" }) }));
  });

  it("a post comment never fires a LIVE_COMMENT campaign and still runs moderation", async () => {
    campaignsByTrigger([campaign({ id: "live", trigger: "LIVE_COMMENT" })]);
    await run(commentJob({}));
    expect(h.prisma.automation.findMany.mock.calls[0][0].where.trigger).toBe("COMMENT");
    expect(h.moderate).toHaveBeenCalled();
    expect(h.sendPrivateReply).not.toHaveBeenCalled();
  });
});

describe("runJob routing", () => {
  it("routes fetch-profile to the profile lookup", async () => {
    h.lookup.mockResolvedValue({ outcome: "ok" });
    await run({ name: "fetch-profile", id: "profile_ct_0", attemptsMade: 0, data: { instagramAccountId: "ig_owner", contactId: "ct" } });
    expect(h.lookup).toHaveBeenCalledWith("ct");
    expect(h.prisma.automation.findMany).not.toHaveBeenCalled();
    expect(h.queueAdd).not.toHaveBeenCalled();
  });

  it("out of budget, the lookup comes back later as a new delayed job", async () => {
    h.lookup.mockResolvedValue({ outcome: "no_budget", retryInMs: 600_000 });
    await run({ name: "fetch-profile", id: "profile_ct_0", attemptsMade: 0, data: { instagramAccountId: "ig_owner", contactId: "ct" } });
    expect(h.queueAdd).toHaveBeenCalledWith(
      "fetch-profile",
      { instagramAccountId: "ig_owner", contactId: "ct", requeue: 1 },
      expect.objectContaining({ delay: 600_000, attempts: 1 })
    );
  });

  it("stops requeueing after a few tries", async () => {
    h.lookup.mockResolvedValue({ outcome: "rate_limited", retryInMs: 1_800_000 });
    await run({ name: "fetch-profile", id: "x", attemptsMade: 0, data: { instagramAccountId: "ig_owner", contactId: "ct", requeue: 6 } });
    expect(h.queueAdd).not.toHaveBeenCalled();
  });

  it("an unknown job name is not treated as a comment", async () => {
    await run({ name: "something-new", id: "n1", attemptsMade: 0, data: { instagramAccountId: "ig_owner" } });
    expect(h.prisma.automation.findMany).not.toHaveBeenCalled();
    expect(h.track).not.toHaveBeenCalled();
  });
});
