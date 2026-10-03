/**
 * QA dos Canais (worker DE VERDADE, com o sendTracked e o status do canal
 * reais; só o banco, a fila e a Meta são falsos):
 *  - conta DISCONNECTED / NEEDS_RECONNECT não automatiza nada (DM, botão,
 *    follow-up, referral, sequência) e não envia nada;
 *  - canal que desliga no meio do job: nada sai, o job não é repetido;
 *  - erro 190 da Meta marca NEEDS_RECONNECT e não apaga nada.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  accountStatus: { value: "ACTIVE" as string },
  prisma: {
    automation: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
    dmLog: { findUnique: vi.fn(), findFirst: vi.fn(), upsert: vi.fn(), update: vi.fn(), create: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
    draftReply: { updateMany: vi.fn(async () => ({ count: 0 })) },
    conversationLink: { findFirst: vi.fn(), update: vi.fn() },
    conversationLinkOpen: { createMany: vi.fn() },
    instagramAccount: { findUnique: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
    operationalEvent: { create: vi.fn() },
    contact: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), upsert: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
    outboundMessage: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    sequence: { findUnique: vi.fn(async () => null) },
    sequenceEnrollment: { findUnique: vi.fn(), findMany: vi.fn(async () => []), updateMany: vi.fn(async () => ({ count: 1 })) },
    directMessage: { findFirst: vi.fn(async () => null), delete: vi.fn(), deleteMany: vi.fn() },
  },
  mockQueueAdd: vi.fn(),
  mockSend: vi.fn(),
  mockSendButton: vi.fn(),
  mockOnDm: vi.fn(),
  mockTrack: vi.fn(),
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
  recordEvent: vi.fn(async () => true),
  upsertContact: vi.fn(async () => ({ id: "ct_1", workspaceId: "ws" })),
  resolveAccountByInstagramId: vi.fn(async () => ({ id: "acc_row", workspaceId: "ws", instagramId: "ig_owner" })),
  clearAccountCache: vi.fn(),
}));
vi.mock("@/lib/queue/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/queue/client")>();
  return { ...real, getDMQueue: () => ({ add: h.mockQueueAdd }), getRedisConnection: vi.fn() };
});
vi.mock("bullmq", () => {
  function MockWorker(_name: string, processor: unknown) {
    (global as Record<string, unknown>).__chProcessor = processor;
    return { on: vi.fn(), close: vi.fn() };
  }
  class UnrecoverableError extends Error {}
  return { Worker: MockWorker, UnrecoverableError, Queue: vi.fn() };
});

import { createDMWorker } from "../lib/queue/dm-worker";

type Job = { name: string; data: Record<string, unknown>; id: string; attemptsMade: number; timestamp?: number };
function run(job: Job) {
  createDMWorker();
  return ((global as Record<string, unknown>).__chProcessor as (j: Job) => Promise<void>)(job);
}

const HOUR = 3_600_000;
const ago = (ms: number) => new Date(Date.now() - ms);

const automation = () => ({
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
  followUpEnabled: true,
  followUpMessage: "deu certo?",
  linkButtonLabel: null,
  openingDmEnabled: false,
  instagramAccount: { id: "acc_row", instagramId: "ig_owner", accessToken: "enc", status: h.accountStatus.value },
  workspace: { id: "ws" },
  trackedLinks: [],
});

/** A fake DB that honours the `instagramAccount.status` filter of the query. */
function honoursStatus(where: { instagramAccount?: { status?: string } } | undefined) {
  const wanted = where?.instagramAccount?.status;
  return wanted === undefined || wanted === h.accountStatus.value;
}

const messageJob = (mid = "mid_in_1"): Job => ({
  name: "process-message",
  id: `m_${mid}`,
  attemptsMade: 0,
  timestamp: Date.now(),
  data: { instagramAccountId: "ig_owner", messageId: mid, messageText: "quero", senderId: "ig_person" },
});

function noDeletes() {
  for (const [name, model] of Object.entries(h.prisma)) {
    for (const method of ["delete", "deleteMany"] as const) {
      const fn = (model as Record<string, ReturnType<typeof vi.fn>>)[method];
      if (fn) expect(fn, `${name}.${method}`).not.toHaveBeenCalled();
    }
  }
  expect(h.prisma.automation.update).not.toHaveBeenCalled();
  expect(h.prisma.automation.updateMany).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  h.accountStatus.value = "ACTIVE";
  h.prisma.automation.findMany.mockImplementation(async (args: { where?: { instagramAccount?: { status?: string } } }) =>
    honoursStatus(args?.where) ? [automation()] : []
  );
  h.prisma.automation.findFirst.mockImplementation(async (args: { where?: { instagramAccount?: { status?: string } } }) =>
    honoursStatus(args?.where) ? automation() : null
  );
  // sendTracked reads the account status (assertAccountActive).
  h.prisma.instagramAccount.findUnique.mockImplementation(async () => ({ status: h.accountStatus.value }));
  h.prisma.instagramAccount.updateMany.mockResolvedValue({ count: 1 });
  h.prisma.instagramAccount.findFirst.mockResolvedValue({ workspaceId: "ws", username: "omatheus.ai" });
  h.prisma.dmLog.findUnique.mockResolvedValue(null);
  h.prisma.dmLog.findFirst.mockResolvedValue(null);
  h.prisma.dmLog.upsert.mockResolvedValue({ id: "log_1", commenterId: "ig_person" });
  h.prisma.dmLog.update.mockResolvedValue({ id: "log_1" });
  h.prisma.contact.findFirst.mockResolvedValue({
    id: "ct_1",
    workspaceId: "ws",
    lastInboundAt: ago(HOUR),
    humanTakeover: false,
    humanTakeoverUntil: null,
  });
  h.prisma.contact.update.mockResolvedValue({});
  h.prisma.outboundMessage.findUnique.mockResolvedValue(null);
  h.prisma.outboundMessage.findMany.mockResolvedValue([]);
  h.prisma.outboundMessage.create.mockResolvedValue({ id: "row_1" });
  h.prisma.outboundMessage.update.mockResolvedValue({});
  h.prisma.sequence.findUnique.mockResolvedValue(null);
  h.prisma.sequenceEnrollment.findMany.mockResolvedValue([]);
  h.prisma.sequenceEnrollment.updateMany.mockResolvedValue({ count: 1 });
  h.prisma.directMessage.findFirst.mockResolvedValue(null);
  h.prisma.conversationLink.findFirst.mockResolvedValue({ id: "l1", code: "story1", origin: "story", tagName: null, automationId: "auto_1" });
  h.prisma.conversationLinkOpen.createMany.mockResolvedValue({ count: 1 });
  h.mockSend.mockResolvedValue({ recipient_id: "ig_person", message_id: "m_out" });
  h.mockSendButton.mockResolvedValue({ recipient_id: "ig_person", message_id: "m_out" });
  h.mockOnDm.mockResolvedValue({ contact: { id: "ct_1", workspaceId: "ws" }, inserted: true });
  h.mockTrack.mockResolvedValue({ contact: { id: "ct_1", workspaceId: "ws" }, inserted: true });
});

