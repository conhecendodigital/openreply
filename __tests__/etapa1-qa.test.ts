/**
 * QA da Etapa 1: moderação de comentário e CRM de contatos, ponta a ponta com
 * as regras reais e o prisma/Meta mockados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockHideComment } = vi.hoisted(() => ({
  mockPrisma: {
    instagramAccount: { findUnique: vi.fn() },
    automation: { findMany: vi.fn() },
    commentModeration: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    contact: { upsert: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    contactEvent: { createMany: vi.fn(), findFirst: vi.fn() },
    contactTag: { createMany: vi.fn(), deleteMany: vi.fn() },
    directMessage: { upsert: vi.fn() },
    directMedia: { upsert: vi.fn() },
  },
  mockHideComment: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/meta/client", () => ({ hideComment: mockHideComment }));
vi.mock("@/lib/meta/oauth", () => ({ decryptToken: (t: string) => `plain:${t}` }));

import { classify, DEFAULT_CATEGORIES, MODERATION_CATEGORIES, findLink, findPhone } from "../lib/moderation/rules";
import { askJev } from "../lib/moderation/jev";
import { DEFAULT_MODERATION_SETTINGS, evaluateComment, moderateComment } from "../lib/moderation/moderate";
import {
  AUTO_TAGS,
  clearAccountCache,
  onDirectMessage,
  onDmLogSent,
  trackInteraction,
} from "../lib/contacts/record";
import { storeDirectMessages } from "../lib/messages/store";

const ALL = { categories: [...MODERATION_CATEGORIES], blockedTerms: [], allowedTerms: [] };
const DEFAULTS = { categories: [...DEFAULT_CATEGORIES], blockedTerms: [], allowedTerms: [] };

const ACC = { id: "acc_row", workspaceId: "ws_1", instagramId: "ig_owner" };
const at = new Date("2026-10-03T12:00:00Z");

function accountWith(settings: Record<string, unknown> | null) {
  return { ...ACC, accessToken: "enc", moderationSettings: settings };
}
const hide = (extra: Record<string, unknown> = {}) => ({ ...DEFAULT_MODERATION_SETTINGS, mode: "HIDE", ...extra });

const job = (text: string, extra: Record<string, unknown> = {}) => ({
  instagramAccountId: "ig_owner",
  commentId: "c_1",
  commentText: text,
  commenterId: "ig_person",
  commenterName: "pessoa",
  mediaId: "m_1",
  ...extra,
});

function jevFetch(choice: string, confidence: number) {
  return vi.fn(async () =>
    new Response(JSON.stringify({ answers: { categoria: { choice, confidence } } }), { status: 200 })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  clearAccountCache();
  mockPrisma.automation.findMany.mockResolvedValue([]);
  mockPrisma.commentModeration.findUnique.mockResolvedValue(null);
  mockPrisma.commentModeration.create.mockResolvedValue({ id: "mod_1" });
  mockPrisma.commentModeration.update.mockResolvedValue({ id: "mod_1" });
  mockPrisma.contact.upsert.mockResolvedValue({ id: "ct_1", workspaceId: "ws_1", firstSeenAt: at, lastSeenAt: at });
  mockPrisma.contactEvent.createMany.mockResolvedValue({ count: 1 });
  mockPrisma.contactEvent.findFirst.mockResolvedValue(null);
  mockPrisma.contactTag.createMany.mockResolvedValue({ count: 1 });
  mockPrisma.directMessage.upsert.mockResolvedValue({ id: "dm_1" });
  mockHideComment.mockResolvedValue({ success: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// ─── Classificação ───────────────────────────────────────────────────────────

describe("classify: each category", () => {
  it.each([
    ["spam_link", "sigo de volta, visita meu perfil"],
    ["spam_link", "compra em https://loja-falsa.xyz/oferta"],
    ["spam_link", "chama no wa.me/5511987654321"],
    ["spam_link", "zap 11 98765-4321"],
    ["scam", "pix caindo todo dia, renda extra garantida"],
    ["scam", "hacker profissional, recupero sua conta"],
    ["scam", "plataforma pagando no tigrinho"],
    ["politics", "faz o L"],
    ["politics", "fora Lula"],
    ["offense", "seu babaca"],
    ["offense", "vai tomar no cu"],
  ])("%s ← %s", (category, text) => {
    expect(classify(text, ALL).verdict).toBe(category);
  });

  it("a category that is off never flags", () => {
    for (const category of MODERATION_CATEGORIES) {
      const others = MODERATION_CATEGORIES.filter((c) => c !== category);
      const sample = { spam_link: "segue de volta", scam: "lucro garantido", politics: "fora lula", offense: "seu idiota" }[category];
      expect(classify(sample, { ...ALL, categories: others }).verdict).toBe("ok");
    }
  });

  it("victims and leads on security/money posts are not flagged", () => {
    for (const text of [
      "como fazer renda extra com IA?",
      "minha conta hackeada, como recuperar conta?",
      "cuidado com golpista no direct",
      "fiz minha apresentação no gamma.app e no heygen.com",
    ]) {
      expect(classify(text, ALL).verdict).toBe("ok");
    }
  });

  it("politics is off by default", () => {
    expect(DEFAULT_CATEGORIES).not.toContain("politics");
    expect(classify("fora lula", DEFAULTS).verdict).toBe("ok");
  });

  it("blocked terms flag even when every category is off, and win over categories", () => {
    const none = { categories: [], blockedTerms: ["Curso Pirata"], allowedTerms: [] };
    expect(classify("tem curso pirata aqui", none)).toMatchObject({
      verdict: "blocked_term",
      matchedRule: "Curso Pirata",
    });
    expect(classify("curso pirata, segue de volta", { ...ALL, blockedTerms: ["curso pirata"] }).verdict).toBe(
      "blocked_term"
    );
  });

  it("a blocked term only matches the whole word", () => {
    expect(classify("adorei o golpe de mestre", { ...DEFAULTS, blockedTerms: ["golpe"] }).verdict).toBe("blocked_term");
    expect(classify("golpeado não", { ...DEFAULTS, blockedTerms: ["golpe"] }).verdict).toBe("ok");
  });

  // Bugs found in QA (they would hide good leads in HIDE mode).
  it("does not flag a lead naming an AI tool domain", () => {
    expect(findLink("uso o chatgpt.com todo dia")).toBeNull();
    expect(findLink("testei no canva.com e no capcut.com")).toBeNull();
    expect(findLink("uso chatgpt.com e golpe-pix.com")).toBe("golpe-pix.com");
    expect(findLink("https://chatgpt.com.golpe.xyz/login")).not.toBeNull();
  });

  it('does not flag "invista em você" or "sou trader" (motivational / normal comments)', () => {
    expect(classify("invista em você, sempre", DEFAULTS).verdict).toBe("ok");
    expect(classify("sou trader e amei o conteúdo", DEFAULTS).verdict).toBe("ok");
    expect(classify("invista agora e ganhe", DEFAULTS).verdict).toBe("scam");
  });

  it("does not take a long code number for a phone", () => {
    expect(findPhone("pedido 1234567890123456")).toBeNull();
    expect(findPhone("me chama 11987654321")).not.toBeNull();
    expect(findPhone("+5511987654321")).not.toBeNull();
  });
});

// ─── moderateComment ─────────────────────────────────────────────────────────

describe("moderateComment", () => {
  it("OBSERVE (explicit) records WOULD_HIDE and never calls the hide API", async () => {
    mockPrisma.instagramAccount.findUnique.mockResolvedValue(
      accountWith({ ...DEFAULT_MODERATION_SETTINGS, mode: "OBSERVE" })
    );
    const res = await moderateComment(job("renda extra, chama no zap"));
    expect(res).toMatchObject({ action: "WOULD_HIDE", verdict: "scam" });
    expect(mockHideComment).not.toHaveBeenCalled();
    expect(mockPrisma.commentModeration.create.mock.calls[0][0].data).toMatchObject({
      action: "WOULD_HIDE",
      mode: "OBSERVE",
      verdict: "scam",
      commenterIgId: "ig_person",
      commentText: "renda extra, chama no zap",
    });
  });

  it("HIDE calls the official hide API with hide=true for each category", async () => {
    mockPrisma.instagramAccount.findUnique.mockResolvedValue(
      accountWith(hide({ categories: [...MODERATION_CATEGORIES] }))
    );
    const samples = ["segue de volta", "renda extra garantida", "fora bolsonaro", "seu imbecil"];
    for (const [i, text] of samples.entries()) {
      mockHideComment.mockClear();
      const res = await moderateComment(job(text, { commentId: `c_${i}` }));
      expect(res.action).toBe("HIDDEN");
      expect(mockHideComment).toHaveBeenCalledWith("plain:enc", `c_${i}`, true);
    }
  });

  it("HIDE hides a comment with an owner's blocked term", async () => {
    mockPrisma.instagramAccount.findUnique.mockResolvedValue(
      accountWith(hide({ blockedTerms: ["concorrente x"] }))
    );
    const res = await moderateComment(job("compra no Concorrente X"));
    expect(res).toMatchObject({ action: "HIDDEN", verdict: "blocked_term" });
    expect(mockHideComment).toHaveBeenCalledTimes(1);
  });

  it("never hides the account's own comment, even with a link, and does not ask Jev", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "key");
    const fetchMock = jevFetch("spam", 0.99);
    vi.stubGlobal("fetch", fetchMock);
    mockPrisma.instagramAccount.findUnique.mockResolvedValue(accountWith(hide({ useJev: true })));
    const res = await moderateComment(job("link na bio https://meusite.com", { commenterId: "ig_owner" }));
    expect(res).toMatchObject({ action: "SKIPPED_PROTECTED", protectedReason: "own_account" });
    expect(mockHideComment).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never hides who commented a campaign keyword, even with spam in the text", async () => {
    mockPrisma.instagramAccount.findUnique.mockResolvedValue(accountWith(hide()));
    mockPrisma.automation.findMany.mockResolvedValue([
      { keywords: ["FOTO", "QUERO"], wholeWordMatch: true, matchAnyWord: false },
    ]);
    const res = await moderateComment(job("Foto!! me chama no zap 11 98765-4321"));
    expect(res).toMatchObject({ action: "SKIPPED_PROTECTED", protectedReason: "campaign_keyword" });
    expect(mockHideComment).not.toHaveBeenCalled();
    // Only active campaigns of this account and post protect.
    expect(mockPrisma.automation.findMany.mock.calls[0][0].where).toMatchObject({
      isActive: true,
      instagramAccount: { instagramId: "ig_owner" },
    });
  });

  it("a keyword inside another word is not a campaign match (no free pass)", async () => {
    mockPrisma.instagramAccount.findUnique.mockResolvedValue(accountWith(hide()));
    const res = await moderateComment(job("fotografo aqui, segue de volta"), {
      campaigns: [{ keywords: ["foto"], wholeWordMatch: true, matchAnyWord: false }],
    });
    expect(res.action).toBe("HIDDEN");
  });

  it("does not hide again when Meta already failed once: records FAILED and returns", async () => {
    mockPrisma.instagramAccount.findUnique.mockResolvedValue(accountWith(hide()));
    mockHideComment.mockRejectedValue(new Error("(#10) not allowed"));
    await expect(moderateComment(job("segue de volta"))).resolves.toMatchObject({ action: "FAILED" });
  });
});

// ─── Jev ─────────────────────────────────────────────────────────────────────

describe("Jev failure falls back to the rules", () => {
  const cleanLong = "esse conteúdo me ajudou demais no trabalho";

  it("HTTP error from TypeSafe counts as ok", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    const res = await evaluateComment(cleanLong, { ...DEFAULT_MODERATION_SETTINGS, useJev: true });
    expect(res).toMatchObject({ verdict: "ok", matchedRule: null });
  });

  it("a malformed answer counts as ok", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    expect((await evaluateComment(cleanLong, { ...DEFAULT_MODERATION_SETTINGS, useJev: true })).verdict).toBe("ok");
  });

  it("times out instead of hanging the worker", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "key");
    const hanging = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        })
    ) as unknown as typeof fetch;
    expect(await askJev(cleanLong, { timeoutMs: 20, fetchImpl: hanging })).toBeNull();
  });

  it("in HIDE mode a Jev failure on a clean comment hides nothing and writes nothing", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "key");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    mockPrisma.instagramAccount.findUnique.mockResolvedValue(accountWith(hide({ useJev: true })));
    expect(await moderateComment(job(cleanLong))).toEqual({ action: "CLEAN" });
    expect(mockHideComment).not.toHaveBeenCalled();
    expect(mockPrisma.commentModeration.create).not.toHaveBeenCalled();
  });

  it("in HIDE mode the rules still hide spam while Jev is down (Jev is not even asked)", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "key");
    const fetchMock = vi.fn(async () => { throw new Error("network down"); });
    vi.stubGlobal("fetch", fetchMock);
    mockPrisma.instagramAccount.findUnique.mockResolvedValue(accountWith(hide({ useJev: true })));
    const res = await moderateComment(job("renda extra garantida, me chama no whatsapp agora"));
    expect(res).toMatchObject({ action: "HIDDEN", verdict: "scam" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the key as Bearer to the systemone endpoint and maps the answer", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "tk_123");
    const fetchMock = jevFetch("golpe", 0.97);
    vi.stubGlobal("fetch", fetchMock);
    mockPrisma.instagramAccount.findUnique.mockResolvedValue(accountWith(hide({ useJev: true })));
    const res = await moderateComment(job(cleanLong));
    expect(res).toMatchObject({ action: "HIDDEN", verdict: "scam" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tk_123");
    expect(mockPrisma.commentModeration.create.mock.calls[0][0].data).toMatchObject({
      matchedRule: "jev",
      jevConfidence: 0.97,
    });
  });

  it("a short comment is never sent to Jev", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "key");
    const fetchMock = jevFetch("spam", 0.99);
    vi.stubGlobal("fetch", fetchMock);
    await evaluateComment("quero FOTO", { ...DEFAULT_MODERATION_SETTINGS, useJev: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ─── CRM ─────────────────────────────────────────────────────────────────────

describe("CRM: contact upsert and automatic tags", () => {
  it("a comment creates the contact by (account, IGSID) and records COMMENT", async () => {
    mockPrisma.instagramAccount.findUnique.mockResolvedValue(ACC);
    const res = await trackInteraction({
      account: { instagramId: "ig_owner" },
      igUserId: "ig_person",
      username: "maria",
      event: { type: "COMMENT", refId: "c_1", occurredAt: at, text: "FOTO" },
      tags: [AUTO_TAGS.commented("FOTO")],
    });
    expect(res).toEqual({ contact: { id: "ct_1", workspaceId: "ws_1" }, inserted: true });
    expect(mockPrisma.contact.upsert.mock.calls[0][0].where).toEqual({
      instagramAccountId_igUserId: { instagramAccountId: "acc_row", igUserId: "ig_person" },
    });
    expect(mockPrisma.contact.upsert.mock.calls[0][0].create).toMatchObject({
      workspaceId: "ws_1",
      username: "maria",
    });
    expect(mockPrisma.contactTag.createMany.mock.calls[0][0].data[0]).toMatchObject({
      name: "comentou:FOTO",
      source: "auto",
    });
    expect(mockPrisma.contact.update).toHaveBeenCalledWith({
      where: { id: "ct_1" },
      data: { commentsCount: { increment: 1 } },
    });
  });

  it('the "any comment" tag falls back to comentou:qualquer', () => {
    expect(AUTO_TAGS.commented(null)).toBe("comentou:qualquer");
    expect(AUTO_TAGS.commented("  ")).toBe("comentou:qualquer");
  });

  it("the same comment twice (webhook retry + polling) does not double count or re-tag", async () => {
    mockPrisma.contactEvent.createMany.mockResolvedValue({ count: 0 });
    mockPrisma.contactTag.createMany.mockResolvedValue({ count: 0 });
    const res = await trackInteraction({
      account: ACC,
      igUserId: "ig_person",
      event: { type: "COMMENT", refId: "c_1", occurredAt: at },
      tags: [AUTO_TAGS.commented("FOTO")],
    });
    expect(res?.inserted).toBe(false);
    expect(mockPrisma.contact.update).not.toHaveBeenCalled();
    // Only the COMMENT insert attempt: no TAG_ADDED event for a tag already there.
    expect(mockPrisma.contactEvent.createMany).toHaveBeenCalledTimes(1);
  });

  it("a campaign send records CAMPAIGN_SENT once per DmLog with recebeu:<campanha>", async () => {
    await onDmLogSent(
      { id: "log_1", commenterId: "ig_person", commenterName: "maria", dmSentAt: at },
      { id: "auto_1", name: "FOTO", instagramAccountId: "acc_row", workspaceId: "ws_1", instagramAccount: { instagramId: "ig_owner" } }
    );
    const event = mockPrisma.contactEvent.createMany.mock.calls[0][0].data[0];
    expect(event).toMatchObject({ type: "CAMPAIGN_SENT", refId: "log_1", automationId: "auto_1" });
    expect(mockPrisma.contactTag.createMany.mock.calls[0][0].data[0].name).toBe("recebeu:FOTO");
    expect(mockPrisma.contact.update).toHaveBeenCalledWith({
      where: { id: "ct_1" },
      data: { campaignsCount: { increment: 1 } },
    });
  });

  it('an inbound DM after a campaign tags "respondeu DM"; a repeated DM tags nothing', async () => {
    mockPrisma.contactEvent.findFirst.mockResolvedValue({ id: "ev_campaign" });
    await onDirectMessage({ account: ACC, igUserId: "ig_person", mid: "mid_1", fromMe: false, text: "oi", sentAt: at });
    expect(mockPrisma.contactTag.createMany.mock.calls[0][0].data[0].name).toBe("respondeu DM");

    vi.clearAllMocks();
    mockPrisma.contact.upsert.mockResolvedValue({ id: "ct_1", workspaceId: "ws_1", firstSeenAt: at, lastSeenAt: at });
    mockPrisma.contactEvent.createMany.mockResolvedValue({ count: 0 });
    await onDirectMessage({ account: ACC, igUserId: "ig_person", mid: "mid_1", fromMe: false, text: "oi", sentAt: at });
    expect(mockPrisma.contactTag.createMany).not.toHaveBeenCalled();
    expect(mockPrisma.contact.update).not.toHaveBeenCalled();
  });

  it("storeDirectMessages feeds the CRM: inbound → DM_IN, echo → DM_OUT, deleted → nothing", async () => {
    mockPrisma.instagramAccount.findUnique.mockResolvedValue(ACC);
    const payload = (messaging: unknown[]) => ({ object: "instagram", entry: [{ id: "ig_owner", time: 1, messaging }] });

    await storeDirectMessages(
      payload([
        { sender: { id: "ig_person" }, recipient: { id: "ig_owner" }, timestamp: at.getTime(), message: { mid: "mid_in", text: "quero" } },
        { sender: { id: "ig_owner" }, recipient: { id: "ig_person" }, timestamp: at.getTime(), message: { mid: "mid_out", text: "aqui", is_echo: true } },
      ])
    );
    const types = mockPrisma.contactEvent.createMany.mock.calls
      .map((c) => c[0].data[0])
      .filter((e) => e.type === "DM_IN" || e.type === "DM_OUT")
      .map((e) => [e.type, e.refId]);
    expect(types).toEqual([
      ["DM_IN", "mid_in"],
      ["DM_OUT", "mid_out"],
    ]);
    // Both are the same person (the echo's recipient), not our account.
    for (const call of mockPrisma.contact.upsert.mock.calls) {
      expect(call[0].where.instagramAccountId_igUserId.igUserId).toBe("ig_person");
    }

    vi.clearAllMocks();
    mockPrisma.instagramAccount.findUnique.mockResolvedValue(ACC);
    mockPrisma.directMessage.upsert.mockResolvedValue({ id: "dm_1" });
    await storeDirectMessages(
      payload([
        { sender: { id: "ig_person" }, recipient: { id: "ig_owner" }, timestamp: 1, message: { mid: "mid_del", is_deleted: true } },
      ])
    );
    expect(mockPrisma.directMessage.upsert).toHaveBeenCalledTimes(1);
    expect(mockPrisma.contactEvent.createMany).not.toHaveBeenCalled();
  });

  it("a CRM failure never breaks the DM storage", async () => {
    mockPrisma.instagramAccount.findUnique.mockResolvedValue(ACC);
    mockPrisma.contact.upsert.mockRejectedValue(new Error("table missing"));
    await expect(
      storeDirectMessages({
        object: "instagram",
        entry: [{ id: "ig_owner", time: 1, messaging: [{ sender: { id: "ig_person" }, recipient: { id: "ig_owner" }, timestamp: 1, message: { mid: "m1", text: "oi" } }] }],
      })
    ).resolves.toEqual([]);
    expect(mockPrisma.directMessage.upsert).toHaveBeenCalled();
  });
});
