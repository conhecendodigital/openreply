import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    instagramAccount: { findUnique: vi.fn(), findMany: vi.fn() },
    contact: { upsert: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    contactEvent: { createMany: vi.fn(), findFirst: vi.fn() },
    contactTag: { createMany: vi.fn(), deleteMany: vi.fn() },
    trackedLink: { findUnique: vi.fn() },
    linkClick: { create: vi.fn(), update: vi.fn(), count: vi.fn(), findMany: vi.fn() },
    automation: { findUnique: vi.fn() },
    dmLog: { findFirst: vi.fn(), findMany: vi.fn() },
    webhookEvent: { findMany: vi.fn() },
    directMessage: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));

import {
  addTag,
  clearAccountCache,
  onDirectMessage,
  onDmLogSent,
  recordEvent,
  removeTag,
  trackInteraction,
} from "../lib/contacts/record";
import { recipientQuery, recipientToken, verifyRecipientToken } from "../lib/tracking/recipient";
import { buildTrackedUrl, renderMessageWithTracking } from "../lib/tracking/message";
import { backfillContacts } from "../lib/contacts/backfill";
import { GET as redirect } from "../app/r/[slug]/route";

const contact = { id: "ct_1", workspaceId: "ws_1" };
const account = { id: "acc_row", workspaceId: "ws_1", instagramId: "ig_owner" };
const at = new Date("2026-10-03T12:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  clearAccountCache();
  mockPrisma.contact.upsert.mockResolvedValue({ ...contact, firstSeenAt: at, lastSeenAt: at });
  mockPrisma.contactEvent.createMany.mockResolvedValue({ count: 1 });
  mockPrisma.contactTag.createMany.mockResolvedValue({ count: 1 });
  mockPrisma.contactTag.deleteMany.mockResolvedValue({ count: 1 });
});

describe("recordEvent", () => {
  it("bumps the counter only when the event is new", async () => {
    expect(await recordEvent(contact, { type: "COMMENT", refId: "c1", occurredAt: at })).toBe(true);
    expect(mockPrisma.contact.update).toHaveBeenCalledWith({
      where: { id: "ct_1" },
      data: { commentsCount: { increment: 1 } },
    });
    expect(mockPrisma.contactEvent.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true })
    );

    vi.clearAllMocks();
    mockPrisma.contactEvent.createMany.mockResolvedValue({ count: 0 });
    expect(await recordEvent(contact, { type: "COMMENT", refId: "c1", occurredAt: at })).toBe(false);
    expect(mockPrisma.contact.update).not.toHaveBeenCalled();
  });

  it("moves lastInboundAt forward on an inbound DM", async () => {
    await recordEvent(contact, { type: "DM_IN", refId: "mid1", occurredAt: at });
    expect(mockPrisma.contact.updateMany).toHaveBeenCalledWith({
      where: { id: "ct_1", OR: [{ lastInboundAt: null }, { lastInboundAt: { lt: at } }] },
      data: { lastInboundAt: at },
    });
    expect(mockPrisma.contact.update).toHaveBeenCalledWith({
      where: { id: "ct_1" },
      data: { dmsInCount: { increment: 1 } },
    });
  });

  it("cuts long text", async () => {
    await recordEvent(contact, { type: "COMMENT", refId: "c2", occurredAt: at, text: "x".repeat(900) });
    const row = mockPrisma.contactEvent.createMany.mock.calls[0][0].data[0];
    expect(row.text).toHaveLength(500);
  });
});

describe("tags", () => {
  it("adds once and logs TAG_ADDED", async () => {
    expect(await addTag(contact, "  comentou:FOTO ", "auto", at)).toBe(true);
    expect(mockPrisma.contactTag.createMany).toHaveBeenCalledWith({
      data: [{ contactId: "ct_1", workspaceId: "ws_1", name: "comentou:FOTO", source: "auto" }],
      skipDuplicates: true,
    });
    expect(mockPrisma.contactEvent.createMany.mock.calls[0][0].data[0]).toMatchObject({
      type: "TAG_ADDED",
      text: "comentou:FOTO",
    });

    vi.clearAllMocks();
    mockPrisma.contactTag.createMany.mockResolvedValue({ count: 0 });
    expect(await addTag(contact, "comentou:FOTO", "auto", at)).toBe(false);
    expect(mockPrisma.contactEvent.createMany).not.toHaveBeenCalled();
  });

  it("removes and logs TAG_REMOVED", async () => {
    expect(await removeTag(contact, "vip", at)).toBe(true);
    expect(mockPrisma.contactEvent.createMany.mock.calls[0][0].data[0]).toMatchObject({
      type: "TAG_REMOVED",
    });
  });
});

