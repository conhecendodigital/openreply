/**
 * Etapa 2 no worker: CRM_DM_JOB (eco do celular liga takeover, eco nosso não,
 * resposta para a sequência), REFERRAL_JOB (etiqueta veio:<origem>, conta a
 * abertura uma vez, dispara a campanha) e o guard antes de qualquer DM.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  mockPrisma: {
    automation: { findMany: vi.fn(), findFirst: vi.fn() },
    dmLog: { findUnique: vi.fn(), findFirst: vi.fn(), upsert: vi.fn(), update: vi.fn(), create: vi.fn() },
    draftReply: { updateMany: vi.fn(async () => ({ count: 0 })) },
    conversationLink: { findFirst: vi.fn(), update: vi.fn() },
    conversationLinkOpen: { createMany: vi.fn() },
    instagramAccount: { findUnique: vi.fn() },
    operationalEvent: { create: vi.fn() },
  },
  mockQueueAdd: vi.fn(),
  mockSendDirectMessage: vi.fn(),
  mockCheck: vi.fn(),
  mockClassify: vi.fn(),
  mockStartTakeover: vi.fn(),
  mockOnReplied: vi.fn(),
  mockEnroll: vi.fn(),
  mockOnDm: vi.fn(),
  mockTrack: vi.fn(),
  mockResolve: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: h.mockPrisma }));
vi.mock("@/lib/meta/client", () => ({
  sendDirectMessage: h.mockSendDirectMessage,
  sendDirectMessageWithButton: vi.fn(),
  sendDirectMessageWithLinkButton: vi.fn(),
  sendPrivateReply: vi.fn(),
  sendPrivateReplyWithButton: vi.fn(),
  sendPrivateReplyWithLinkButton: vi.fn(),
  sendCommentReply: vi.fn(),
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
vi.mock("@/lib/utils/rate-limiter", () => ({ reserveDMSlot: vi.fn() }));
vi.mock("@/lib/ops/worker-health", () => ({ recordWorkerAlert: vi.fn() }));
vi.mock("@/lib/moderation/moderate", () => ({ moderateComment: vi.fn() }));
vi.mock("@/lib/messaging/guard", () => ({ checkAutomation: h.mockCheck }));
vi.mock("@/lib/messaging/echo", () => ({ classifyEcho: h.mockClassify, ECHO_RECHECK_DELAY_MS: 20_000 }));
vi.mock("@/lib/messaging/takeover", () => ({ startTakeover: h.mockStartTakeover }));
vi.mock("@/lib/sequences/engine", () => ({
  enrollInSequence: h.mockEnroll,
  onPersonReplied: h.mockOnReplied,
  runSequenceStep: vi.fn(),
}));
vi.mock("@/lib/contacts/record", () => ({
  AUTO_TAGS: { cameFrom: (o: string) => `veio:${o}`, commented: () => "c", received: () => "r" },
  addTagSafe: vi.fn(),
  onDmLogSent: vi.fn(),
  onDirectMessage: h.mockOnDm,
  trackInteraction: h.mockTrack,
  resolveAccountByInstagramId: h.mockResolve,
}));
vi.mock("@/lib/queue/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/queue/client")>();
  return { ...real, getDMQueue: () => ({ add: h.mockQueueAdd }), getRedisConnection: vi.fn() };
});
vi.mock("bullmq", () => {
  function MockWorker(_name: string, processor: unknown) {
    (global as Record<string, unknown>).__etapa2Processor = processor;
    return { on: vi.fn(), close: vi.fn() };
  }
  class UnrecoverableError extends Error {}
  return { Worker: MockWorker, UnrecoverableError, Queue: vi.fn() };
});

import { createDMWorker } from "../lib/queue/dm-worker";

type Proc = (job: { name: string; data: Record<string, unknown>; id: string; attemptsMade: number; timestamp?: number }) => Promise<void>;
function processor(): Proc {
  createDMWorker();
  return (global as Record<string, unknown>).__etapa2Processor as Proc;
}

const ACC = { id: "acc_row", workspaceId: "ws", instagramId: "ig_owner" };
const crmJob = (data: Record<string, unknown>) => ({
  name: "crm-dm",
  id: "j1",
  attemptsMade: 0,
  data: {
    instagramAccountId: "ig_owner",
    igUserId: "ig_person",
    mid: "mid_1",
    fromMe: true,
    text: "oi, sou eu no celular",
    sentAt: "2026-10-04T12:00:00.000Z",
    storyReply: false,
    metadata: null,
    appId: null,
    hasTemplate: false,
    ...data,
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  h.mockResolve.mockResolvedValue(ACC);
  h.mockOnDm.mockResolvedValue({ contact: { id: "ct_1", workspaceId: "ws" }, inserted: true });
  h.mockTrack.mockResolvedValue({ contact: { id: "ct_1", workspaceId: "ws" }, inserted: true });
  h.mockCheck.mockResolvedValue({ ok: true, contact: null });
  h.mockPrisma.dmLog.findUnique.mockResolvedValue(null);
  h.mockPrisma.dmLog.findFirst.mockResolvedValue(null);
  h.mockPrisma.dmLog.upsert.mockResolvedValue({ id: "log_1", commenterId: "ig_person" });
  h.mockSendDirectMessage.mockResolvedValue({ recipient_id: "ig_person", message_id: "m" });
});

describe("CRM_DM_JOB", () => {
  it("an echo typed on the phone turns takeover on", async () => {
    h.mockClassify.mockResolvedValue({ kind: "phone" });
    await processor()(crmJob({ late: true }));
    expect(h.mockOnDm).toHaveBeenCalledWith(expect.objectContaining({ fromMe: true, mid: "mid_1" }), { throwOnError: true });
    expect(h.mockStartTakeover).toHaveBeenCalledWith(expect.objectContaining({ contactId: "ct_1", reason: "phone_echo", by: "echo" }));
  });

  it("an echo of our own send never turns takeover on", async () => {
    h.mockClassify.mockResolvedValue({ kind: "ours", origin: "draft", via: "metadata" });
    await processor()(crmJob({ metadata: "le:draft:d1" }));
    expect(h.mockStartTakeover).not.toHaveBeenCalled();
    expect(h.mockQueueAdd).not.toHaveBeenCalled();
  });

  it("an echo not yet provable is looked at again ~20 s later, once", async () => {
    h.mockClassify.mockResolvedValue({ kind: "unknown" });
    await processor()(crmJob({}));
    expect(h.mockStartTakeover).not.toHaveBeenCalled();
    expect(h.mockQueueAdd).toHaveBeenCalledWith(
      "crm-dm",
      expect.objectContaining({ late: true, mid: "mid_1" }),
      expect.objectContaining({ delay: 20_000 })
    );
  });

  it("an inbound DM stops (or starts) the person's sequences, never takeover", async () => {
    await processor()(crmJob({ fromMe: false, text: "valeu" }));
    expect(h.mockOnReplied).toHaveBeenCalledWith({ contactId: "ct_1", instagramId: "ig_owner", at: new Date("2026-10-04T12:00:00.000Z") });
    expect(h.mockClassify).not.toHaveBeenCalled();
    expect(h.mockStartTakeover).not.toHaveBeenCalled();
  });
});

describe("REFERRAL_JOB", () => {
  const job = {
    name: "process-referral",
    id: "r1",
    attemptsMade: 0,
    data: { instagramAccountId: "ig_owner", igUserId: "ig_person", ref: "story1", kind: "referral", timestamp: 1_700_000_000_000 },
  };
  const automation = {
    id: "auto_1",
    workspaceId: "ws",
    instagramAccountId: "acc_row",
    isActive: true,
    dmMessage: "Aqui o link: https://x.com",
    requireFollow: false,
    followUpEnabled: false,
    linkButtonLabel: null,
    instagramAccount: { instagramId: "ig_owner", accessToken: "enc", status: "ACTIVE" },
    trackedLinks: [],
  };

  it("tags veio:<origem>, counts the open once and delivers the linked campaign", async () => {
    h.mockPrisma.conversationLink.findFirst.mockResolvedValue({ id: "l1", code: "story1", origin: "story", tagName: null, automationId: "auto_1" });
    h.mockPrisma.conversationLinkOpen.createMany.mockResolvedValue({ count: 1 });
    h.mockPrisma.automation.findFirst.mockResolvedValue(automation);
    await processor()(job);

    expect(h.mockTrack).toHaveBeenCalledWith(
      expect.objectContaining({
        igUserId: "ig_person",
        event: expect.objectContaining({ type: "REFERRAL", refId: "l1:ref:1700000000000" }),
        tags: ["veio:story"],
      }),
      { throwOnError: true }
    );
    expect(h.mockPrisma.conversationLink.update).toHaveBeenCalledWith({ where: { id: "l1" }, data: { opens: { increment: 1 } } });
    expect(h.mockSendDirectMessage).toHaveBeenCalledTimes(1);
    expect(h.mockPrisma.dmLog.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { automationId_commentId: { automationId: "auto_1", commentId: "ref:ref:1700000000000" } } })
    );
    expect(h.mockEnroll).toHaveBeenCalled();
  });

  it("a retried webhook counts nothing twice and sends nothing", async () => {
    h.mockPrisma.conversationLink.findFirst.mockResolvedValue({ id: "l1", code: "story1", origin: "story", tagName: null, automationId: "auto_1" });
    h.mockPrisma.conversationLinkOpen.createMany.mockResolvedValue({ count: 0 });
    h.mockPrisma.automation.findFirst.mockResolvedValue(automation);
    // The first run already delivered the campaign.
    h.mockPrisma.dmLog.findUnique.mockResolvedValue({ status: "SENT" });
    await processor()(job);
    expect(h.mockPrisma.conversationLink.update).not.toHaveBeenCalled();
    expect(h.mockSendDirectMessage).not.toHaveBeenCalled();
  });

  it("takeover: the link campaign stays quiet (logged SKIPPED_TAKEOVER)", async () => {
    h.mockPrisma.conversationLink.findFirst.mockResolvedValue({ id: "l1", code: "story1", origin: "story", tagName: null, automationId: "auto_1" });
    h.mockPrisma.conversationLinkOpen.createMany.mockResolvedValue({ count: 1 });
    h.mockPrisma.automation.findFirst.mockResolvedValue(automation);
    h.mockCheck.mockResolvedValue({ ok: false, reason: "takeover", contact: null });
    await processor()(job);
    expect(h.mockSendDirectMessage).not.toHaveBeenCalled();
    expect(h.mockPrisma.dmLog.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ status: "SKIPPED_TAKEOVER" }) })
    );
  });

  it("unknown codes do nothing", async () => {
    h.mockPrisma.conversationLink.findFirst.mockResolvedValue(null);
    await processor()(job);
    expect(h.mockTrack).not.toHaveBeenCalled();
  });
});

describe("follow-up respects the guard", () => {
  it("does not send when the window is closed", async () => {
    h.mockPrisma.automation.findFirst.mockResolvedValue({
      id: "auto_1",
      workspaceId: "ws",
      instagramAccountId: "acc_row",
      followUpEnabled: true,
      followUpMessage: "e aí, deu certo?",
      instagramAccount: { instagramId: "ig_owner", accessToken: "enc", status: "ACTIVE" },
    });
    h.mockCheck.mockResolvedValue({ ok: false, reason: "window_closed", contact: null });
    await processor()({
      name: "process-followup",
      id: "f1",
      attemptsMade: 0,
      data: { instagramAccountId: "ig_owner", userId: "ig_person", automationId: "auto_1" },
    });
    expect(h.mockSendDirectMessage).not.toHaveBeenCalled();
  });
});
