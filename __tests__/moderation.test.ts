import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockHideComment, mockTrack, mockRemoveTag } = vi.hoisted(() => ({
  mockPrisma: {
    // reserveHideSlot (hourly ceiling): transaction + advisory lock.
    $executeRaw: vi.fn(async () => 1),
    $transaction: vi.fn(async function (this: unknown, fn: (tx: unknown) => unknown) {
      return fn(this);
    }),
    instagramAccount: { findUnique: vi.fn() },
    automation: { findMany: vi.fn() },
    commentModeration: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(async () => 0),
    },
  },
  mockHideComment: vi.fn(),
  mockTrack: vi.fn(),
  mockRemoveTag: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/meta/client", () => ({ hideComment: mockHideComment }));
vi.mock("@/lib/meta/oauth", () => ({ decryptToken: (t: string) => `plain:${t}` }));
vi.mock("@/lib/contacts/record", () => ({
  AUTO_TAGS: { moderated: (v: string) => `moderado:${v}` },
  trackInteraction: mockTrack,
  removeTag: mockRemoveTag,
}));

import {
  evaluateComment,
  moderateComment,
  setModerationHidden,
  DEFAULT_MODERATION_SETTINGS,
} from "../lib/moderation/moderate";

const baseSettings = {
  ...DEFAULT_MODERATION_SETTINGS,
  id: "set_1",
  workspaceId: "ws_1",
  instagramAccountId: "acc_row",
};

function account(settings: Record<string, unknown> | null = baseSettings) {
  return {
    id: "acc_row",
    workspaceId: "ws_1",
    instagramId: "ig_owner",
    accessToken: "enc",
    moderationSettings: settings,
  };
}

const job = {
  instagramAccountId: "ig_owner",
  commentId: "c_1",
  commentText: "segue de volta que eu sigo",
  commenterId: "ig_person",
  commenterName: "pessoa",
  mediaId: "m_1",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.commentModeration.findUnique.mockResolvedValue(null);
  mockPrisma.commentModeration.create.mockResolvedValue({ id: "mod_1" });
  mockPrisma.commentModeration.update.mockResolvedValue({ id: "mod_1" });
  mockPrisma.automation.findMany.mockResolvedValue([]);
  mockTrack.mockResolvedValue({ contact: { id: "ct_1", workspaceId: "ws_1" }, inserted: true });
  mockHideComment.mockResolvedValue({ success: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("moderateComment", () => {
  it("does nothing when the account is OFF", async () => {
    mockPrisma.instagramAccount.findUnique.mockResolvedValue(account({ ...baseSettings, mode: "OFF" }));
    expect(await moderateComment(job)).toEqual({ action: "OFF" });
    expect(mockPrisma.commentModeration.create).not.toHaveBeenCalled();
    expect(mockHideComment).not.toHaveBeenCalled();
  });

  it("observes by default (no settings row): records WOULD_HIDE, never calls Meta", async () => {
    mockPrisma.instagramAccount.findUnique.mockResolvedValue(account(null));
    const res = await moderateComment(job);
    expect(res).toMatchObject({ action: "WOULD_HIDE", verdict: "spam_link" });
    expect(mockPrisma.commentModeration.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "WOULD_HIDE", mode: "OBSERVE", commentId: "c_1" }),
      })
    );
    expect(mockHideComment).not.toHaveBeenCalled();
  });

  it("writes nothing for a clean comment", async () => {
    mockPrisma.instagramAccount.findUnique.mockResolvedValue(account());
    expect(await moderateComment({ ...job, commentText: "amei, quero o comando" })).toEqual({
      action: "CLEAN",
    });
    expect(mockPrisma.commentModeration.create).not.toHaveBeenCalled();
  });

  it("hides through the official API in HIDE mode and tags the contact", async () => {
    mockPrisma.instagramAccount.findUnique.mockResolvedValue(account({ ...baseSettings, mode: "HIDE" }));
    const res = await moderateComment(job);
    expect(res).toMatchObject({ action: "HIDDEN", moderationId: "mod_1" });
    expect(mockHideComment).toHaveBeenCalledWith("plain:enc", "c_1", true);
    expect(mockPrisma.commentModeration.update).toHaveBeenCalledWith({
      where: { id: "mod_1" },
      data: expect.objectContaining({ action: "HIDDEN", hiddenAt: expect.any(Date) }),
    });
    expect(mockTrack).toHaveBeenCalledWith(
      expect.objectContaining({
        igUserId: "ig_person",
        event: expect.objectContaining({ type: "COMMENT_HIDDEN", refId: "mod_1" }),
        tags: ["moderado:spam_link"],
      })
    );
  });

  it("never hides the account's own comment", async () => {
    mockPrisma.instagramAccount.findUnique.mockResolvedValue(account({ ...baseSettings, mode: "HIDE" }));
    const res = await moderateComment({ ...job, commenterId: "ig_owner" });
    expect(res).toMatchObject({ action: "SKIPPED_PROTECTED", protectedReason: "own_account" });
    expect(mockHideComment).not.toHaveBeenCalled();
  });

  it("protects a comment that matches an active campaign keyword", async () => {
    mockPrisma.instagramAccount.findUnique.mockResolvedValue(account({ ...baseSettings, mode: "HIDE" }));
    const res = await moderateComment(
      { ...job, commentText: "FOTO segue de volta" },
      { campaigns: [{ keywords: ["foto"], wholeWordMatch: true, matchAnyWord: false }] }
    );
    expect(res).toMatchObject({ action: "SKIPPED_PROTECTED", protectedReason: "campaign_keyword" });
    expect(mockHideComment).not.toHaveBeenCalled();
  });

  it("loads the post's campaigns itself when the caller did not pass them", async () => {
    mockPrisma.instagramAccount.findUnique.mockResolvedValue(account({ ...baseSettings, mode: "HIDE" }));
    mockPrisma.automation.findMany.mockResolvedValue([
      { keywords: ["FOTO"], wholeWordMatch: true, matchAnyWord: false },
    ]);
    const res = await moderateComment({ ...job, commentText: "foto! segue de volta" });
    expect(res.action).toBe("SKIPPED_PROTECTED");
  });

  it('does not treat an "any word" campaign as protection', async () => {
    mockPrisma.instagramAccount.findUnique.mockResolvedValue(account({ ...baseSettings, mode: "HIDE" }));
    const res = await moderateComment(job, {
      campaigns: [{ keywords: [], wholeWordMatch: true, matchAnyWord: true }],
    });
    expect(res.action).toBe("HIDDEN");
  });

  it("protects allowed terms", async () => {
    mockPrisma.instagramAccount.findUnique.mockResolvedValue(
      account({ ...baseSettings, mode: "HIDE", allowedTerms: ["sigo"] })
    );
    const res = await moderateComment(job);
    expect(res).toMatchObject({ action: "SKIPPED_PROTECTED", protectedReason: "allowed_term" });
  });

  it("records FAILED without throwing when Meta refuses", async () => {
    mockPrisma.instagramAccount.findUnique.mockResolvedValue(account({ ...baseSettings, mode: "HIDE" }));
    mockHideComment.mockRejectedValue(new Error("Live comments are not supported"));
    const res = await moderateComment(job);
    expect(res).toMatchObject({ action: "FAILED" });
    expect(mockPrisma.commentModeration.update).toHaveBeenCalledWith({
      where: { id: "mod_1" },
      data: expect.objectContaining({ action: "FAILED", error: expect.stringContaining("Live") }),
    });
  });

  it("is idempotent: a second pass on the same comment does nothing", async () => {
    mockPrisma.instagramAccount.findUnique.mockResolvedValue(account({ ...baseSettings, mode: "HIDE" }));
    mockPrisma.commentModeration.findUnique.mockResolvedValue({ id: "mod_1" });
    expect(await moderateComment(job)).toMatchObject({ action: "DUPLICATE" });
    expect(mockHideComment).not.toHaveBeenCalled();
  });

  it("never throws even when the database is down", async () => {
    mockPrisma.instagramAccount.findUnique.mockRejectedValue(new Error("db down"));
    await expect(moderateComment(job)).resolves.toEqual({ action: "OFF" });
  });
});

describe("Jev", () => {
  const cleanLong = "esse perfil aqui muda vidas de verdade irmão";

  it("is not called without TYPESAFE_API_KEY", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await evaluateComment(cleanLong, { ...DEFAULT_MODERATION_SETTINGS, useJev: true });
    expect(res.verdict).toBe("ok");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is not called when the rules already flagged the comment", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "key");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await evaluateComment("segue de volta pfv amigo", { ...DEFAULT_MODERATION_SETTINGS, useJev: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  function jevSays(choice: string, confidence: number) {
    return vi.fn(async () =>
      new Response(JSON.stringify({ answers: { categoria: { type: "choice", choice, confidence } } }), {
        status: 200,
      })
    );
  }

  it("flags with high confidence and stays below the bar as not confident", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "key");
    vi.stubGlobal("fetch", jevSays("golpe", 0.95));
    const high = await evaluateComment(cleanLong, { ...DEFAULT_MODERATION_SETTINGS, useJev: true });
    expect(high).toMatchObject({ verdict: "scam", matchedRule: "jev", confident: true });

    vi.stubGlobal("fetch", jevSays("golpe", 0.6));
    const low = await evaluateComment(cleanLong, { ...DEFAULT_MODERATION_SETTINGS, useJev: true });
    expect(low).toMatchObject({ verdict: "scam", confident: false });
  });

  it("low confidence in HIDE mode only records WOULD_HIDE", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "key");
    vi.stubGlobal("fetch", jevSays("spam", 0.5));
    mockPrisma.instagramAccount.findUnique.mockResolvedValue(
      account({ ...baseSettings, mode: "HIDE", useJev: true })
    );
    const res = await moderateComment({ ...job, commentText: cleanLong });
    expect(res.action).toBe("WOULD_HIDE");
    expect(mockHideComment).not.toHaveBeenCalled();
  });

  it("treats an error as ok", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "key");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("timeout"); }));
    const res = await evaluateComment(cleanLong, { ...DEFAULT_MODERATION_SETTINGS, useJev: true });
    expect(res.verdict).toBe("ok");
  });

  it("ignores a Jev category the account turned off", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "key");
    vi.stubGlobal("fetch", jevSays("politica", 0.99));
    const res = await evaluateComment(cleanLong, { ...DEFAULT_MODERATION_SETTINGS, useJev: true });
    expect(res.verdict).toBe("ok");
  });
});