describe("trackInteraction", () => {
  it("resolves the account by instagramId and upserts the contact", async () => {
    mockPrisma.instagramAccount.findUnique.mockResolvedValue(account);
    const res = await trackInteraction({
      account: { instagramId: "ig_owner" },
      igUserId: "ig_person",
      username: "pessoa",
      event: { type: "COMMENT", refId: "c1", occurredAt: at, text: "FOTO" },
      tags: ["comentou:FOTO"],
    });
    expect(res).toEqual({ contact, inserted: true });
    expect(mockPrisma.contact.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { instagramAccountId_igUserId: { instagramAccountId: "acc_row", igUserId: "ig_person" } },
        update: { username: "pessoa" },
      })
    );
    expect(mockPrisma.contactTag.createMany).toHaveBeenCalled();
  });

  it("skips our own account", async () => {
    const res = await trackInteraction({
      account,
      igUserId: "ig_owner",
      event: { type: "COMMENT", refId: "c1", occurredAt: at },
    });
    expect(res).toBeNull();
    expect(mockPrisma.contact.upsert).not.toHaveBeenCalled();
  });

  it("never throws", async () => {
    mockPrisma.contact.upsert.mockRejectedValue(new Error("db down"));
    await expect(
      trackInteraction({ account, igUserId: "x", event: { type: "COMMENT", refId: "c", occurredAt: at } })
    ).resolves.toBeNull();
  });

  it("moves firstSeenAt back for older (backfilled) events", async () => {
    const older = new Date("2026-01-01T00:00:00Z");
    await trackInteraction({ account, igUserId: "p", event: { type: "COMMENT", refId: "c", occurredAt: older } });
    expect(mockPrisma.contact.update).toHaveBeenCalledWith({
      where: { id: "ct_1" },
      data: { firstSeenAt: older },
    });
  });
});

describe("automatic tags", () => {
  it("campaign sent → CAMPAIGN_SENT + recebeu:<campanha>", async () => {
    await onDmLogSent(
      { id: "log_1", commenterId: "ig_person", commenterName: "pessoa", dmSentAt: at },
      {
        id: "auto_1",
        name: "Comandos Pro",
        instagramAccountId: "acc_row",
        workspaceId: "ws_1",
        instagramAccount: { instagramId: "ig_owner" },
      }
    );
    const event = mockPrisma.contactEvent.createMany.mock.calls[0][0].data[0];
    expect(event).toMatchObject({ type: "CAMPAIGN_SENT", refId: "log_1", automationId: "auto_1" });
    expect(mockPrisma.contactTag.createMany.mock.calls[0][0].data[0].name).toBe("recebeu:Comandos Pro");
  });

  it('inbound DM after a campaign → "respondeu DM", otherwise "mandou DM"', async () => {
    mockPrisma.contactEvent.findFirst.mockResolvedValueOnce({ id: "ev" });
    await onDirectMessage({ account, igUserId: "ig_person", mid: "m1", fromMe: false, text: "oi", sentAt: at });
    expect(mockPrisma.contactTag.createMany.mock.calls[0][0].data[0].name).toBe("respondeu DM");

    vi.clearAllMocks();
    mockPrisma.contact.upsert.mockResolvedValue({ ...contact, firstSeenAt: at, lastSeenAt: at });
    mockPrisma.contactEvent.createMany.mockResolvedValue({ count: 1 });
    mockPrisma.contactTag.createMany.mockResolvedValue({ count: 1 });
    mockPrisma.contactEvent.findFirst.mockResolvedValueOnce(null);
    await onDirectMessage({ account, igUserId: "ig_person", mid: "m2", fromMe: false, text: "oi", sentAt: at });
    expect(mockPrisma.contactTag.createMany.mock.calls[0][0].data[0].name).toBe("mandou DM");
  });

  it("our own DM is DM_OUT and gets no tag", async () => {
    await onDirectMessage({ account, igUserId: "ig_person", mid: "m3", fromMe: true, text: "link", sentAt: at });
    expect(mockPrisma.contactEvent.createMany.mock.calls[0][0].data[0].type).toBe("DM_OUT");
    expect(mockPrisma.contactTag.createMany).not.toHaveBeenCalled();
  });
});

