/**
 * Etapa 5: teste A/B no worker das campanhas. Sem A/B (campo ausente ou
 * false) o caminho é IDÊNTICO ao de antes: nenhuma busca de variante, mesmo
 * texto, nenhum variantKey gravado. Com A/B: a variante da pessoa, a mesma
 * letra no comentário e no toque, e falha na busca nunca custa a DM.
 * Também: botões de disparo (bc:) e jobs de disparo nunca viram campanha.
 * (Mesmos mocks de __tests__/dm-worker.test.ts.)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockPrisma,
  mockSendPrivateReply,
  mockSendPrivateReplyWithLinkButton,
  mockSendPrivateReplyWithButton,
  mockGetUserFollowStatus,
  mockSendDirectMessageWithButton,
  mockSendDirectMessage,
  mockSendDirectMessageWithLinkButton,
  mockDecryptToken,
  mockMatchKeywords,
  mockReserveDMSlot,
  mockQueueAdd,
  mockReserveWorkspaceDMSend,
  mockReleaseWorkspaceDMReservation,
  mockRouteBroadcastTap,
  mockRunBroadcastBatch,
  mockRunBroadcastStart,
  LEDGER_OPTIONS,
} = vi.hoisted(() => ({
  mockRouteBroadcastTap: vi.fn(),
  mockRunBroadcastBatch: vi.fn(),
  mockRunBroadcastStart: vi.fn(),
  LEDGER_OPTIONS: { metadata: "le:test:row" },
  mockPrisma: {
    automation: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    campaignVariant: {
      findMany: vi.fn(),
    },
    dmLog: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    instagramAccount: {
      findUnique: vi.fn(),
    },
    operationalEvent: {
      create: vi.fn(),
    },
  },
  mockSendPrivateReply: vi.fn(),
  mockSendPrivateReplyWithLinkButton: vi.fn(),
  mockSendPrivateReplyWithButton: vi.fn(),
  mockGetUserFollowStatus: vi.fn(),
  mockSendDirectMessageWithButton: vi.fn(),
  mockSendDirectMessage: vi.fn(),
  mockSendDirectMessageWithLinkButton: vi.fn(),
  mockDecryptToken: vi.fn(),
  mockMatchKeywords: vi.fn(),
  mockReserveDMSlot: vi.fn(),
  mockQueueAdd: vi.fn(),
  mockReserveWorkspaceDMSend: vi.fn(),
  mockReleaseWorkspaceDMReservation: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  prisma: mockPrisma,
}));

vi.mock("@/lib/meta/client", () => ({
  sendPrivateReply: mockSendPrivateReply,
  sendPrivateReplyWithLinkButton: mockSendPrivateReplyWithLinkButton,
  sendPrivateReplyWithButton: mockSendPrivateReplyWithButton,
  getUserFollowStatus: mockGetUserFollowStatus,
  sendDirectMessageWithButton: mockSendDirectMessageWithButton,
  sendDirectMessage: mockSendDirectMessage,
  sendDirectMessageWithLinkButton: mockSendDirectMessageWithLinkButton,
  sendCommentReply: vi.fn(),
  MetaApiError: class MetaApiError extends Error {
    code: number;
    constructor(
      code: number,
      _subcode: number | undefined,
      _fbTraceId: string | undefined,
      message: string
    ) {
      super(message);
      this.code = code;
      this.name = "MetaApiError";
    }
  },
  TokenExpiredError: class TokenExpiredError extends Error {
    name = "TokenExpiredError";
  },
  RateLimitError: class RateLimitError extends Error {
    name = "RateLimitError";
  },
}));

vi.mock("@/lib/meta/oauth", () => ({
  decryptToken: mockDecryptToken,
}));

vi.mock("@/lib/utils/keyword-matcher", () => ({
  matchKeywords: mockMatchKeywords,
}));

vi.mock("@/lib/utils/rate-limiter", () => ({
  reserveDMSlot: mockReserveDMSlot,
}));

vi.mock("@/lib/billing/usage", () => ({
  reserveWorkspaceDMSend: mockReserveWorkspaceDMSend,
  releaseWorkspaceDMReservation: mockReleaseWorkspaceDMReservation,
}));

// CRM and moderation are covered in their own tests; here they are inert.
vi.mock("@/lib/contacts/record", () => ({
  AUTO_TAGS: { commented: (k: string) => `comentou:${k}`, received: (n: string) => `recebeu:${n}` },
  addTagSafe: vi.fn(),
  onDmLogSent: vi.fn(),
  trackInteraction: vi.fn(async () => null),
}));

// Etapa 2 guards and ledger: inert here (own tests in etapa2-*.test.ts). The
// ledger mock passes { metadata } to every send, as lib/meta/send.ts does.
vi.mock("@/lib/messaging/guard", () => ({
  checkAutomation: vi.fn(async () => ({ ok: true, contact: null })),
}));
vi.mock("@/lib/meta/send", () => ({
  sendTracked: vi.fn(async (_ctx: unknown, send: (o?: unknown) => Promise<unknown>) => send(LEDGER_OPTIONS)),
}));
vi.mock("@/lib/sequences/engine", () => ({
  enrollInSequence: vi.fn(async () => null),
  onPersonReplied: vi.fn(),
  runSequenceStep: vi.fn(),
}));
vi.mock("@/lib/messaging/takeover", () => ({ startTakeover: vi.fn() }));
vi.mock("@/lib/messaging/echo", () => ({ classifyEcho: vi.fn(), ECHO_RECHECK_DELAY_MS: 20_000 }));

vi.mock("@/lib/moderation/moderate", () => ({
  moderateComment: vi.fn(async () => ({ action: "CLEAN" })),
}));

vi.mock("@/lib/ops/worker-health", () => ({
  recordWorkerAlert: vi.fn(),
}));

vi.mock("@/lib/queue/client", () => ({
  getDMQueue: () => ({
    add: mockQueueAdd,
  }),
  getRedisConnection: vi.fn(),
  POSTBACK_JOB_NAME: "process-postback",
  FOLLOWUP_JOB_NAME: "process-followup",
  MESSAGE_JOB_NAME: "process-message",
  SAVE_MEDIA_JOB_NAME: "save-media",
  CRM_DM_JOB_NAME: "crm-dm",
  REFERRAL_JOB_NAME: "process-referral",
  SEQUENCE_STEP_JOB_NAME: "sequence-step",
  PROFILE_JOB_NAME: "fetch-profile",
  safeJobKey: (v: string) => Buffer.from(v).toString("base64url"),
}));

vi.mock("@/lib/broadcasts/tap", () => ({ routeBroadcastTap: mockRouteBroadcastTap }));
vi.mock("@/lib/broadcasts/engine", () => ({
  runBroadcastBatch: mockRunBroadcastBatch,
  runBroadcastStart: mockRunBroadcastStart,
}));

vi.mock("bullmq", () => {
  function MockWorker(_name: string, processor: unknown) {
    (global as Record<string, unknown>).__dmWorkerProcessor = processor;
    return {
      on: vi.fn(),
      close: vi.fn(),
    };
  }
  class UnrecoverableError extends Error {
    name = "UnrecoverableError";
  }
  return {
    Worker: MockWorker,
    UnrecoverableError,
  };
});

import { createDMWorker } from "../lib/queue/dm-worker";

const usagePeriodStart = new Date("2026-05-01T00:00:00.000Z");

const mockAutomation = {
  id: "auto_789",
  workspaceId: "workspace_123",
  instagramAccountId: "ig_account_row_1",
  postId: "media_101",
  keywords: ["LINK", "PRICE"],
  dmMessage: "Hey {username}! Here is the link: https://example.com",
  isActive: true,
  wholeWordMatch: true,
  matchAnyPost: false,
  matchAnyWord: false,
  openingDmEnabled: false,
  openingDmMessage: null,
  openingDmButtonLabel: null,
  linkButtonLabel: null,
  publicReplyEnabled: false,
  publicReplyMessage: null,
  publicReplyMessages: [],
  instagramAccount: {
    id: "ig_account_row_1",
    instagramId: "ig_456",
    accessToken: "encrypted_token_abc", status: "ACTIVE",
  },
  workspace: {
    id: "workspace_123",
  },
  trackedLinks: [],
};

const mockJobData = {
  instagramAccountId: "ig_456",
  commentId: "comment_555",
  commentText: "I want the LINK!",
  commenterId: "commenter_999",
  commenterName: "commenter_user",
  mediaId: "media_101",
};

function getProcessor(): (job: {
  name?: string;
  data: typeof mockJobData | Record<string, unknown>;
  id: string;
  attemptsMade: number;
}) => Promise<void> {
  createDMWorker();
  return (global as Record<string, unknown>).__dmWorkerProcessor as (job: {
    name?: string;
    data: typeof mockJobData | Record<string, unknown>;
    id: string;
    attemptsMade: number;
  }) => Promise<void>;
}

function createMockJob(data: Record<string, unknown> = mockJobData) {
  return {
    data,
    id: "job_001",
    attemptsMade: 0,
  };
}

function createMockPostbackJob(
  data: Record<string, unknown> = {
    instagramAccountId: "ig_456",
    userId: "commenter_999",
    payload: "reveal:auto_789",
  }
) {
  return {
    name: "process-postback",
    data,
    id: "postback_job_001",
    attemptsMade: 0,
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  mockPrisma.automation.findMany.mockResolvedValue([mockAutomation]);
  mockPrisma.automation.findFirst.mockResolvedValue(null);
  mockPrisma.dmLog.findUnique.mockResolvedValue(null);
  mockPrisma.dmLog.create.mockResolvedValue({});
  // Two different lookups share findFirst: the cross-campaign private-reply
  // check (keyed on status SENT) and the postback's name lookup. Only the
  // latter should resolve by default, or every comment would look like a
  // duplicate of an already-answered one.
  mockPrisma.dmLog.findFirst.mockImplementation(
    async (args: { where?: { status?: string } } = {}) =>
      args.where?.status === "SENT" ? null : { commenterName: "commenter_user" }
  );
  mockPrisma.dmLog.upsert.mockResolvedValue({});
  mockPrisma.dmLog.update.mockResolvedValue({});
  mockPrisma.instagramAccount.findUnique.mockResolvedValue({
    workspaceId: "workspace_123",
  });
  mockPrisma.operationalEvent.create.mockResolvedValue({});
  mockDecryptToken.mockReturnValue("decrypted_token");
  mockMatchKeywords.mockReturnValue({ matched: true, matchedKeyword: "LINK" });
  mockReserveWorkspaceDMSend.mockResolvedValue({
    allowed: true,
    reserved: true,
    remaining: 100,
    limit: 2000,
    periodStart: usagePeriodStart,
  });
  mockReserveDMSlot.mockResolvedValue({
    allowed: true,
    currentCount: 11,
    remainingDMs: 179,
    shouldRequeue: false,
    requeueDelayMs: 0,
    shouldSkip: false,
    reserved: true,
  });
  mockReleaseWorkspaceDMReservation.mockResolvedValue({ count: 1 });
  mockSendPrivateReply.mockResolvedValue({
    recipient_id: "commenter_999",
    message_id: "msg_001",
  });
  mockSendPrivateReplyWithLinkButton.mockResolvedValue({
    recipient_id: "commenter_999",
    message_id: "msg_002",
  });
  mockSendPrivateReplyWithButton.mockResolvedValue({
    recipient_id: "commenter_999",
    message_id: "msg_003",
  });
  mockSendDirectMessageWithButton.mockResolvedValue({
    recipient_id: "commenter_999",
    message_id: "msg_004",
  });
  mockSendDirectMessage.mockResolvedValue({
    recipient_id: "commenter_999",
    message_id: "msg_005",
  });
  mockSendDirectMessageWithLinkButton.mockResolvedValue({
    recipient_id: "commenter_999",
    message_id: "msg_006",
  });
  mockGetUserFollowStatus.mockResolvedValue(true);
});

const variantRows = [
  { key: "A", weight: 50, openingDmMessage: null, dmMessage: "Versão A pra {username}" },
  { key: "B", weight: 50, openingDmMessage: "Abertura B {username}", dmMessage: "Versão B pra {username}" },
];

function sentPrivateReplyText(): string {
  return mockSendPrivateReply.mock.calls[0]?.[3] as string;
}

describe("Etapa 5 — A/B off: campaigns behave exactly as before", () => {
  it("no abTestEnabled field (old rows / old mocks): no variant lookup, same text, no variantKey", async () => {
    const processor = getProcessor();
    await processor(createMockJob());

    expect(mockPrisma.campaignVariant.findMany).not.toHaveBeenCalled();
    expect(mockSendPrivateReply).toHaveBeenCalledWith(
      "decrypted_token",
      "ig_456",
      "comment_555",
      "Hey commenter_user! Here is the link: https://example.com",
      LEDGER_OPTIONS
    );
    const sentUpdate = mockPrisma.dmLog.update.mock.calls.find(
      (c: unknown[]) => (c[0] as { data: { status?: string } }).data.status === "SENT"
    );
    expect(sentUpdate).toBeDefined();
    expect(sentUpdate![0].data).toEqual({ status: "SENT", dmSentAt: expect.any(Date), errorMessage: null });
    expect("variantKey" in sentUpdate![0].data).toBe(false);
  });

  it("abTestEnabled false with variants saved: still the campaign text, never queried", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([{ ...mockAutomation, abTestEnabled: false }]);
    mockPrisma.campaignVariant.findMany.mockResolvedValue(variantRows);
    const processor = getProcessor();
    await processor(createMockJob());
    expect(mockPrisma.campaignVariant.findMany).not.toHaveBeenCalled();
    expect(sentPrivateReplyText()).toBe("Hey commenter_user! Here is the link: https://example.com");
  });

  it("button tap (reveal) without A/B: same reveal text and the SENT upsert has no variantKey", async () => {
    mockPrisma.automation.findFirst.mockResolvedValue(mockAutomation);
    const processor = getProcessor();
    await processor(createMockPostbackJob());
    expect(mockPrisma.campaignVariant.findMany).not.toHaveBeenCalled();
    expect(mockSendDirectMessage).toHaveBeenCalledWith(
      "decrypted_token",
      "ig_456",
      "commenter_999",
      "Hey commenter_user! Here is the link: https://example.com",
      LEDGER_OPTIONS
    );
    const upsert = mockPrisma.dmLog.upsert.mock.calls.at(-1)![0];
    expect(upsert.create.status).toBe("SENT");
    expect("variantKey" in upsert.create).toBe(false);
    expect("variantKey" in upsert.update).toBe(false);
  });
});

describe("Etapa 5 — A/B on", () => {
  it("sends the person's variant text and records its key on the DmLog", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([{ ...mockAutomation, abTestEnabled: true }]);
    mockPrisma.campaignVariant.findMany.mockResolvedValue(variantRows);
    const processor = getProcessor();
    await processor(createMockJob());

    expect(mockPrisma.campaignVariant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { automationId: "auto_789", isActive: true } })
    );
    const text = sentPrivateReplyText();
    const sentUpdate = mockPrisma.dmLog.update.mock.calls.find(
      (c: unknown[]) => (c[0] as { data: { status?: string } }).data.status === "SENT"
    )![0];
    const key = sentUpdate.data.variantKey as string;
    expect(["A", "B"]).toContain(key);
    expect(text).toBe(`Versão ${key} pra commenter_user`);
  });

  it("same person, same letter: the comment and the later button tap agree", async () => {
    const automation = { ...mockAutomation, abTestEnabled: true };
    mockPrisma.automation.findMany.mockResolvedValue([automation]);
    mockPrisma.automation.findFirst.mockResolvedValue(automation);
    mockPrisma.campaignVariant.findMany.mockResolvedValue(variantRows);
    const processor = getProcessor();
    await processor(createMockJob());
    const commentKey = mockPrisma.dmLog.update.mock.calls.find(
      (c: unknown[]) => (c[0] as { data: { status?: string } }).data.status === "SENT"
    )![0].data.variantKey;

    await processor(createMockPostbackJob());
    const upsert = mockPrisma.dmLog.upsert.mock.calls.at(-1)![0];
    expect(upsert.create.variantKey).toBe(commentKey);
    expect(mockSendDirectMessage.mock.calls.at(-1)![3]).toBe(`Versão ${commentKey} pra commenter_user`);
  });

  it("the opening DM uses the variant's opening text (null keeps the campaign's)", async () => {
    const automation = {
      ...mockAutomation,
      abTestEnabled: true,
      openingDmEnabled: true,
      openingDmMessage: "Abertura original {username}",
      openingDmButtonLabel: "Quero",
    };
    mockPrisma.automation.findMany.mockResolvedValue([automation]);
    // Only B exists with weight > 0: everyone gets B.
    mockPrisma.campaignVariant.findMany.mockResolvedValue([{ ...variantRows[0], weight: 0 }, variantRows[1]]);
    const processor = getProcessor();
    await processor(createMockJob());
    expect(mockSendPrivateReplyWithButton.mock.calls[0][3]).toBe("Abertura B commenter_user");

    vi.clearAllMocks();
    mockPrisma.campaignVariant.findMany.mockResolvedValue([variantRows[0], { ...variantRows[1], weight: 0 }]);
    mockSendPrivateReplyWithButton.mockResolvedValue({ message_id: "m" });
    mockPrisma.dmLog.findFirst.mockResolvedValue(null);
    mockPrisma.dmLog.findUnique.mockResolvedValue(null);
    mockPrisma.dmLog.update.mockResolvedValue({});
    mockDecryptToken.mockReturnValue("decrypted_token");
    mockMatchKeywords.mockReturnValue({ matched: true, matchedKeyword: "LINK" });
    mockReserveWorkspaceDMSend.mockResolvedValue({ allowed: true, periodStart: usagePeriodStart, limit: 1 });
    mockReserveDMSlot.mockResolvedValue({ allowed: true });
    mockPrisma.automation.findMany.mockResolvedValue([automation]);
    await processor(createMockJob({ ...mockJobData, commentId: "comment_556" }));
    // A has no opening text of its own: the campaign's.
    expect(mockSendPrivateReplyWithButton.mock.calls[0][3]).toBe("Abertura original commenter_user");
  });

  it("a failed variant lookup never costs the DM: the campaign text goes out", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([{ ...mockAutomation, abTestEnabled: true }]);
    mockPrisma.campaignVariant.findMany.mockRejectedValue(new Error("db down"));
    const processor = getProcessor();
    await processor(createMockJob());
    expect(sentPrivateReplyText()).toBe("Hey commenter_user! Here is the link: https://example.com");
  });
});

describe("Etapa 5 — broadcast button taps", () => {
  it("bc: payloads go to the broadcast router and never to a campaign", async () => {
    const processor = getProcessor();
    await processor(
      createMockPostbackJob({ instagramAccountId: "ig_456", userId: "commenter_999", payload: "bc:rcp_1:b1", mid: "tap_1" })
    );
    expect(mockRouteBroadcastTap).toHaveBeenCalledWith(
      expect.objectContaining({ instagramId: "ig_456", igUserId: "commenter_999", payload: "bc:rcp_1:b1" })
    );
    expect(mockPrisma.automation.findFirst).not.toHaveBeenCalled();
    expect(mockSendDirectMessage).not.toHaveBeenCalled();
  });

  it("a read fallback with a bc: payload starts nothing", async () => {
    const processor = getProcessor();
    await processor(
      createMockPostbackJob({ instagramAccountId: "ig_456", userId: "commenter_999", payload: "bc:rcp_1:b1", fallback: true })
    );
    expect(mockRouteBroadcastTap).not.toHaveBeenCalled();
  });

  it("broadcast jobs are routed by name and never reach processComment", async () => {
    const processor = getProcessor();
    await processor({ name: "broadcast-batch", data: { instagramAccountId: "ig_456", broadcastId: "b_1", seq: 0 }, id: "j", attemptsMade: 0 });
    await processor({ name: "broadcast-start", data: { instagramAccountId: "ig_456", broadcastId: "b_1" }, id: "j2", attemptsMade: 0 });
    expect(mockRunBroadcastBatch).toHaveBeenCalledWith({ instagramAccountId: "ig_456", broadcastId: "b_1", seq: 0 });
    expect(mockRunBroadcastStart).toHaveBeenCalledWith({ instagramAccountId: "ig_456", broadcastId: "b_1" });
    expect(mockPrisma.automation.findMany).not.toHaveBeenCalled();
  });
});