describe("setModerationHidden", () => {
  const row = {
    id: "mod_1",
    workspaceId: "ws_1",
    commentId: "c_1",
    commenterIgId: "ig_person",
    commenterUsername: "pessoa",
    commentText: "segue de volta",
    mediaId: "m_1",
    verdict: "spam_link",
    instagramAccount: { id: "acc_row", workspaceId: "ws_1", instagramId: "ig_owner", accessToken: "enc" },
  };

  it("restore calls hide=false and untags the contact", async () => {
    mockPrisma.commentModeration.findFirst.mockResolvedValue({ ...row, action: "HIDDEN" });
    const res = await setModerationHidden({ moderationId: "mod_1", workspaceId: "ws_1", hidden: false, actor: "u1" });
    expect(res.ok).toBe(true);
    expect(mockHideComment).toHaveBeenCalledWith("plain:enc", "c_1", false);
    expect(mockPrisma.commentModeration.update).toHaveBeenCalledWith({
      where: { id: "mod_1" },
      data: expect.objectContaining({ action: "RESTORED", restoredBy: "u1" }),
    });
    expect(mockRemoveTag).toHaveBeenCalledWith(expect.anything(), "moderado:spam_link");
  });

  it("refuses to restore what is not hidden", async () => {
    mockPrisma.commentModeration.findFirst.mockResolvedValue({ ...row, action: "WOULD_HIDE" });
    const res = await setModerationHidden({ moderationId: "mod_1", workspaceId: "ws_1", hidden: false, actor: "u1" });
    expect(res).toMatchObject({ ok: false, status: 409 });
    expect(mockHideComment).not.toHaveBeenCalled();
  });

  it("hide now works on an observed record", async () => {
    mockPrisma.commentModeration.findFirst.mockResolvedValue({ ...row, action: "WOULD_HIDE" });
    const res = await setModerationHidden({ moderationId: "mod_1", workspaceId: "ws_1", hidden: true, actor: "mcp" });
    expect(res.ok).toBe(true);
    expect(mockHideComment).toHaveBeenCalledWith("plain:enc", "c_1", true);
  });

  it("is scoped to the workspace", async () => {
    mockPrisma.commentModeration.findFirst.mockResolvedValue(null);
    const res = await setModerationHidden({ moderationId: "mod_1", workspaceId: "other", hidden: false, actor: "u1" });
    expect(res).toMatchObject({ ok: false, status: 404 });
    expect(mockPrisma.commentModeration.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "mod_1", workspaceId: "other" } })
    );
  });
});