describe("recipient-signed links", () => {
  it("round-trips and rejects tampering", () => {
    const token = recipientToken("abc123", "17841400000000001");
    expect(verifyRecipientToken("abc123", token)).toBe("17841400000000001");
    expect(verifyRecipientToken("other", token)).toBeNull();
    expect(verifyRecipientToken("abc123", token.replace("0001.", "0002."))).toBeNull();
    expect(verifyRecipientToken("abc123", "garbage")).toBeNull();
    expect(verifyRecipientToken("abc123", null)).toBeNull();
  });

  it("adds ?c= to button and inline URLs only when asked", () => {
    expect(buildTrackedUrl("abc", "https://x.com")).toBe("https://x.com/r/abc");
    expect(buildTrackedUrl("abc", "https://x.com", recipientQuery("abc", "42"))).toMatch(
      /^https:\/\/x\.com\/r\/abc\?c=42\./
    );
    expect(recipientQuery("abc", null)).toBe("");
    const text = renderMessageWithTracking({
      message: "pega aqui {link}",
      trackedLinks: [{ slug: "abc", destinationUrl: "https://dest.com" }],
      baseUrl: "https://x.com",
      linkQuery: (slug) => recipientQuery(slug, "42"),
    });
    expect(text).toMatch(/^pega aqui https:\/\/x\.com\/r\/abc\?c=42\./);
  });
});

describe("/r/[slug] click attribution", () => {
  const link = {
    id: "link_1",
    workspaceId: "ws_1",
    automationId: "auto_1",
    destinationUrl: "https://dest.com",
    automation: { instagramAccountId: "acc_row" },
  };

  it("credits the click to the signed recipient", async () => {
    mockPrisma.trackedLink.findUnique.mockResolvedValue(link);
    mockPrisma.linkClick.create.mockResolvedValue({ id: "click_1", createdAt: at });
    mockPrisma.instagramAccount.findUnique.mockResolvedValue(account);
    mockPrisma.automation.findUnique.mockResolvedValue({ name: "Comandos Pro" });
    mockPrisma.dmLog.findFirst.mockResolvedValue({ id: "log_1" });

    const url = `https://app.test/r/abc123?${recipientQuery("abc123", "ig_person")}`;
    const res = await redirect(new Request(url) as Parameters<typeof redirect>[0], {
      params: Promise.resolve({ slug: "abc123" }),
    });

    expect(res.headers.get("location")).toBe("https://dest.com/");
    expect(mockPrisma.linkClick.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ contactIgUserId: "ig_person" }),
    });
    expect(mockPrisma.linkClick.update).toHaveBeenCalledWith({
      where: { id: "click_1" },
      data: { dmLogId: "log_1" },
    });
    const event = mockPrisma.contactEvent.createMany.mock.calls[0][0].data[0];
    expect(event).toMatchObject({ type: "CLICK", refId: "click_1" });
    const tags = mockPrisma.contactTag.createMany.mock.calls.map((c) => c[0].data[0].name);
    expect(tags).toEqual(["clicou", "clicou:Comandos Pro"]);
  });

  it("stays anonymous with a forged or missing recipient, and still redirects", async () => {
    mockPrisma.trackedLink.findUnique.mockResolvedValue(link);
    mockPrisma.linkClick.create.mockResolvedValue({ id: "click_2", createdAt: at });
    const res = await redirect(
      new Request("https://app.test/r/abc123?c=ig_person.forged") as Parameters<typeof redirect>[0],
      { params: Promise.resolve({ slug: "abc123" }) }
    );
    expect(res.status).toBe(302);
    expect(mockPrisma.linkClick.create.mock.calls[0][0].data.contactIgUserId).toBeUndefined();
    expect(mockPrisma.contact.upsert).not.toHaveBeenCalled();
  });

  it("redirects even when the CRM write fails", async () => {
    mockPrisma.trackedLink.findUnique.mockResolvedValue(link);
    mockPrisma.linkClick.create.mockResolvedValue({ id: "click_3", createdAt: at });
    mockPrisma.instagramAccount.findUnique.mockRejectedValue(new Error("db down"));
    mockPrisma.automation.findUnique.mockResolvedValue(null);
    mockPrisma.dmLog.findFirst.mockResolvedValue(null);
    const res = await redirect(
      new Request(`https://app.test/r/abc123?${recipientQuery("abc123", "p")}`) as Parameters<typeof redirect>[0],
      { params: Promise.resolve({ slug: "abc123" }) }
    );
    expect(res.status).toBe(302);
  });
});

