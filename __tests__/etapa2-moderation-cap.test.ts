/**
 * Etapa 2 (pendência da Etapa 1): teto de comentários escondidos por hora.
 * Acima do teto só registra WOULD_HIDE com regra "teto"; esconder manual não conta.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockHideComment } = vi.hoisted(() => ({
  mockPrisma: {
    $executeRaw: vi.fn(async () => 1),
    $transaction: vi.fn(async function (this: unknown, fn: (tx: unknown) => unknown) {
      return fn(this);
    }),
    instagramAccount: { findUnique: vi.fn() },
    automation: { findMany: vi.fn(async () => []) },
    commentModeration: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
  },
  mockHideComment: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/meta/client", () => ({ hideComment: mockHideComment }));
vi.mock("@/lib/meta/oauth", () => ({ decryptToken: (t: string) => `plain:${t}` }));
vi.mock("@/lib/contacts/record", () => ({
  AUTO_TAGS: { moderated: (v: string) => `moderado:${v}` },
  trackInteraction: vi.fn(async () => ({ contact: { id: "ct_1", workspaceId: "ws_1" }, inserted: true })),
  removeTag: vi.fn(),
}));

import {
  CAP_RULE,
  DEFAULT_MODERATION_SETTINGS,
  moderateComment,
  reserveHideSlot,
  setModerationHidden,
} from "../lib/moderation/moderate";

const settings = { ...DEFAULT_MODERATION_SETTINGS, mode: "HIDE" as const, maxHidesPerHour: 30 };
const account = { id: "acc_row", workspaceId: "ws_1", instagramId: "ig_owner", accessToken: "enc", moderationSettings: settings };
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
  mockPrisma.instagramAccount.findUnique.mockResolvedValue(account);
  mockPrisma.commentModeration.findUnique.mockResolvedValue(null);
  mockPrisma.commentModeration.create.mockResolvedValue({ id: "mod_1" });
  mockPrisma.commentModeration.update.mockResolvedValue({ id: "mod_1" });
  mockHideComment.mockResolvedValue({ success: true });
});

describe("hourly hide ceiling", () => {
  it("defaults to 30 per hour", () => {
    expect(DEFAULT_MODERATION_SETTINGS.maxHidesPerHour).toBe(30);
  });

  it("hides while under the ceiling and books the slot as 'auto' before calling Meta", async () => {
    mockPrisma.commentModeration.count.mockResolvedValue(29);
    const res = await moderateComment(job);
    expect(res).toMatchObject({ action: "HIDDEN" });
    expect(mockPrisma.$executeRaw).toHaveBeenCalled(); // advisory lock
    expect(mockPrisma.commentModeration.count).toHaveBeenCalledWith({
      where: { instagramAccountId: "acc_row", hiddenBy: "auto", hiddenAt: { gt: expect.any(Date) } },
    });
    const slot = mockPrisma.commentModeration.update.mock.calls[0][0];
    expect(slot).toMatchObject({ where: { id: "mod_1" }, data: { hiddenBy: "auto" } });
    expect(mockHideComment).toHaveBeenCalledWith("plain:enc", "c_1", true);
  });

  it("at the ceiling only records WOULD_HIDE with rule 'teto' and never calls Meta", async () => {
    mockPrisma.commentModeration.count.mockResolvedValue(30);
    const res = await moderateComment(job);
    expect(res).toMatchObject({ action: "WOULD_HIDE", capped: true, moderationId: "mod_1" });
    expect(mockHideComment).not.toHaveBeenCalled();
    expect(mockPrisma.commentModeration.update).toHaveBeenCalledWith({
      where: { id: "mod_1" },
      data: expect.objectContaining({ matchedRule: CAP_RULE }),
    });
  });

  it("respects a custom ceiling", async () => {
    mockPrisma.instagramAccount.findUnique.mockResolvedValue({
      ...account,
      moderationSettings: { ...settings, maxHidesPerHour: 2 },
    });
    mockPrisma.commentModeration.count.mockResolvedValue(2);
    expect((await moderateComment(job)).action).toBe("WOULD_HIDE");
  });

  it("gives the slot back when Meta refuses the hide", async () => {
    mockPrisma.commentModeration.count.mockResolvedValue(0);
    mockHideComment.mockRejectedValue(new Error("boom"));
    const res = await moderateComment(job);
    expect(res.action).toBe("FAILED");
    expect(mockPrisma.commentModeration.update).toHaveBeenLastCalledWith({
      where: { id: "mod_1" },
      data: expect.objectContaining({ action: "FAILED", hiddenBy: null, hiddenAt: null }),
    });
  });

  it("reserveHideSlot refuses without writing when the hour is full", async () => {
    mockPrisma.commentModeration.count.mockResolvedValue(5);
    expect(await reserveHideSlot({ instagramAccountId: "acc_row", moderationId: "m", cap: 5 })).toBe(false);
    expect(mockPrisma.commentModeration.update).not.toHaveBeenCalled();
  });

  it("a manual hide is recorded with the actor, so it never counts toward the ceiling", async () => {
    mockPrisma.commentModeration.findFirst.mockResolvedValue({
      id: "mod_9",
      action: "WOULD_HIDE",
      commentId: "c_9",
      commenterIgId: "ig_person",
      commenterUsername: "p",
      commentText: "x",
      mediaId: "m",
      verdict: "spam_link",
      instagramAccount: { id: "acc_row", workspaceId: "ws_1", instagramId: "ig_owner", accessToken: "enc" },
    });
    await setModerationHidden({ moderationId: "mod_9", workspaceId: "ws_1", hidden: true, actor: "user_1" });
    expect(mockPrisma.commentModeration.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "HIDDEN", hiddenBy: "user_1" }) })
    );
    expect(mockPrisma.commentModeration.count).not.toHaveBeenCalled();
  });
});
