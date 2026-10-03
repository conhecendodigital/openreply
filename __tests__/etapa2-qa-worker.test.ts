/**
 * QA da Etapa 2 (worker, ponta a ponta com o guard, o takeover, o eco e a
 * sequência DE VERDADE; só o banco, a fila e a Meta são falsos):
 *  - takeover bloqueia campanha por DM, toque no botão, follow-up e sequência;
 *  - eco digitado no celular liga o takeover (24 h) e eco nosso não liga;
 *  - takeover vencido não bloqueia mais;
 *  - referral do ig.me dispara a campanha certa, etiqueta a origem e não
 *    duplica (nem com retry, nem com a mesma mensagem pela palavra-chave);
 *  - o CRM da DM não engole erro de banco (BullMQ tenta de novo).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  prisma: {
    automation: { findMany: vi.fn(), findFirst: vi.fn() },
    dmLog: { findUnique: vi.fn(), findFirst: vi.fn(), upsert: vi.fn(), update: vi.fn(), create: vi.fn() },
    draftReply: { updateMany: vi.fn(async () => ({ count: 0 })) },
    conversationLink: { findFirst: vi.fn(), update: vi.fn() },
    conversationLinkOpen: { createMany: vi.fn() },
    instagramAccount: { findUnique: vi.fn() },
    operationalEvent: { create: vi.fn() },
    contact: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), upsert: vi.fn() },
    outboundMessage: { findUnique: vi.fn(), findMany: vi.fn() },
    sequence: { findUnique: vi.fn(async () => null) },
    sequenceEnrollment: { findUnique: vi.fn(), findMany: vi.fn(async () => []), updateMany: vi.fn(async () => ({ count: 1 })) },
    directMessage: { findFirst: vi.fn(async () => null) },
  },
  mockQueueAdd: vi.fn(),
  mockSend: vi.fn(),
  mockSendButton: vi.fn(),
  mockOnDm: vi.fn(),
  mockTrack: vi.fn(),
  mockRecordEvent: vi.fn(async () => true),
}));

vi.mock("@/lib/db/client", () => ({ prisma: h.prisma }));
vi.mock("@/lib/meta/client", () => ({
  sendDirectMessage: h.mockSend,
  sendDirectMessageWithButton: h.mockSendButton,
  sendDirectMessageWithLinkButton: h.mockSendButton,
  sendPrivateReply: h.mockSend,
  sendPrivateReplyWithButton: h.mockSendButton,
  sendPrivateReplyWithLinkButton: h.mockSendButton,
  sendCommentReply: vi.fn(),
  getUserFollowStatus: vi.fn(async () => true),
  MetaApiError: class MetaApiError extends Error {
    code = 0;
  },
  TokenExpiredError: class TokenExpiredError extends Error {},
  RateLimitError: class RateLimitError extends Error {},
}));
vi.mock("@/lib/meta/oauth", () => ({ decryptToken: (t: string) => `plain:${t}` }));
vi.mock("@/lib/meta/send", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/meta/send")>();
  return {
    ...real,
    sendTracked: vi.fn(async (_c: unknown, send: (o: unknown) => Promise<unknown>) => send({ metadata: "le:x:y" })),
  };
});
vi.mock("@/lib/billing/usage", () => ({
  reserveWorkspaceDMSend: vi.fn(async () => ({ allowed: true, periodStart: new Date() })),
  releaseWorkspaceDMReservation: vi.fn(),
}));
vi.mock("@/lib/utils/rate-limiter", () => ({ reserveDMSlot: vi.fn() }));
vi.mock("@/lib/ops/worker-health", () => ({ recordWorkerAlert: vi.fn() }));
vi.mock("@/lib/moderation/moderate", () => ({ moderateComment: vi.fn() }));
vi.mock("@/lib/contacts/record", () => ({
  AUTO_TAGS: { cameFrom: (o: string) => `veio:${o}`, commented: () => "c", received: () => "r" },
  addTagSafe: vi.fn(),
  onDmLogSent: vi.fn(),
  onDirectMessage: h.mockOnDm,
  trackInteraction: h.mockTrack,
  recordEvent: h.mockRecordEvent,
  upsertContact: vi.fn(async () => ({ id: "ct_1", workspaceId: "ws" })),
  resolveAccountByInstagramId: vi.fn(async () => ({ id: "acc_row", workspaceId: "ws", instagramId: "ig_owner" })),
}));
vi.mock("@/lib/queue/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/queue/client")>();
  return { ...real, getDMQueue: () => ({ add: h.mockQueueAdd }), getRedisConnection: vi.fn() };
});
vi.mock("bullmq", () => {
  function MockWorker(_name: string, processor: unknown) {
    (global as Record<string, unknown>).__qaProcessor = processor;
    return { on: vi.fn(), close: vi.fn() };
  }
  class UnrecoverableError extends Error {}
  return { Worker: MockWorker, UnrecoverableError, Queue: vi.fn() };
});

import { createDMWorker } from "../lib/queue/dm-worker";

type Job = { name: string; data: Record<string, unknown>; id: string; attemptsMade: number; timestamp?: number };
function run(job: Job) {
  createDMWorker();
  return ((global as Record<string, unknown>).__qaProcessor as (j: Job) => Promise<void>)(job);
}

const HOUR = 3_600_000;
const ago = (ms: number) => new Date(Date.now() - ms);
const later = (ms: number) => new Date(Date.now() + ms);

/** The person as the guard reads it. */
function person(over: Record<string, unknown> = {}) {
  return {
    id: "ct_1",
    workspaceId: "ws",
    lastInboundAt: ago(HOUR),
    humanTakeover: false,
    humanTakeoverUntil: null,
    ...over,
  };
}
const TAKEN_OVER = { humanTakeover: true, humanTakeoverUntil: later(5 * HOUR) };

