/**
 * Etapa 2: sequências dentro de 24 h. Para na resposta, na janela fechada e no
 * takeover; o job é idempotente; espera a 1ª resposta quando o link saiu por
 * resposta privada a comentário.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockSend, mockQueueAdd, mockReserve, mockRelease, mockRecordEvent } = vi.hoisted(() => ({
  mockPrisma: {
    sequenceEnrollment: { findUnique: vi.fn(), updateMany: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    directMessage: { findFirst: vi.fn() },
    sequence: { findUnique: vi.fn() },
    contact: { findUnique: vi.fn() },
  },
  mockSend: vi.fn(),
  mockQueueAdd: vi.fn(),
  mockReserve: vi.fn(),
  mockRelease: vi.fn(),
  mockRecordEvent: vi.fn(async () => true),
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/queue/client", () => ({
  getDMQueue: () => ({ add: mockQueueAdd }),
  SEQUENCE_STEP_JOB_NAME: "sequence-step",
}));
vi.mock("@/lib/meta/client", () => ({
  sendDirectMessage: mockSend,
  MetaApiError: class MetaApiError extends Error {
    constructor(public code: number, public subcode: number | undefined, _t: string | undefined, message: string) {
      super(message);
    }
  },
}));
vi.mock("@/lib/meta/send", () => ({
  sendTracked: vi.fn(async (_ctx: unknown, send: (o: unknown) => Promise<unknown>) => send({ metadata: "le:sequence:r" })),
}));
vi.mock("@/lib/meta/oauth", () => ({ decryptToken: (t: string) => `plain:${t}` }));
vi.mock("@/lib/billing/usage", () => ({ reserveWorkspaceDMSend: mockReserve, releaseWorkspaceDMReservation: mockRelease }));
vi.mock("@/lib/contacts/record", () => ({
  recordEvent: mockRecordEvent,
  upsertContact: vi.fn(async () => ({ id: "ct_1", workspaceId: "ws" })),
}));

import { enrollInSequence, onPersonReplied, runSequenceStep } from "../lib/sequences/engine";
import { validateSequenceSteps } from "../lib/sequences/validate";

const now = new Date("2026-10-04T12:00:00Z");
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

function enrollment(over: Record<string, unknown> = {}, contactOver: Record<string, unknown> = {}) {
  return {
    id: "en_1",
    status: "ACTIVE",
    lastStepOrder: 0,
    waitingReply: false,
    startedAt: minutesAgo(10),
    contact: {
      id: "ct_1",
      workspaceId: "ws",
      igUserId: "ig_person",
      username: "maria",
      lastInboundAt: minutesAgo(15),
      humanTakeover: false,
      humanTakeoverUntil: null,
      ...contactOver,
    },
    sequence: {
      isActive: true,
      steps: [
        { order: 1, message: "Oi {username}, conseguiu abrir?", delayMinutes: 10 },
        { order: 2, message: "Qualquer dúvida me chama", delayMinutes: 60 },
      ],
      automation: {
        id: "auto_1",
        isActive: true,
        workspaceId: "ws",
        instagramAccountId: "acc_row",
        instagramAccount: { instagramId: "ig_owner", accessToken: "enc" },
        trackedLinks: [],
      },
    },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.sequenceEnrollment.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.directMessage.findFirst.mockResolvedValue(null);
  mockReserve.mockResolvedValue({ allowed: true, periodStart: now });
  mockSend.mockResolvedValue({ recipient_id: "ig_person", message_id: "mid_s1" });
});

describe("validateSequenceSteps", () => {
  it("accepts up to 5 steps under 23 h in total", () => {
    expect(validateSequenceSteps([{ message: "a", delayMinutes: 10 }, { message: "b", delayMinutes: 600 }])).toEqual([]);
  });
  it("refuses empty texts, bad waits, too many steps and 23 h or more in total", () => {
    expect(validateSequenceSteps([{ message: " ", delayMinutes: 10 }]).length).toBeGreaterThan(0);
    expect(validateSequenceSteps([{ message: "a", delayMinutes: 0 }]).length).toBeGreaterThan(0);
    expect(validateSequenceSteps([{ message: "a", delayMinutes: 1381 }]).length).toBeGreaterThan(0);
    expect(validateSequenceSteps(Array.from({ length: 6 }, () => ({ message: "a", delayMinutes: 1 }))).length).toBeGreaterThan(0);
    expect(validateSequenceSteps([{ message: "a", delayMinutes: 700 }, { message: "b", delayMinutes: 680 }])).toContain(
      "Total wait must stay under 23 hours (Instagram's 24-hour window)"
    );
  });
});

describe("runSequenceStep", () => {
  it("sends the step inside the window, records it and schedules the next", async () => {
    mockPrisma.sequenceEnrollment.findUnique.mockResolvedValue(enrollment());
    expect(await runSequenceStep({ enrollmentId: "en_1", order: 1 }, now)).toBe("sent");
    expect(mockSend).toHaveBeenCalledWith("plain:enc", "ig_owner", "ig_person", "Oi maria, conseguiu abrir?", {
      metadata: "le:sequence:r",
    });
    expect(mockPrisma.sequenceEnrollment.updateMany).toHaveBeenCalledWith({
      where: { id: "en_1", status: "ACTIVE", waitingReply: false, lastStepOrder: 0 },
      data: { lastStepOrder: 1 },
    });
    expect(mockRecordEvent).toHaveBeenCalledWith(
      { id: "ct_1", workspaceId: "ws" },
      expect.objectContaining({ type: "SEQUENCE_STEP", refId: "en_1:1" })
    );
    expect(mockQueueAdd).toHaveBeenCalledWith(
      "sequence-step",
      { instagramAccountId: "ig_owner", enrollmentId: "en_1", order: 2 },
      { delay: 60 * 60_000, jobId: "seq_en_1_2" }
    );
  });

  it("is idempotent: a duplicate job finds the step already claimed and sends nothing", async () => {
    mockPrisma.sequenceEnrollment.findUnique.mockResolvedValue(enrollment());
    mockPrisma.sequenceEnrollment.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await runSequenceStep({ enrollmentId: "en_1", order: 1 }, now)).toBe("noop");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("no-ops when the enrollment already moved past this step", async () => {
    mockPrisma.sequenceEnrollment.findUnique.mockResolvedValue(enrollment({ lastStepOrder: 1 }));
    expect(await runSequenceStep({ enrollmentId: "en_1", order: 1 }, now)).toBe("noop");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("stops when the window closed (never sends outside 24 h)", async () => {
    mockPrisma.sequenceEnrollment.findUnique.mockResolvedValue(enrollment({}, { lastInboundAt: minutesAgo(24 * 60) }));
    expect(await runSequenceStep({ enrollmentId: "en_1", order: 1 }, now)).toBe("stopped_window");
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockPrisma.sequenceEnrollment.updateMany).toHaveBeenCalledWith({
      where: { id: "en_1", status: "ACTIVE" },
      data: { status: "STOPPED_WINDOW", stoppedAt: now },
    });
  });

  it("stops on human takeover", async () => {
    mockPrisma.sequenceEnrollment.findUnique.mockResolvedValue(
      enrollment({}, { humanTakeover: true, humanTakeoverUntil: new Date(now.getTime() + 3_600_000) })
    );
    expect(await runSequenceStep({ enrollmentId: "en_1", order: 1 }, now)).toBe("stopped_takeover");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("stops when the person already answered (inbox copy, CRM lag)", async () => {
    mockPrisma.sequenceEnrollment.findUnique.mockResolvedValue(enrollment());
    mockPrisma.directMessage.findFirst.mockResolvedValue({ id: "dm_1" });
    expect(await runSequenceStep({ enrollmentId: "en_1", order: 1 }, now)).toBe("stopped_reply");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("stops when the campaign or the sequence was turned off", async () => {
    const e = enrollment();
    e.sequence.automation.isActive = false;
    mockPrisma.sequenceEnrollment.findUnique.mockResolvedValue(e);
    expect(await runSequenceStep({ enrollmentId: "en_1", order: 1 }, now)).toBe("stopped_off");
  });

  it("waits for the first reply when the link went as a private reply", async () => {
    mockPrisma.sequenceEnrollment.findUnique.mockResolvedValue(enrollment({ waitingReply: true }, { lastInboundAt: null }));
    expect(await runSequenceStep({ enrollmentId: "en_1", order: 1 }, now)).toBe("waiting_reply");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("a closed-window answer from Meta stops it; the reservation is given back", async () => {
    mockPrisma.sequenceEnrollment.findUnique.mockResolvedValue(enrollment());
    mockSend.mockRejectedValue(Object.assign(new Error("This message is sent outside of allowed window."), { code: 10 }));
    expect(await runSequenceStep({ enrollmentId: "en_1", order: 1 }, now)).toBe("stopped_window");
    expect(mockRelease).toHaveBeenCalled();
  });
});

describe("onPersonReplied", () => {
  it("stops running sequences and starts the one waiting for this first reply", async () => {
    mockPrisma.sequenceEnrollment.findMany.mockResolvedValue([
      { id: "en_run", waitingReply: false, lastStepOrder: 1, sequence: { steps: [] } },
      { id: "en_wait", waitingReply: true, lastStepOrder: 0, sequence: { steps: [{ order: 1, delayMinutes: 5 }] } },
    ]);
    const res = await onPersonReplied({ contactId: "ct_1", instagramId: "ig_owner", at: now });
    expect(res).toEqual({ stopped: 1, resumed: 1 });
    expect(mockPrisma.sequenceEnrollment.updateMany).toHaveBeenCalledWith({
      where: { id: "en_run", status: "ACTIVE" },
      data: { status: "STOPPED_REPLY", stoppedAt: now },
    });
    expect(mockPrisma.sequenceEnrollment.updateMany).toHaveBeenCalledWith({
      where: { id: "en_wait", status: "ACTIVE", waitingReply: true },
      data: { waitingReply: false, startedAt: now },
    });
    expect(mockQueueAdd).toHaveBeenCalledWith(
      "sequence-step",
      { instagramAccountId: "ig_owner", enrollmentId: "en_wait", order: 1 },
      expect.objectContaining({ delay: 5 * 60_000 })
    );
  });
});

describe("enrollInSequence", () => {
  const automation = { id: "auto_1", workspaceId: "ws", instagramAccountId: "acc_row", instagramAccount: { instagramId: "ig_owner" } };

  it("enrolls once and schedules step 1", async () => {
    mockPrisma.sequence.findUnique.mockResolvedValue({ id: "seq_1", isActive: true, steps: [{ order: 1, delayMinutes: 10 }] });
    mockPrisma.contact.findUnique.mockResolvedValue({ id: "ct_1", lastInboundAt: null, humanTakeover: false, humanTakeoverUntil: null });
    mockPrisma.sequenceEnrollment.create.mockResolvedValue({ id: "en_1" });
    const res = await enrollInSequence({ automation, igUserId: "ig_person", inboundAt: now, now });
    expect(res).toEqual({ enrollmentId: "en_1", waitingReply: false });
    expect(mockQueueAdd).toHaveBeenCalledWith(
      "sequence-step",
      { instagramAccountId: "ig_owner", enrollmentId: "en_1", order: 1 },
      { delay: 10 * 60_000, jobId: "seq_en_1_1" }
    );
  });

  it("never twice for the same person, never while a human took over, never when off", async () => {
    mockPrisma.sequence.findUnique.mockResolvedValue({ id: "seq_1", isActive: true, steps: [{ order: 1, delayMinutes: 10 }] });
    mockPrisma.contact.findUnique.mockResolvedValue({ id: "ct_1", lastInboundAt: now, humanTakeover: false, humanTakeoverUntil: null });
    mockPrisma.sequenceEnrollment.create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    expect(await enrollInSequence({ automation, igUserId: "ig_person", now })).toBeNull();

    mockPrisma.contact.findUnique.mockResolvedValue({ id: "ct_1", lastInboundAt: now, humanTakeover: true, humanTakeoverUntil: null });
    expect(await enrollInSequence({ automation, igUserId: "ig_person", now })).toBeNull();

    mockPrisma.sequence.findUnique.mockResolvedValue({ id: "seq_1", isActive: false, steps: [{ order: 1, delayMinutes: 10 }] });
    expect(await enrollInSequence({ automation, igUserId: "ig_person", now })).toBeNull();
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });
});