describe("backfillContacts", () => {
  it("dry run counts every source and writes nothing", async () => {
    mockPrisma.instagramAccount.findMany.mockResolvedValue([account]);
    mockPrisma.webhookEvent.findMany
      .mockResolvedValueOnce([
        {
          id: "w1",
          createdAt: at,
          payload: {
            object: "instagram",
            entry: [
              {
                id: "ig_owner",
                changes: [
                  {
                    field: "comments",
                    value: { id: "c1", text: "FOTO", from: { id: "p1", username: "ana" }, media: { id: "m1" } },
                  },
                  {
                    field: "comments",
                    value: { id: "c2", text: "eu", from: { id: "ig_owner" }, media: { id: "m1" } },
                  },
                ],
              },
            ],
          },
        },
      ])
      .mockResolvedValueOnce([]);
    mockPrisma.dmLog.findMany
      .mockResolvedValueOnce([
        {
          id: "l1",
          instagramAccountId: "acc_row",
          commenterId: "p1",
          commenterName: "ana",
          commentId: "c1",
          commentText: "FOTO",
          matchedKeyword: "FOTO",
          status: "SENT",
          dmSentAt: at,
          createdAt: at,
          automation: { id: "a1", name: "Foto", keywords: ["FOTO"] },
        },
        {
          id: "l2",
          instagramAccountId: "acc_row",
          commenterId: "p2",
          commenterName: null,
          commentId: "reveal:p2",
          commentText: "(button tap)",
          matchedKeyword: null,
          status: "SENT",
          dmSentAt: at,
          createdAt: at,
          automation: { id: "a1", name: "Foto", keywords: ["FOTO"] },
        },
      ])
      .mockResolvedValueOnce([]);
    mockPrisma.directMessage.findMany
      .mockResolvedValueOnce([
        { id: "d1", accountId: "ig_owner", contactId: "p1", mid: "mid1", fromMe: false, text: "oi", sentAt: at, storyReply: false },
      ])
      .mockResolvedValueOnce([]);
    mockPrisma.linkClick.count.mockResolvedValue(7);
    mockPrisma.linkClick.findMany.mockResolvedValueOnce([]);

    const stats = await backfillContacts({ dryRun: true });
    expect(stats).toMatchObject({
      dryRun: true,
      webhookComments: 1, // our own comment is skipped by the parser
      dmLogComments: 1, // "reveal:" rows are not comments
      campaignsSent: 2,
      directMessages: 1,
      clicks: 0,
      clicksWithoutPerson: 7,
      newEvents: 0,
    });
    expect(mockPrisma.contact.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.contactEvent.createMany).not.toHaveBeenCalled();
  });

  it("real run records events and tags", async () => {
    mockPrisma.instagramAccount.findMany.mockResolvedValue([account]);
    mockPrisma.webhookEvent.findMany.mockResolvedValueOnce([]);
    mockPrisma.dmLog.findMany
      .mockResolvedValueOnce([
        {
          id: "l1",
          instagramAccountId: "acc_row",
          commenterId: "p1",
          commenterName: "ana",
          commentId: "c1",
          commentText: "FOTO",
          matchedKeyword: "FOTO",
          status: "SENT",
          dmSentAt: at,
          createdAt: at,
          automation: { id: "a1", name: "Foto", keywords: ["FOTO"] },
        },
      ])
      .mockResolvedValueOnce([]);
    mockPrisma.directMessage.findMany.mockResolvedValueOnce([]);
    mockPrisma.linkClick.count.mockResolvedValue(0);
    mockPrisma.linkClick.findMany.mockResolvedValueOnce([]);

    const stats = await backfillContacts({});
    expect(stats.newEvents).toBe(2);
    const types = mockPrisma.contactEvent.createMany.mock.calls.map((c) => c[0].data[0].type);
    expect(types).toContain("COMMENT");
    expect(types).toContain("CAMPAIGN_SENT");
    const tags = mockPrisma.contactTag.createMany.mock.calls.map((c) => c[0].data[0].name);
    expect(tags).toEqual(["comentou:FOTO", "recebeu:Foto"]);
  });
});