const automation = {
  id: "auto_1",
  name: "Campanha",
  workspaceId: "ws",
  instagramAccountId: "acc_row",
  isActive: true,
  dmTriggerEnabled: true,
  matchAnyWord: true,
  keywords: [],
  wholeWordMatch: false,
  dmMessage: "Aqui o link: https://x.com",
  requireFollow: false,
  followUpEnabled: false,
  followUpMessage: null,
  linkButtonLabel: null,
  openingDmEnabled: false,
  instagramAccount: { instagramId: "ig_owner", accessToken: "enc" },
  workspace: { id: "ws" },
  trackedLinks: [],
};

const messageJob = (mid = "mid_in_1"): Job => ({
  name: "process-message",
  id: `m_${mid}`,
  attemptsMade: 0,
  timestamp: Date.now(),
  data: { instagramAccountId: "ig_owner", messageId: mid, messageText: "quero", senderId: "ig_person" },
});

beforeEach(() => {
  vi.clearAllMocks();
  h.prisma.automation.findMany.mockResolvedValue([automation]);
  h.prisma.automation.findFirst.mockResolvedValue(automation);
  h.prisma.dmLog.findUnique.mockResolvedValue(null);
  h.prisma.dmLog.findFirst.mockResolvedValue(null);
  h.prisma.dmLog.upsert.mockResolvedValue({ id: "log_1", commenterId: "ig_person" });
  h.prisma.contact.findFirst.mockResolvedValue(person());
  h.prisma.contact.update.mockResolvedValue({});
  h.prisma.outboundMessage.findUnique.mockResolvedValue(null);
  h.prisma.outboundMessage.findMany.mockResolvedValue([]);
  h.prisma.sequence.findUnique.mockResolvedValue(null);
  h.prisma.sequenceEnrollment.findMany.mockResolvedValue([]);
  h.prisma.sequenceEnrollment.updateMany.mockResolvedValue({ count: 1 });
  h.prisma.directMessage.findFirst.mockResolvedValue(null);
  h.mockSend.mockResolvedValue({ recipient_id: "ig_person", message_id: "m_out" });
  h.mockSendButton.mockResolvedValue({ recipient_id: "ig_person", message_id: "m_out" });
  h.mockOnDm.mockResolvedValue({ contact: { id: "ct_1", workspaceId: "ws" }, inserted: true });
  h.mockTrack.mockResolvedValue({ contact: { id: "ct_1", workspaceId: "ws" }, inserted: true });
});