describe("control: an ACTIVE channel still automates", () => {
  it("campaign by DM goes out through sendTracked", async () => {
    await run(messageJob());
    expect(h.mockSend).toHaveBeenCalledTimes(1);
    expect(h.prisma.outboundMessage.create).toHaveBeenCalledTimes(1);
  });
});

describe.each(["DISCONNECTED", "NEEDS_RECONNECT"])("a %s channel runs nothing and sends nothing", (status) => {
  beforeEach(() => {
    h.accountStatus.value = status;
  });

  it("campaign by DM keyword", async () => {
    await run(messageJob());
    expect(h.prisma.automation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ instagramAccount: { instagramId: "ig_owner", status: "ACTIVE" } }),
      })
    );
    expect(h.mockSend).not.toHaveBeenCalled();
    expect(h.mockSendButton).not.toHaveBeenCalled();
    noDeletes();
  });

  it("button tap (reveal), follow-up and ig.me referral", async () => {
    await run({ name: "process-postback", id: "p1", attemptsMade: 0, data: { instagramAccountId: "ig_owner", userId: "ig_person", payload: "reveal:auto_1" } });
    await run({ name: "process-followup", id: "f1", attemptsMade: 0, data: { instagramAccountId: "ig_owner", userId: "ig_person", automationId: "auto_1" } });
    await run({
      name: "process-referral",
      id: "r1",
      attemptsMade: 0,
      data: { instagramAccountId: "ig_owner", igUserId: "ig_person", ref: "story1", kind: "referral", timestamp: 1_700_000_000_000 },
    });
    expect(h.mockSend).not.toHaveBeenCalled();
    expect(h.mockSendButton).not.toHaveBeenCalled();
    // The open is still counted (history), only delivery needs ACTIVE.
    expect(h.prisma.conversationLink.update).toHaveBeenCalledWith({ where: { id: "l1" }, data: { opens: { increment: 1 } } });
    noDeletes();
  });

  it("sequence step: stops (STOPPED_OFF), sends nothing, the enrollment row stays", async () => {
    h.prisma.sequenceEnrollment.findUnique.mockResolvedValue({
      id: "en_1",
      status: "ACTIVE",
      lastStepOrder: 0,
      waitingReply: false,
      startedAt: ago(10 * 60_000),
      contact: { id: "ct_1", workspaceId: "ws", igUserId: "ig_person", username: "p", lastInboundAt: ago(HOUR), humanTakeover: false, humanTakeoverUntil: null },
      sequence: {
        isActive: true,
        steps: [{ order: 1, message: "passo 1", delayMinutes: 5 }],
        automation: automation(),
      },
    });
    await run({ name: "sequence-step", id: "s1", attemptsMade: 0, data: { instagramAccountId: "ig_owner", enrollmentId: "en_1", order: 1 } });
    expect(h.mockSend).not.toHaveBeenCalled();
    expect(h.prisma.sequenceEnrollment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "STOPPED_OFF" }) })
    );
    noDeletes();
  });
});

describe("the channel goes off in the middle of a job", () => {
  it("found ACTIVE by the query, DISCONNECTED at send time: nothing goes out, the job is not retried", async () => {
    // The campaign query still sees ACTIVE; sendTracked re-reads the account.
    h.prisma.instagramAccount.findUnique.mockResolvedValue({ status: "DISCONNECTED" });
    await expect(run(messageJob())).resolves.toBeUndefined();
    expect(h.mockSend).not.toHaveBeenCalled();
    expect(h.prisma.outboundMessage.create).not.toHaveBeenCalled();
    noDeletes();
  });
});

describe("Meta rejects the token (190) during a send", () => {
  it("marks the channel NEEDS_RECONNECT (only if it was ACTIVE) and deletes nothing", async () => {
    const rejected = Object.assign(new Error("Error validating access token"), { name: "TokenExpiredError" });
    h.mockSend.mockRejectedValue(rejected);
    await run(messageJob()).catch(() => undefined);
    expect(h.prisma.instagramAccount.updateMany).toHaveBeenCalledWith({
      where: { id: "acc_row", status: "ACTIVE" },
      data: expect.objectContaining({ status: "NEEDS_RECONNECT" }),
    });
    noDeletes();
  });
});
