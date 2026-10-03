/**
 * Etapa 3 (stories e lives) no webhook: resposta de story e menção no story
 * viram MESSAGE_JOB com storyKind; comentário em live (campo live_comments)
 * vira process-comment com surface "live"; live_comments entra nos campos
 * assinados.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHmac } from "crypto";

const { mockPrisma, mockAdd, mockStore } = vi.hoisted(() => ({
  mockPrisma: {
    webhookEvent: { create: vi.fn(async () => ({ id: "we_1" })), update: vi.fn() },
    instagramAccount: { findUnique: vi.fn(async () => ({ workspaceId: "ws" })), updateMany: vi.fn() },
    dmLog: { findMany: vi.fn(async () => []) },
    operationalEvent: { create: vi.fn() },
  },
  mockAdd: vi.fn(),
  mockStore: vi.fn(async () => []),
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/queue/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/queue/client")>();
  return { ...real, getDMQueue: () => ({ add: mockAdd }) };
});
vi.mock("@/lib/messages/store", () => ({ storeParsedDirectMessages: mockStore }));
vi.mock("@/lib/contacts/record", () => ({ trackInteraction: vi.fn(), onDirectMessage: vi.fn() }));

import { POST } from "../app/api/webhook/route";
import { parseCommentEvents, parseLiveCommentEvents, parseMessageEvents } from "../lib/meta/webhook";
import { parseDirectMessages } from "../lib/messages/parse";
import { WEBHOOK_SUBSCRIBED_FIELDS, missingWebhookFields } from "../lib/meta/webhook-fields";
import { WEBHOOK_SUBSCRIBED_FIELDS as FROM_CLIENT } from "../lib/meta/client";

const SECRET = "test_app_secret_12345";

function signed(payload: unknown) {
  const body = JSON.stringify(payload);
  const sig = "sha256=" + createHmac("sha256", SECRET).update(body).digest("hex");
  return new NextRequest(new URL("/api/webhook", "http://localhost"), {
    method: "POST",
    body,
    headers: { "content-type": "application/json", "x-hub-signature-256": sig },
  });
}

const storyReply = {
  sender: { id: "ig_person" },
  recipient: { id: "ig_owner" },
  timestamp: 1_700_000_000_000,
  message: {
    mid: "mid_story_reply",
    text: "QUERO",
    reply_to: { story: { id: "story_42", url: "https://lookaside.fbsbx.com/story.jpg" } },
  },
};
const storyMention = {
  sender: { id: "ig_fan" },
  recipient: { id: "ig_owner" },
  timestamp: 1_700_000_001_000,
  message: {
    mid: "mid_mention",
    attachments: [{ type: "story_mention", payload: { url: "https://lookaside.fbsbx.com/mention.mp4" } }],
  },
};
const liveComment = {
  field: "live_comments",
  value: {
    id: "live_c1",
    text: "quero o link",
    from: { id: "ig_viewer", username: "viewer" },
    media: { id: "live_media_1", media_product_type: "LIVE" },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("FACEBOOK_APP_SECRET", SECRET);
});

describe("parsers", () => {
  it("a story reply carries storyKind reply, the story id and its text", () => {
    const [event] = parseMessageEvents({ object: "instagram", entry: [{ id: "ig_owner", time: 1, messaging: [storyReply] }] });
    expect(event).toEqual({
      instagramAccountId: "ig_owner",
      messageId: "mid_story_reply",
      messageText: "QUERO",
      senderId: "ig_person",
      storyKind: "reply",
      storyId: "story_42",
      storyUrl: "https://lookaside.fbsbx.com/story.jpg",
      timestamp: 1_700_000_000_000,
    });
  });

  it("a story mention is kept even without text (its own trigger)", () => {
    const [event] = parseMessageEvents({ object: "instagram", entry: [{ id: "ig_owner", time: 1, messaging: [storyMention] }] });
    expect(event).toMatchObject({ messageId: "mid_mention", messageText: "", storyKind: "mention", senderId: "ig_fan" });
    expect(event.storyId).toBeUndefined();
  });

  it("other text-less messages are still dropped", () => {
    const events = parseMessageEvents({
      object: "instagram",
      entry: [{ id: "ig_owner", time: 1, messaging: [{ sender: { id: "p" }, recipient: { id: "ig_owner" }, message: { mid: "m", attachments: [{ type: "image" }] } }] }],
    });
    expect(events).toEqual([]);
  });

  it("live_comments only comes out of the live parser, marked live", () => {
    const payload = { object: "instagram", entry: [{ id: "ig_owner", time: 1, changes: [liveComment] }] };
    expect(parseCommentEvents(payload)).toEqual([]);
    expect(parseLiveCommentEvents(payload)).toEqual([
      {
        instagramAccountId: "ig_owner",
        commentId: "live_c1",
        commentText: "quero o link",
        commenterId: "ig_viewer",
        commenterName: "viewer",
        mediaId: "live_media_1",
        originalMediaId: undefined,
        surface: "live",
      },
    ]);
  });

  it("a post comment is not a live comment", () => {
    const payload = {
      object: "instagram",
      entry: [{ id: "ig_owner", time: 1, changes: [{ field: "comments", value: { id: "c1", text: "oi", from: { id: "p" }, media: { id: "m1" } } }] }],
    };
    expect(parseLiveCommentEvents(payload)).toEqual([]);
    expect(parseCommentEvents(payload)[0].surface).toBeUndefined();
  });

  it("the inbox parser keeps reply vs mention and the story id", () => {
    const [reply, mention] = parseDirectMessages({
      object: "instagram",
      entry: [{ id: "ig_owner", time: 1, messaging: [storyReply, storyMention] }],
    });
    expect(reply).toMatchObject({ storyReply: true, storyKind: "reply", storyId: "story_42" });
    expect(mention).toMatchObject({ storyReply: true, storyKind: "mention", storyId: null });
  });
});

describe("subscribed webhook fields", () => {
  it("live_comments is subscribed, and the client re-exports the same list", () => {
    expect(WEBHOOK_SUBSCRIBED_FIELDS).toContain("live_comments");
    expect(FROM_CLIENT).toBe(WEBHOOK_SUBSCRIBED_FIELDS);
  });

  it("missingWebhookFields points at what an old subscription lacks", () => {
    expect(missingWebhookFields(["comments", "messages", "messaging_postbacks", "messaging_referral", "messaging_seen"])).toEqual([
      "live_comments",
    ]);
    expect(missingWebhookFields(WEBHOOK_SUBSCRIBED_FIELDS)).toEqual([]);
    expect(missingWebhookFields(null)).toEqual(WEBHOOK_SUBSCRIBED_FIELDS);
  });
});

describe("webhook route", () => {
  it("queues a live comment as process-comment with surface live and its own job id", async () => {
    const res = await POST(signed({ object: "instagram", entry: [{ id: "ig_owner", time: 1, changes: [liveComment] }] }));
    expect(res.status).toBe(200);
    const calls = mockAdd.mock.calls.filter((c) => c[0] === "process-comment");
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toMatchObject({ commentId: "live_c1", surface: "live", commenterName: "viewer", source: "WEBHOOK" });
    expect(calls[0][2]).toEqual({ jobId: "live_ig_owner_live_c1" });
  });

  it("queues story reply and story mention with storyKind (the mention without text)", async () => {
    await POST(signed({ object: "instagram", entry: [{ id: "ig_owner", time: 1, messaging: [storyReply, storyMention] }] }));
    const messages = mockAdd.mock.calls.filter((c) => c[0] === "process-message").map((c) => c[1]);
    expect(messages).toEqual([
      expect.objectContaining({ messageId: "mid_story_reply", storyKind: "reply", storyId: "story_42", timestamp: 1_700_000_000_000 }),
      expect.objectContaining({ messageId: "mid_mention", storyKind: "mention", messageText: "" }),
    ]);
    const crm = mockAdd.mock.calls.filter((c) => c[0] === "crm-dm").map((c) => c[1]);
    expect(crm[0]).toMatchObject({ storyReply: true, storyKind: "reply" });
    expect(crm[1]).toMatchObject({ storyReply: true, storyKind: "mention" });
  });
});