describe("takeover blocks every automation (real guard)", () => {
  it("control: campaign by DM goes out when nobody took over", async () => {
    await run(messageJob());
    expect(h.mockSend).toHaveBeenCalledTimes(1);
  });

  it("campaign by DM: nothing sent, logged SKIPPED_TAKEOVER", async () => {
    h.prisma.contact.findFirst.mockResolvedValue(person(TAKEN_OVER));
    await run(messageJob());
    expect(h.mockSend).not.toHaveBeenCalled();
    expect(h.prisma.dmLog.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ status: "SKIPPED_TAKEOVER" }) })
    );
  });

  it("an expired takeover no longer blocks (it turns off by itself)", async () => {
    h.prisma.contact.findFirst.mockResolvedValue(person({ humanTakeover: true, humanTakeoverUntil: ago(60_000) }));
    await run(messageJob());
    expect(h.mockSend).toHaveBeenCalledTimes(1);
  });

  it("button tap (reveal): nothing sent", async () => {
    h.prisma.contact.findFirst.mockResolvedValue(person(TAKEN_OVER));
    await run({
      name: "process-postback",
      id: "p1",
      attemptsMade: 0,
      data: { instagramAccountId: "ig_owner", userId: "ig_person", payload: "reveal:auto_1" },
    });
    expect(h.mockSend).not.toHaveBeenCalled();
    expect(h.mockSendButton).not.toHaveBeenCalled();
  });

  it("follow-up: nothing sent under takeover, nor with the window closed", async () => {
    const followAutomation = { ...automation, followUpEnabled: true, followUpMessage: "deu certo?" };
    h.prisma.automation.findFirst.mockResolvedValue(followAutomation);
    const job: Job = {
      name: "process-followup",
      id: "f1",
      attemptsMade: 0,
      data: { instagramAccountId: "ig_owner", userId: "ig_person", automationId: "auto_1" },
    };
    h.prisma.contact.findFirst.mockResolvedValue(person(TAKEN_OVER));
    await run(job);
    h.prisma.contact.findFirst.mockResolvedValue(person({ lastInboundAt: ago(25 * HOUR) }));
    await run(job);
    expect(h.mockSend).not.toHaveBeenCalled();
  });

  it("sequence step: stops as STOPPED_TAKEOVER and sends nothing", async () => {
    h.prisma.sequenceEnrollment.findUnique.mockResolvedValue({
      id: "en_1",
      status: "ACTIVE",
      lastStepOrder: 0,
      waitingReply: false,
      startedAt: ago(10 * 60_000),
      contact: { id: "ct_1", workspaceId: "ws", igUserId: "ig_person", username: "p", lastInboundAt: ago(HOUR), ...TAKEN_OVER },
      sequence: {
        isActive: true,
        steps: [{ order: 1, message: "passo 1", delayMinutes: 5 }],
        automation: { ...automation, instagramAccount: { instagramId: "ig_owner", accessToken: "enc" } },
      },
    });
    await run({ name: "sequence-step", id: "s1", attemptsMade: 0, data: { instagramAccountId: "ig_owner", enrollmentId: "en_1", order: 1 } });
    expect(h.mockSend).not.toHaveBeenCalled();
    expect(h.prisma.sequenceEnrollment.updateMany).toHaveBeenCalledWith({
      where: { id: "en_1", status: "ACTIVE" },
      data: expect.objectContaining({ status: "STOPPED_TAKEOVER" }),
    });
  });
});

describe("takeover turns on when the owner answers by hand (real echo + takeover)", () => {
  const crm = (data: Record<string, unknown>): Job => ({
    name: "crm-dm",
    id: "c1",
    attemptsMade: 0,
    data: {
      instagramAccountId: "ig_owner",
      igUserId: "ig_person",
      mid: "mid_echo",
      fromMe: true,
      text: "oi, sou eu no celular",
      sentAt: new Date().toISOString(),
      storyReply: false,
      metadata: null,
      appId: null,
      hasTemplate: false,
      ...data,
    },
  });

  beforeEach(() => {
    h.prisma.contact.findUnique.mockResolvedValue({
      id: "ct_1",
      workspaceId: "ws",
      humanTakeover: false,
      humanTakeoverUntil: null,
      instagramAccount: { takeoverHours: 24 },
    });
  });

  it("an echo typed on the phone (late pass, no proof it was ours) turns takeover on for 24 h and stops sequences", async () => {
    const before = Date.now();
    await run(crm({ late: true }));
    const update = h.prisma.contact.update.mock.calls[0][0];
    expect(update.data).toMatchObject({ humanTakeover: true, humanTakeoverReason: "phone_echo", humanTakeoverBy: "echo" });
    const until = (update.data.humanTakeoverUntil as Date).getTime();
    expect(until - before).toBeGreaterThanOrEqual(24 * HOUR - 1000);
    expect(until - before).toBeLessThanOrEqual(24 * HOUR + 5000);
    expect(h.prisma.sequenceEnrollment.updateMany).toHaveBeenCalledWith({
      where: { contactId: "ct_1", status: "ACTIVE" },
      data: expect.objectContaining({ status: "STOPPED_TAKEOVER" }),
    });
  });

  it("first pass without proof schedules one re-check instead of guessing", async () => {
    await run(crm({}));
    expect(h.prisma.contact.update).not.toHaveBeenCalled();
    expect(h.mockQueueAdd).toHaveBeenCalledWith("crm-dm", expect.objectContaining({ late: true }), expect.objectContaining({ delay: 20_000 }));
  });

  it("echo of an approved draft / automation (our metadata, or mid in the ledger) never turns takeover on", async () => {
    await run(crm({ metadata: "le:draft:d_1", late: true }));
    h.prisma.outboundMessage.findUnique.mockResolvedValue({ origin: "automation" });
    await run(crm({ mid: "mid_auto", late: true }));
    expect(h.prisma.contact.update).not.toHaveBeenCalled();
  });

  it("a database error in the CRM fails the job (BullMQ retries) instead of dropping the DM", async () => {
    h.mockOnDm.mockRejectedValue(new Error("connection reset"));
    await expect(run(crm({ fromMe: false, text: "oi" }))).rejects.toThrow("connection reset");
    expect(h.mockOnDm).toHaveBeenCalledWith(expect.anything(), { throwOnError: true });
  });
});

