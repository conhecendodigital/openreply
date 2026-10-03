/**
 * Etapa 3 (fluxos) no worker: as campanhas ligadas continuam iguais e os
 * fluxos só recebem o que NENHUMA campanha casou.
 *
 *  - comentário/DM/menção/resposta de story/link que casa com campanha: a
 *    campanha responde exatamente como antes e o fluxo nem é consultado
 *    (mesmo quando a campanha pulou por takeover);
 *  - o que nenhuma campanha casou vai pro dispatch de fluxos (que nunca lança);
 *  - toque "flow:" vai pro motor de fluxos; "reveal:"/"followcheck:" seguem
 *    no caminho da campanha;
 *  - jobs de fluxo vão pro motor e nunca caem em processComment.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  prisma: {
    automation: { findMany: vi.fn(), findFirst: vi.fn() },
    dmLog: { findUnique: vi.fn(), findFirst: vi.fn(), upsert: vi.fn(), update: vi.fn(), create: vi.fn() },
    instagramAccount: { findUnique: vi.fn() },
    operationalEvent: { create: vi.fn() },
    conversationLink: { findFirst: vi.fn(), update: vi.fn() },
    conversationLinkOpen: { createMany: vi.fn() },
  },
  sendPrivateReply: vi.fn(),
  sendPrivateReplyWithLinkButton: vi.fn(),
  sendPrivateReplyWithButton: vi.fn(),
  sendDirectMessage: vi.fn(),
  sendDirectMessageWithButton: vi.fn(),
  sendDirectMessageWithLinkButton: vi.fn(),
  getUserFollowStatus: vi.fn(),
  queueAdd: vi.fn(),
  checkAutomation: vi.fn(),
  moderate: vi.fn(),
  dispatch: vi.fn(),
  resume: vi.fn(),
  tap: vi.fn(),
  guards: vi.fn(),
  startRun: vi.fn(),
  stepJob: vi.fn(),
  timeoutJob: vi.fn(),
  trackInteraction: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: h.prisma }));
vi.mock("@/lib/meta/client", () => ({
  sendPrivateReply: h.sendPrivateReply,
  sendPrivateReplyWithLinkButton: h.sendPrivateReplyWithLinkButton,
  sendPrivateReplyWithButton: h.sendPrivateReplyWithButton,
  sendDirectMessage: h.sendDirectMessage,
  sendDirectMessageWithButton: h.sendDirectMessageWithButton,
  sendDirectMessageWithLinkButton: h.sendDirectMessageWithLinkButton,
  getUserFollowStatus: h.getUserFollowStatus,
  sendCommentReply: vi.fn(),
  MetaApiError: class MetaApiError extends Error {
    code = 0;
  },
  TokenExpiredError: class TokenExpiredError extends Error {},
  RateLimitError: class RateLimitError extends Error {},
}));
vi.mock("@/lib/meta/oauth", () => ({ decryptToken: () => "token" }));
vi.mock("@/lib/utils/rate-limiter", () => ({
  reserveDMSlot: vi.fn(async () => ({ allowed: true, shouldRequeue: false, shouldSkip: false })),
}));
vi.mock("@/lib/billing/usage", () => ({
  reserveWorkspaceDMSend: vi.fn(async () => ({ allowed: true, periodStart: new Date(), limit: 1000 })),
  releaseWorkspaceDMReservation: vi.fn(),
}));
vi.mock("@/lib/contacts/record", () => ({
  AUTO_TAGS: { commented: (k: string) => `comentou:${k}`, cameFrom: (o: string) => `veio:${o}` },
  addTagSafe: vi.fn(),
  onDmLogSent: vi.fn(),
  trackInteraction: h.trackInteraction,
}));
vi.mock("@/lib/messaging/guard", () => ({ checkAutomation: h.checkAutomation }));
vi.mock("@/lib/meta/send", () => ({
  sendTracked: vi.fn(async (_c: unknown, send: (o: unknown) => Promise<unknown>) => send({ metadata: "le:x:y" })),
}));
vi.mock("@/lib/sequences/engine", () => ({ enrollInSequence: vi.fn(async () => null), runSequenceStep: vi.fn() }));
vi.mock("@/lib/moderation/moderate", () => ({ moderateComment: h.moderate }));
vi.mock("@/lib/ops/worker-health", () => ({ recordWorkerAlert: vi.fn() }));
vi.mock("@/lib/messaging/crm-dm", () => ({ handleCrmDm: vi.fn() }));
vi.mock("@/lib/contacts/profile", () => ({ lookupContactProfile: vi.fn() }));
vi.mock("@/lib/messages/store", () => ({ downloadDirectMedia: vi.fn() }));
vi.mock("@/lib/flows/dispatch", () => ({
  dispatchFlowEvent: h.dispatch,
  resumeFlowOnReply: h.resume,
  routeFlowTap: h.tap,
  activeFlowKeywordGuards: h.guards,
}));
vi.mock("@/lib/flows/engine", () => ({
  startFlowRun: h.startRun,
  runFlowStepJob: h.stepJob,
  runReplyTimeout: h.timeoutJob,
}));
vi.mock("@/lib/queue/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/queue/client")>();
  return { ...real, getDMQueue: () => ({ add: h.queueAdd }), getRedisConnection: vi.fn() };
});
vi.mock("bullmq", () => {
  function MockWorker(_name: string, processor: unknown) {
    (global as Record<string, unknown>).__flowsWorkerProcessor = processor;
    return { on: vi.fn(), close: vi.fn() };
  }
  class UnrecoverableError extends Error {}
  return { Worker: MockWorker, UnrecoverableError };
});

import { createDMWorker } from "../lib/queue/dm-worker";

type Processor = (job: { name?: string; data: Record<string, unknown>; id: string; attemptsMade: number; timestamp?: number }) => Promise<void>;
function processor(): Processor {
  createDMWorker();
  return (global as Record<string, unknown>).__flowsWorkerProcessor as Processor;
}
const job = (name: string | undefined, data: Record<string, unknown>) => ({ name, data, id: "j1", attemptsMade: 0, timestamp: Date.now() });

const account = { id: "acc_1", instagramId: "ig_1", accessToken: "enc", status: "ACTIVE" };
function campaign(over: Record<string, unknown> = {}) {
  return {
    id: "auto_1",
    name: "Campanha FOTO",
    workspaceId: "ws_1",
    instagramAccountId: "acc_1",
    trigger: "COMMENT",
    postId: "media_1",
    matchAnyPost: false,
    keywords: ["FOTO"],
    matchAnyWord: false,
    wholeWordMatch: true,
    dmTriggerEnabled: true,
    dmMessage: "Aqui está: https://example.com",
    openingDmEnabled: false,
    openingDmMessage: null,
    openingDmButtonLabel: null,
    linkButtonLabel: null,
    requireFollow: false,
    followPromptMessage: null,
    followPromptButtonLabel: null,
    followUpEnabled: false,
    followUpMessage: null,
    followUpDelayMinutes: 0,
    publicReplyEnabled: false,
    publicReplyMessage: null,
    publicReplyMessages: [],
    storyId: null,
    isActive: true,
    instagramAccount: account,
    workspace: { id: "ws_1" },
    trackedLinks: [],
    ...over,
  };
}
const comment = (text: string, over: Record<string, unknown> = {}) =>
  job("process-comment", {
    instagramAccountId: "ig_1",
    commentId: "c_1",
    commentText: text,
    commenterId: "user_9",
    commenterName: "maria",
    mediaId: "media_1",
    ...over,
  });
const dm = (text: string, over: Record<string, unknown> = {}) =>
  job("process-message", { instagramAccountId: "ig_1", messageId: "mid_1", messageText: text, senderId: "user_9", timestamp: 1_700_000_000_000, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  h.prisma.automation.findMany.mockResolvedValue([campaign()]);
  h.prisma.automation.findFirst.mockResolvedValue(null);
  h.prisma.dmLog.findUnique.mockResolvedValue(null);
  h.prisma.dmLog.findFirst.mockResolvedValue(null);
  h.prisma.dmLog.create.mockResolvedValue({});
  h.prisma.dmLog.update.mockResolvedValue({ id: "log_1" });
  h.prisma.dmLog.upsert.mockResolvedValue({ id: "log_1" });
  h.prisma.instagramAccount.findUnique.mockResolvedValue({ status: "ACTIVE", workspaceId: "ws_1" });
  h.checkAutomation.mockResolvedValue({ ok: true, contact: null });
  h.moderate.mockResolvedValue({ action: "NONE" });
  h.guards.mockResolvedValue([]);
  h.dispatch.mockResolvedValue({ queued: false });
  h.resume.mockResolvedValue(false);
  h.tap.mockResolvedValue("ignored");
  h.trackInteraction.mockResolvedValue({ contact: { id: "ct_1", workspaceId: "ws_1" }, inserted: true });
  for (const fn of [h.sendPrivateReply, h.sendDirectMessage, h.sendDirectMessageWithButton, h.sendPrivateReplyWithButton]) {
    fn.mockResolvedValue({ message_id: "m_out" });
  }
  h.getUserFollowStatus.mockResolvedValue(true);
});

describe("comments: campaigns win, flows get the rest", () => {
  it("a comment a campaign matches is answered by the campaign exactly as before, and flows are not consulted", async () => {
    await processor()(comment("quero FOTO"));
    expect(h.sendPrivateReply).toHaveBeenCalledTimes(1);
    expect(h.sendPrivateReply).toHaveBeenCalledWith("token", "ig_1", "c_1", "Aqui está: https://example.com", { metadata: "le:x:y" });
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it("a campaign that matched but skipped (human takeover) still keeps the comment away from flows", async () => {
    h.checkAutomation.mockResolvedValue({ ok: false, reason: "takeover", contact: null });
    await processor()(comment("quero FOTO"));
    expect(h.sendPrivateReply).not.toHaveBeenCalled();
    expect(h.prisma.dmLog.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "SKIPPED_TAKEOVER" }) }));
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it("a comment no campaign matches goes to the flows, keyed by the comment", async () => {
    await processor()(comment("quero PROMPT"));
    expect(h.sendPrivateReply).not.toHaveBeenCalled();
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    expect(h.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        kinds: ["COMMENT"],
        instagramId: "ig_1",
        igUserId: "user_9",
        mediaId: "media_1",
        text: "quero PROMPT",
        triggerKey: "comment:c_1",
        triggerRef: "c_1",
      })
    );
  });

  it("no active campaign at all: the comment goes to the flows", async () => {
    h.prisma.automation.findMany.mockResolvedValue([]);
    await processor()(comment("qualquer coisa"));
    expect(h.dispatch).toHaveBeenCalledTimes(1);
  });

  it("a live comment no campaign matches goes to LIVE_COMMENT flows", async () => {
    h.prisma.automation.findMany.mockResolvedValue([]);
    await processor()(comment("oi", { surface: "live", commentId: "lc_1" }));
    expect(h.dispatch).toHaveBeenCalledWith(expect.objectContaining({ kinds: ["LIVE_COMMENT"], triggerKey: "live:lc_1" }));
  });

  it("a comment hidden by moderation reaches neither campaigns nor flows", async () => {
    h.prisma.automation.findMany.mockResolvedValue([]);
    h.moderate.mockResolvedValue({ action: "HIDDEN" });
    await processor()(comment("compre seguidores"));
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it("moderation protects the words of active comment flows too (appended after the campaigns')", async () => {
    h.guards.mockResolvedValue([{ keywords: ["PROMPT"], wholeWordMatch: true, matchAnyWord: false }]);
    await processor()(comment("quero PROMPT"));
    const campaigns = h.moderate.mock.calls[0][1].campaigns;
    expect(campaigns[0]).toEqual({ keywords: ["FOTO"], wholeWordMatch: true, matchAnyWord: false });
    expect(campaigns[1]).toEqual({ keywords: ["PROMPT"], wholeWordMatch: true, matchAnyWord: false });
  });
});

describe("DMs, mentions and story replies", () => {
  it("a DM a campaign matches is answered by the campaign; no flow resume, no flow start", async () => {
    await processor()(dm("FOTO"));
    expect(h.sendDirectMessage).toHaveBeenCalledTimes(1);
    expect(h.resume).not.toHaveBeenCalled();
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it("an unmatched DM first resumes a run waiting for a reply", async () => {
    h.resume.mockResolvedValue(true);
    await processor()(dm("oi tudo bem"));
    expect(h.resume).toHaveBeenCalledWith({ instagramId: "ig_1", igUserId: "user_9", at: new Date(1_700_000_000_000) });
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it("an unmatched DM with no waiting run may start a DM flow", async () => {
    await processor()(dm("oi tudo bem"));
    expect(h.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ kinds: ["DM"], triggerKey: "dm:mid_1", triggerRef: "mid_1", text: "oi tudo bem" })
    );
  });

  it("an unmatched story reply tries STORY_REPLY flows, then DM flows", async () => {
    h.prisma.automation.findMany.mockResolvedValue([]);
    await processor()(dm("amei", { storyKind: "reply", storyId: "st_1" }));
    expect(h.dispatch).toHaveBeenCalledWith(expect.objectContaining({ kinds: ["STORY_REPLY", "DM"], storyId: "st_1" }));
  });

  it("a story reply a story campaign matched never reaches flows", async () => {
    h.prisma.automation.findMany.mockImplementation(async (args: { where: { trigger?: unknown } }) =>
      args.where.trigger === "STORY_REPLY" ? [campaign({ id: "auto_st", trigger: "STORY_REPLY", keywords: ["AMEI"] })] : []
    );
    await processor()(dm("amei", { storyKind: "reply", storyId: "st_1" }));
    expect(h.sendDirectMessage).toHaveBeenCalledTimes(1);
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.resume).not.toHaveBeenCalled();
  });

  it("a mention with an active mention campaign is the campaign's; without one it goes to flows", async () => {
    h.prisma.automation.findMany.mockResolvedValue([campaign({ id: "auto_m", trigger: "STORY_MENTION", keywords: [], matchAnyWord: true })]);
    await processor()(dm("", { storyKind: "mention" }));
    expect(h.sendDirectMessage).toHaveBeenCalledTimes(1);
    expect(h.dispatch).not.toHaveBeenCalled();

    vi.clearAllMocks();
    h.prisma.automation.findMany.mockResolvedValue([]);
    h.dispatch.mockResolvedValue({ queued: true });
    await processor()(dm("", { storyKind: "mention", messageId: "mid_m" }));
    expect(h.dispatch).toHaveBeenCalledWith(expect.objectContaining({ kinds: ["STORY_MENTION"], triggerKey: "mention:mid_m" }));
  });
});

describe("button taps", () => {
  it("a flow: payload goes to the flow engine and never touches a campaign", async () => {
    await processor()(job("process-postback", { instagramAccountId: "ig_1", userId: "user_9", payload: "flow:run_1:n2", mid: "pb_1" }));
    expect(h.tap).toHaveBeenCalledWith(expect.objectContaining({ instagramId: "ig_1", igUserId: "user_9", payload: "flow:run_1:n2" }));
    expect(h.prisma.automation.findFirst).not.toHaveBeenCalled();
    // The tap still opened the window (CRM) like any postback.
    expect(h.trackInteraction).toHaveBeenCalledWith(expect.objectContaining({ event: expect.objectContaining({ type: "POSTBACK_IN" }) }));
  });

  it("a campaign reveal: tap stays on the campaign path", async () => {
    h.prisma.automation.findFirst.mockResolvedValue(campaign());
    await processor()(job("process-postback", { instagramAccountId: "ig_1", userId: "user_9", payload: "reveal:auto_1" }));
    expect(h.tap).not.toHaveBeenCalled();
    expect(h.sendDirectMessage).toHaveBeenCalledTimes(1);
  });
});

describe("ig.me links", () => {
  const referral = job("process-referral", { instagramAccountId: "ig_1", igUserId: "user_9", ref: "bio", kind: "referral", timestamp: 1_700_000_000_000 });

  beforeEach(() => {
    h.prisma.conversationLinkOpen.createMany.mockResolvedValue({ count: 1 });
    h.prisma.conversationLink.update.mockResolvedValue({});
  });

  it("a link with an active campaign delivers the campaign and no flow", async () => {
    h.prisma.conversationLink.findFirst.mockResolvedValue({ id: "lk_1", code: "bio", origin: "bio", tagName: null, automationId: "auto_1" });
    h.prisma.automation.findFirst.mockResolvedValue(campaign());
    await processor()(referral);
    expect(h.sendDirectMessage).toHaveBeenCalledTimes(1);
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it("a link without a campaign goes to the flow bound to it", async () => {
    h.prisma.conversationLink.findFirst.mockResolvedValue({ id: "lk_1", code: "bio", origin: "bio", tagName: null, automationId: null });
    await processor()(referral);
    expect(h.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ kinds: ["CONVERSATION_LINK"], conversationLinkId: "lk_1", triggerKey: "ref:ref:1700000000000" })
    );
  });

  it("review: a typed DM's referral leaves flows to the message job (a DM campaign may have answered it)", async () => {
    h.prisma.conversationLink.findFirst.mockResolvedValue({ id: "lk_1", code: "bio", origin: "bio", tagName: null, automationId: null });
    await processor()(
      job("process-referral", {
        instagramAccountId: "ig_1",
        igUserId: "user_9",
        ref: "bio",
        kind: "message",
        mid: "mid_7",
        flowsViaMessage: true,
        timestamp: 1_700_000_000_000,
      })
    );
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.sendDirectMessage).not.toHaveBeenCalled();
  });
});

describe("flow jobs", () => {
  it("go to the engine and never reach the comment path", async () => {
    const p = processor();
    await p(job("flow-start", { instagramAccountId: "ig_1", flowId: "f_1", kind: "COMMENT", triggerKey: "comment:c_1", triggerRef: "c_1", igUserId: "user_9" }));
    await p(job("flow-step", { instagramAccountId: "ig_1", runId: "r_1", nodeId: "n1", seq: 1 }));
    await p(job("flow-reply-timeout", { instagramAccountId: "ig_1", runId: "r_1", nodeId: "w1", seq: 2 }));
    expect(h.startRun).toHaveBeenCalledTimes(1);
    expect(h.stepJob).toHaveBeenCalledTimes(1);
    expect(h.timeoutJob).toHaveBeenCalledTimes(1);
    expect(h.prisma.automation.findMany).not.toHaveBeenCalled();
    expect(h.sendPrivateReply).not.toHaveBeenCalled();
  });

  it("an unknown job without commentId is skipped (an old worker never answers a flow job)", async () => {
    await processor()(job("flow-something-new", { instagramAccountId: "ig_1", triggerRef: "c_1" }));
    expect(h.prisma.automation.findMany).not.toHaveBeenCalled();
  });
});

// ─── QA (Etapa 3): DM that opened an ig.me link ─────────────────────────────
describe("QA: a DM typed after opening an ig.me link", () => {
  beforeEach(() => h.prisma.automation.findMany.mockResolvedValue([]));

  it("link with an active campaign: flows stay out (the REFERRAL job answers with the campaign)", async () => {
    h.prisma.conversationLink.findFirst.mockResolvedValue({ id: "lk_1", automationId: "auto_1" });
    h.prisma.automation.findFirst.mockResolvedValue({ id: "auto_1" });
    await processor()(dm("oi", { linkRef: "bio" }));
    expect(h.resume).not.toHaveBeenCalled();
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.sendDirectMessage).not.toHaveBeenCalled();
  });

  it("link without an active campaign: the link's flow first, then DM flows", async () => {
    h.prisma.conversationLink.findFirst.mockResolvedValue({ id: "lk_1", automationId: "auto_off" });
    h.prisma.automation.findFirst.mockResolvedValue(null);
    await processor()(dm("oi", { linkRef: "bio" }));
    expect(h.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ kinds: ["CONVERSATION_LINK", "DM"], conversationLinkId: "lk_1", triggerKey: "dm:mid_1" })
    );
  });

  it("a database error keeps the flows out (fail-closed); a plain DM never looks links up", async () => {
    h.prisma.conversationLink.findFirst.mockRejectedValue(new Error("db down"));
    await processor()(dm("oi", { linkRef: "bio" }));
    expect(h.dispatch).not.toHaveBeenCalled();

    vi.clearAllMocks();
    h.prisma.automation.findMany.mockResolvedValue([]);
    h.dispatch.mockResolvedValue({ queued: false });
    h.resume.mockResolvedValue(false);
    await processor()(dm("oi"));
    expect(h.prisma.conversationLink.findFirst).not.toHaveBeenCalled();
    expect(h.dispatch).toHaveBeenCalledWith(expect.objectContaining({ kinds: ["DM"] }));
  });

  it("a DM a DM-keyword campaign matches is still the campaign's, with or without a link", async () => {
    h.prisma.automation.findMany.mockResolvedValue([campaign()]);
    await processor()(dm("FOTO", { linkRef: "bio" }));
    expect(h.sendDirectMessage).toHaveBeenCalledTimes(1);
    expect(h.prisma.conversationLink.findFirst).not.toHaveBeenCalled();
    expect(h.dispatch).not.toHaveBeenCalled();
  });
});
