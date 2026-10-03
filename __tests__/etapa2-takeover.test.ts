/**
 * Etapa 2: assumir conversa. Eco sem metadata/ledger liga o takeover; eco
 * nosso (metadata, mid no ledger, template, mesmo texto) não liga; expira
 * sozinho; e a janela de 24 h com margem.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    outboundMessage: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    contact: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    contactEvent: { createMany: vi.fn() },
    sequenceEnrollment: { updateMany: vi.fn() },
  },
}));
vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));

import { classifyEcho } from "../lib/messaging/echo";
import { buildMetadata, parseMetadata, sendTracked } from "../lib/meta/send";
import { endTakeover, expireTakeovers, isTakeoverActive, startTakeover } from "../lib/messaging/takeover";
import { canAutomate } from "../lib/messaging/guard";
import { isWindowClosedError, isWindowOpen, windowRemainingMs } from "../lib/messaging/window";

const sentAt = new Date("2026-10-04T12:00:00Z");
const echo = {
  instagramAccountId: "acc_row",
  contactIgUserId: "ig_person",
  mid: "mid_echo",
  text: "oi, tudo bem?",
  metadata: null,
  sentAt,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.outboundMessage.findUnique.mockResolvedValue(null);
  mockPrisma.outboundMessage.findMany.mockResolvedValue([]);
  mockPrisma.outboundMessage.update.mockResolvedValue({});
  mockPrisma.contactEvent.createMany.mockResolvedValue({ count: 1 });
  mockPrisma.sequenceEnrollment.updateMany.mockResolvedValue({ count: 0 });
  mockPrisma.contact.updateMany.mockResolvedValue({ count: 1 });
});

describe("classifyEcho", () => {
  it("our metadata means ours, without touching the database", async () => {
    const v = await classifyEcho({ ...echo, metadata: buildMetadata("draft", "d1") }, { late: false });
    expect(v).toEqual({ kind: "ours", origin: "draft", via: "metadata" });
    expect(mockPrisma.outboundMessage.findUnique).not.toHaveBeenCalled();
  });

  it("a mid in the ledger means ours", async () => {
    mockPrisma.outboundMessage.findUnique.mockResolvedValue({ origin: "sequence" });
    expect(await classifyEcho(echo, { late: false })).toMatchObject({ kind: "ours", origin: "sequence", via: "ledger" });
  });

  it("a template echo is ours (the phone app cannot send one)", async () => {
    expect(await classifyEcho({ ...echo, hasTemplate: true }, { late: false })).toMatchObject({ kind: "ours", via: "template" });
  });

  it("first pass without proof is 'unknown' (the worker looks again 20 s later)", async () => {
    expect(await classifyEcho(echo, { late: false })).toEqual({ kind: "unknown" });
  });

  it("late pass: same text we sent to the same person in the last 2 min is ours", async () => {
    mockPrisma.outboundMessage.findMany.mockResolvedValue([{ origin: "automation", text: "Oi,  tudo bem?" }]);
    expect(await classifyEcho(echo, { late: true })).toMatchObject({ kind: "ours", via: "text" });
  });

  it("late pass without a match is the phone (takeover)", async () => {
    mockPrisma.outboundMessage.findMany.mockResolvedValue([{ origin: "automation", text: "outra coisa" }]);
    expect(await classifyEcho(echo, { late: true })).toEqual({ kind: "phone" });
    expect(await classifyEcho({ ...echo, text: null }, { late: true })).toEqual({ kind: "phone" });
  });

  it("someone else's metadata is not ours", () => {
    expect(parseMetadata("SENT_FROM_CHATBOTX")).toBeNull();
    expect(parseMetadata("le:inbox:abc")).toEqual({ origin: "inbox", rowId: "abc" });
  });
});

describe("sendTracked (ledger)", () => {
  it("writes the row before sending, sends our metadata and stores the mid", async () => {
    mockPrisma.outboundMessage.create.mockResolvedValue({ id: "row_1" });
    const send = vi.fn(async () => ({ recipient_id: "ig_person", message_id: "mid_1" }));
    await sendTracked(
      { workspaceId: "ws", instagramAccountId: "acc_row", contactIgUserId: "ig_person", origin: "draft", refId: "d1", text: "oi" },
      send
    );
    expect(mockPrisma.outboundMessage.create.mock.invocationCallOrder[0]).toBeLessThan(send.mock.invocationCallOrder[0]);
    expect(send).toHaveBeenCalledWith({ metadata: "le:draft:row_1" });
    expect(mockPrisma.outboundMessage.update).toHaveBeenCalledWith({ where: { id: "row_1" }, data: { mid: "mid_1" } });
  });

  it("a ledger failure never costs the DM (metadata still marks it ours)", async () => {
    mockPrisma.outboundMessage.create.mockRejectedValue(new Error("db down"));
    const send = vi.fn(async () => ({ recipient_id: "x", message_id: "m" }));
    await sendTracked({ workspaceId: "ws", instagramAccountId: "a", contactIgUserId: "p", origin: "automation" }, send);
    expect(send).toHaveBeenCalledWith({ metadata: "le:automation:x" });
  });
});

describe("takeover flag", () => {
  const now = new Date("2026-10-04T12:00:00Z");

  it("is active until its deadline", () => {
    expect(isTakeoverActive({ humanTakeover: true, humanTakeoverUntil: new Date(now.getTime() + 1000) }, now)).toBe(true);
    expect(isTakeoverActive({ humanTakeover: true, humanTakeoverUntil: new Date(now.getTime() - 1000) }, now)).toBe(false);
    expect(isTakeoverActive({ humanTakeover: true, humanTakeoverUntil: null }, now)).toBe(true);
    expect(isTakeoverActive({ humanTakeover: false, humanTakeoverUntil: null }, now)).toBe(false);
  });

  it("starting uses the account's hours, logs TAKEOVER_ON and stops active sequences", async () => {
    mockPrisma.contact.findUnique.mockResolvedValue({
      id: "ct_1",
      workspaceId: "ws",
      humanTakeover: false,
      humanTakeoverUntil: null,
      instagramAccount: { takeoverHours: 24 },
    });
    const res = await startTakeover({ contactId: "ct_1", by: "echo", reason: "phone_echo", now });
    expect(res?.until.toISOString()).toBe("2026-10-05T12:00:00.000Z");
    expect(mockPrisma.contact.update).toHaveBeenCalledWith({
      where: { id: "ct_1" },
      data: expect.objectContaining({ humanTakeover: true, humanTakeoverReason: "phone_echo", humanTakeoverBy: "echo" }),
    });
    expect(mockPrisma.contactEvent.createMany.mock.calls[0][0].data[0]).toMatchObject({ type: "TAKEOVER_ON" });
    expect(mockPrisma.sequenceEnrollment.updateMany).toHaveBeenCalledWith({
      where: { contactId: "ct_1", status: "ACTIVE" },
      data: { status: "STOPPED_TAKEOVER", stoppedAt: now },
    });
  });

  it("the sweep turns expired flags off with TAKEOVER_OFF", async () => {
    mockPrisma.contact.findMany.mockResolvedValue([{ id: "ct_1" }]);
    mockPrisma.contact.findUnique.mockResolvedValue({
      id: "ct_1",
      workspaceId: "ws",
      humanTakeover: true,
      humanTakeoverUntil: new Date(now.getTime() - 60_000),
    });
    expect(await expireTakeovers(now)).toBe(1);
    expect(mockPrisma.contactEvent.createMany.mock.calls[0][0].data[0]).toMatchObject({ type: "TAKEOVER_OFF", text: "expired" });
  });

  it("giving back when it was not on does nothing", async () => {
    mockPrisma.contact.findUnique.mockResolvedValue({ id: "ct_1", workspaceId: "ws", humanTakeover: false });
    expect(await endTakeover({ contactId: "ct_1", by: "u1" })).toBe(false);
    expect(mockPrisma.contact.updateMany).not.toHaveBeenCalled();
  });
});

describe("24-hour window and the automation guard", () => {
  const now = new Date("2026-10-04T12:00:00Z");
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

  it("closes 30 minutes early (safety margin)", () => {
    expect(isWindowOpen({ lastInboundAt: hoursAgo(23) }, now)).toBe(true);
    expect(isWindowOpen({ lastInboundAt: hoursAgo(23.6) }, now)).toBe(false);
    expect(isWindowOpen({ lastInboundAt: null }, now)).toBe(false);
    expect(windowRemainingMs({ lastInboundAt: hoursAgo(23) }, now)).toBe(30 * 60_000);
  });

  it("guard: takeover blocks first, then the window", () => {
    const contact = { id: "c", workspaceId: "w", lastInboundAt: hoursAgo(1), humanTakeover: false, humanTakeoverUntil: null };
    expect(canAutomate(contact, { now }).ok).toBe(true);
    expect(canAutomate({ ...contact, humanTakeover: true }, { now })).toMatchObject({ ok: false, reason: "takeover" });
    expect(canAutomate({ ...contact, lastInboundAt: hoursAgo(30) }, { now })).toMatchObject({ ok: false, reason: "window_closed" });
    // The DM being handled opens the window even if the CRM has not caught up.
    expect(canAutomate({ ...contact, lastInboundAt: null }, { now, inboundAt: now }).ok).toBe(true);
    // Private reply (first answer to a comment) does not need the window.
    expect(canAutomate(null, { now, requireWindow: false }).ok).toBe(true);
  });

  it("recognises Meta's closed-window errors", () => {
    expect(isWindowClosedError({ code: 10, subcode: 2534022, message: "This message is sent outside of allowed window." })).toBe(true);
    expect(isWindowClosedError({ code: 100, subcode: 1545041, message: "x" })).toBe(true);
    expect(isWindowClosedError({ code: 2, message: "An unexpected error has occurred" })).toBe(false);
  });
});