describe("ig.me referral (real worker path)", () => {
  const link = { id: "l1", code: "story1", origin: "story", tagName: null, automationId: "auto_1" };
  const refJob = (data: Record<string, unknown> = {}, attemptsMade = 0): Job => ({
    name: "process-referral",
    id: "r1",
    attemptsMade,
    data: { instagramAccountId: "ig_owner", igUserId: "ig_person", ref: "story1", kind: "referral", timestamp: 1_700_000_000_000, ...data },
  });

  beforeEach(() => {
    h.prisma.conversationLink.findFirst.mockResolvedValue(link);
    h.prisma.conversationLinkOpen.createMany.mockResolvedValue({ count: 1 });
  });

  it("fires the campaign linked to THAT code on THAT account, tags veio:story and counts the open", async () => {
    await run(refJob());
    expect(h.prisma.conversationLink.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { code: "story1", isActive: true, instagramAccount: { instagramId: "ig_owner" } } })
    );
    expect(h.prisma.automation.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "auto_1", isActive: true } }));
    expect(h.mockTrack).toHaveBeenCalledWith(expect.objectContaining({ tags: ["veio:story"] }), { throwOnError: true });
    expect(h.prisma.conversationLink.update).toHaveBeenCalledWith({ where: { id: "l1" }, data: { opens: { increment: 1 } } });
    expect(h.mockSend).toHaveBeenCalledTimes(1);
  });

  it("a campaign of another account is never fired by this link", async () => {
    h.prisma.automation.findFirst.mockResolvedValue({ ...automation, instagramAccount: { instagramId: "ig_other", accessToken: "enc" } });
    await run(refJob());
    expect(h.mockSend).not.toHaveBeenCalled();
  });

  it("a custom tag on the link wins over veio:<origem>", async () => {
    h.prisma.conversationLink.findFirst.mockResolvedValue({ ...link, tagName: "lead-bio" });
    await run(refJob());
    expect(h.mockTrack).toHaveBeenCalledWith(expect.objectContaining({ tags: ["lead-bio"] }), { throwOnError: true });
  });

  it("the same event again (webhook retry) counts nothing and sends nothing", async () => {
    h.prisma.conversationLinkOpen.createMany.mockResolvedValue({ count: 0 });
    h.prisma.dmLog.findUnique.mockResolvedValue({ status: "SENT" });
    await run(refJob());
    expect(h.prisma.conversationLink.update).not.toHaveBeenCalled();
    expect(h.mockSend).not.toHaveBeenCalled();
  });

  it("a job retried after the campaign send failed still delivers it (the open was already counted)", async () => {
    h.prisma.conversationLinkOpen.createMany.mockResolvedValue({ count: 0 });
    h.prisma.dmLog.findUnique.mockResolvedValue({ status: "FAILED" });
    await run(refJob({}, 1));
    expect(h.prisma.conversationLink.update).not.toHaveBeenCalled();
    expect(h.mockSend).toHaveBeenCalledTimes(1);
  });

  it("link opened by a typed message: shares the DM-keyword key, so the same campaign answers once", async () => {
    // processMessage already answered mid_in_1 with this campaign.
    h.prisma.dmLog.findUnique.mockImplementation(async (args: { where: { automationId_commentId: { commentId: string } } }) =>
      args.where.automationId_commentId.commentId === "dm:mid_in_1" ? { status: "SENT" } : null
    );
    await run(refJob({ kind: "message", mid: "mid_in_1" }));
    expect(h.mockSend).not.toHaveBeenCalled();
    // And the other order: the referral answered first, the keyword path skips.
    h.prisma.dmLog.findUnique.mockReset();
    h.prisma.dmLog.findUnique.mockResolvedValue(null);
    await run(refJob({ kind: "message", mid: "mid_in_2" }));
    expect(h.prisma.dmLog.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { automationId_commentId: { automationId: "auto_1", commentId: "dm:mid_in_2" } } })
    );
  });

  it("an unknown or switched-off code does nothing at all", async () => {
    h.prisma.conversationLink.findFirst.mockResolvedValue(null);
    await run(refJob({ ref: "nao-existe" }));
    expect(h.mockTrack).not.toHaveBeenCalled();
    expect(h.mockSend).not.toHaveBeenCalled();
  });

  it("under takeover the link still tags the origin but sends nothing", async () => {
    h.prisma.contact.findFirst.mockResolvedValue(person(TAKEN_OVER));
    await run(refJob());
    expect(h.mockTrack).toHaveBeenCalled();
    expect(h.mockSend).not.toHaveBeenCalled();
  });
});
