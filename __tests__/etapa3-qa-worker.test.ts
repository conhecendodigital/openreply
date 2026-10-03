/**
 * QA da Etapa 3 no worker (2026-10-06), com um DmLog "de verdade" em memória
 * (a chave única automationId+commentId funciona como no banco), pra provar
 * dedupe de ponta a ponta:
 *  - resposta de story: story específico x qualquer story, sem palavra não
 *    dispara, as duas campanhas batendo mandam 1 DM só;
 *  - menção no story: 1 DM por menção mesmo com 2 campanhas, retry não repete;
 *  - comentário em live: private reply 1 vez só (retry e 2 campanhas), canal
 *    desligado não envia, assumir conversa respeitado, DM de abertura só com
 *    botão.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Log = Record<string, unknown> & { automationId: string; commentId: string; status: string };

const h = vi.hoisted(() => ({
  logs: new Map<string, Record<string, unknown>>(),
  prisma: {
    automation: { findMany: vi.fn(), findFirst: vi.fn() },
    dmLog: { findUnique: vi.fn(), findFirst: vi.fn(), upsert: vi.fn(), update: vi.fn(), create: vi.fn() },
    instagramAccount: { findUnique: vi.fn() },
    operationalEvent: { create: vi.fn() },
  },
  queueAdd: vi.fn(),
  sendDm: vi.fn(),
  sendDmButton: vi.fn(),
  sendPrivateReply: vi.fn(),
  sendPrivateReplyWithButton: vi.fn(),
  sendCommentReply: vi.fn(),
  check: vi.fn(),
  track: vi.fn(),
  moderate: vi.fn(),
  reserveSlot: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: h.prisma }));
vi.mock("@/lib/meta/client", () => ({
  sendDirectMessage: h.sendDm,
  sendDirectMessageWithButton: h.sendDmButton,
  sendDirectMessageWithLinkButton: vi.fn(),
  sendPrivateReply: h.sendPrivateReply,
  sendPrivateReplyWithButton: h.sendPrivateReplyWithButton,
  sendPrivateReplyWithLinkButton: vi.fn(),
  sendCommentReply: h.sendCommentReply,
  getUserFollowStatus: vi.fn(async () => true),
  MetaApiError: class MetaApiError extends Error {
    code = 0;
  },
  TokenExpiredError: class TokenExpiredError extends Error {},
  RateLimitError: class RateLimitError extends Error {},
}));
vi.mock("@/lib/meta/oauth", () => ({ decryptToken: (t: string) => `plain:${t}` }));
vi.mock("@/lib/meta/send", () => ({
  sendTracked: vi.fn(async (_c: unknown, send: (o: unknown) => Promise<unknown>) => send({ metadata: "le:x:y" })),
}));
vi.mock("@/lib/billing/usage", () => ({
  reserveWorkspaceDMSend: vi.fn(async () => ({ allowed: true, periodStart: new Date() })),
  releaseWorkspaceDMReservation: vi.fn(),
}));
vi.mock("@/lib/utils/rate-limiter", () => ({ reserveDMSlot: h.reserveSlot }));
vi.mock("@/lib/ops/worker-health", () => ({ recordWorkerAlert: vi.fn() }));
vi.mock("@/lib/moderation/moderate", () => ({ moderateComment: h.moderate }));
vi.mock("@/lib/messaging/guard", () => ({ checkAutomation: h.check }));
vi.mock("@/lib/channels/status", () => ({
  assertAccountActive: vi.fn(),
  isChannelOffError: () => false,
  noteMetaError: vi.fn(),
}));
vi.mock("@/lib/sequences/engine", () => ({ enrollInSequence: vi.fn(), onPersonReplied: vi.fn(), runSequenceStep: vi.fn() }));
vi.mock("@/lib/contacts/record", () => ({
  AUTO_TAGS: { cameFrom: (o: string) => `veio:${o}`, commented: () => "c", received: () => "r" },
  addTagSafe: vi.fn(),
  onDmLogSent: vi.fn(),
  onDirectMessage: vi.fn(),
  trackInteraction: h.track,
  resolveAccountByInstagramId: vi.fn(),
}));
vi.mock("@/lib/contacts/profile", () => ({ lookupContactProfile: vi.fn() }));
vi.mock("@/lib/queue/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/queue/client")>();
  return { ...real, getDMQueue: () => ({ add: h.queueAdd }), getRedisConnection: vi.fn() };
});
vi.mock("bullmq", () => {
  function MockWorker(_name: string, processor: unknown) {
    (global as Record<string, unknown>).__etapa3QaProcessor = processor;
    return { on: vi.fn(), close: vi.fn() };
  }
  class UnrecoverableError extends Error {}
  return { Worker: MockWorker, UnrecoverableError, Queue: vi.fn() };
});

import { createDMWorker } from "../lib/queue/dm-worker";

type Job = { name: string; data: Record<string, unknown>; id: string; attemptsMade: number; timestamp?: number };
function run(job: Job) {
  createDMWorker();
  return ((global as Record<string, unknown>).__etapa3QaProcessor as (j: Job) => Promise<void>)(job);
}

const base = {
  workspaceId: "ws",
  instagramAccountId: "acc_row",
  isActive: true,
  keywords: ["quero"],
  matchAnyWord: false,
  wholeWordMatch: true,
  dmMessage: "Aqui está, {username}",
  requireFollow: false,
  followUpEnabled: false,
  openingDmEnabled: false,
  openingDmMessage: null,
  openingDmButtonLabel: null,
  publicReplyEnabled: false,
  publicReplyMessages: [],
  publicReplyMessage: null,
  linkButtonLabel: null,
  dmTriggerEnabled: false,
  storyId: null,
  createdAt: new Date("2026-10-01T00:00:00Z"),
  instagramAccount: { instagramId: "ig_owner", accessToken: "enc", status: "ACTIVE" },
  workspace: { id: "ws" },
  trackedLinks: [],
};
const campaign = (over: Record<string, unknown>) => ({ ...base, ...over });

const messageJob = (data: Record<string, unknown>): Job => ({
  name: "process-message",
  id: "m1",
  attemptsMade: 0,
  data: { instagramAccountId: "ig_owner", messageId: "mid_1", messageText: "quero", senderId: "ig_person", ...data },
});
const liveJob = (data: Record<string, unknown> = {}): Job => ({
  name: "process-comment",
  id: "live_ig_owner_cmt_live",
  attemptsMade: 0,
  data: {
    instagramAccountId: "ig_owner",
    commentId: "cmt_live",
    commentText: "QUERO o link",
    commenterId: "ig_viewer",
    commenterName: "viewer",
    mediaId: "live_media_1",
    source: "WEBHOOK",
    surface: "live",
    ...data,
  },
});

/**
 * A tiny database for automations: filters by trigger, story id (OR), channel
 * status and isActive, like the real query would.
 */
function campaignsDb(rows: Record<string, unknown>[]) {
  h.prisma.automation.findMany.mockImplementation(async (args: { where: Record<string, unknown> }) => {
    const w = args.where as {
      trigger?: string | { in: string[] };
      OR?: { storyId?: unknown; postId?: unknown; matchAnyPost?: boolean }[];
      dmTriggerEnabled?: boolean;
      isActive?: boolean;
      instagramAccount?: { instagramId?: string; status?: string };
    };
    const wanted = typeof w.trigger === "string" ? [w.trigger] : (w.trigger?.in ?? []);
    return rows.filter((r) => {
      const acct = r.instagramAccount as { instagramId: string; status: string };
      if (w.instagramAccount?.status && acct.status !== w.instagramAccount.status) return false;
      if (w.instagramAccount?.instagramId && acct.instagramId !== w.instagramAccount.instagramId) return false;
      if (w.isActive !== undefined && r.isActive !== w.isActive) return false;
      if (!wanted.includes(r.trigger as string)) return false;
      if (w.dmTriggerEnabled !== undefined && Boolean(r.dmTriggerEnabled) !== w.dmTriggerEnabled) return false;
      if (w.OR && wanted[0] === "STORY_REPLY") return w.OR.some((o) => o.storyId === r.storyId);
      return true;
    });
  });
}

const key = (automationId: string, commentId: string) => `${automationId}|${commentId}`;
type UniqueWhere = { automationId_commentId: { automationId: string; commentId: string } };

/** DmLog in memory, unique on (automationId, commentId). */
function installDmLog() {
  h.logs.clear();
  h.prisma.dmLog.findUnique.mockImplementation(async ({ where }: { where: UniqueWhere }) => {
    const k = where.automationId_commentId;
    return h.logs.get(key(k.automationId, k.commentId)) ?? null;
  });
  h.prisma.dmLog.create.mockImplementation(async ({ data }: { data: Log }) => {
    const row = { id: `log_${data.automationId}_${data.commentId}`, ...data };
    h.logs.set(key(data.automationId, data.commentId), row);
    return row;
  });
  h.prisma.dmLog.update.mockImplementation(async ({ where, data }: { where: UniqueWhere; data: Record<string, unknown> }) => {
    const k = key(where.automationId_commentId.automationId, where.automationId_commentId.commentId);
    const row = { ...(h.logs.get(k) ?? {}), ...data };
    h.logs.set(k, row);
    return row;
  });
  h.prisma.dmLog.upsert.mockImplementation(
    async ({ where, create, update }: { where: UniqueWhere; create: Log; update: Record<string, unknown> }) => {
      const k = key(where.automationId_commentId.automationId, where.automationId_commentId.commentId);
      const prev = h.logs.get(k);
      const row = prev ? { ...prev, ...update } : { id: `log_${create.automationId}_${create.commentId}`, ...create };
      h.logs.set(k, row);
      return row;
    }
  );
  h.prisma.dmLog.findFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
    for (const row of h.logs.values()) {
      if (where.automationId !== undefined) {
        const a = where.automationId as string | { not: string };
        if (typeof a === "string" ? row.automationId !== a : row.automationId === a.not) continue;
      }
      if (where.commenterId !== undefined && row.commenterId !== where.commenterId) continue;
      if (where.status !== undefined && row.status !== where.status) continue;
      if (where.commentId !== undefined) {
        const c = where.commentId as string | { startsWith: string };
        if (typeof c === "string" ? row.commentId !== c : !String(row.commentId).startsWith(c.startsWith)) continue;
      }
      if (where.commenterName !== undefined && !row.commenterName) continue;
      return { ...row, automation: { name: String(row.automationId) } };
    }
    return null;
  });
}

const sentFor = (commentId: string) =>
  [...h.logs.values()].filter((r) => r.commentId === commentId && r.status === "SENT").map((r) => r.automationId);

beforeEach(() => {
  vi.clearAllMocks();
  installDmLog();
  h.check.mockResolvedValue({ ok: true, contact: { id: "ct", username: "pessoa_real" } });
  h.track.mockResolvedValue({ contact: { id: "ct", workspaceId: "ws" }, inserted: true });
  h.sendDm.mockResolvedValue({ message_id: "out" });
  h.sendDmButton.mockResolvedValue({ message_id: "out" });
  h.sendPrivateReply.mockResolvedValue({ message_id: "out" });
  h.sendPrivateReplyWithButton.mockResolvedValue({ message_id: "out" });
  h.reserveSlot.mockResolvedValue({ allowed: true });
  h.moderate.mockResolvedValue({ action: "CLEAN" });
});

describe("QA story reply", () => {
  it("a reply to the chosen story fires that story's campaign", async () => {
    campaignsDb([campaign({ id: "st42", trigger: "STORY_REPLY", storyId: "story_42" })]);
    await run(messageJob({ storyKind: "reply", storyId: "story_42" }));
    expect(h.sendDm).toHaveBeenCalledTimes(1);
    expect(sentFor("dm:mid_1")).toEqual(["st42"]);
  });

  it("a reply to ANOTHER story does not fire a campaign bound to one story", async () => {
    campaignsDb([campaign({ id: "st42", trigger: "STORY_REPLY", storyId: "story_42" })]);
    await run(messageJob({ storyKind: "reply", storyId: "story_99" }));
    expect(h.sendDm).not.toHaveBeenCalled();
    expect(h.logs.size).toBe(0);
  });

  it("an 'any story' campaign answers a reply to any story, even without the story id", async () => {
    campaignsDb([campaign({ id: "any", trigger: "STORY_REPLY", storyId: null })]);
    await run(messageJob({ storyKind: "reply", storyId: "story_99" }));
    await run(messageJob({ messageId: "mid_2", storyKind: "reply" }));
    expect(sentFor("dm:mid_1")).toEqual(["any"]);
    expect(sentFor("dm:mid_2")).toEqual(["any"]);
    // Without a story id only the "any story" campaigns are looked for.
    const lastWhere = h.prisma.automation.findMany.mock.calls.at(-1)?.[0].where;
    expect(lastWhere.OR).toEqual([{ storyId: null }]);
  });

  it("a reply without the word fires nothing (neither the story nor a DM campaign)", async () => {
    campaignsDb([
      campaign({ id: "any", trigger: "STORY_REPLY", storyId: null }),
      campaign({ id: "dm_kw", trigger: "DM", dmTriggerEnabled: true }),
    ]);
    await run(messageJob({ storyKind: "reply", storyId: "story_42", messageText: "que story lindo" }));
    expect(h.sendDm).not.toHaveBeenCalled();
    expect(h.logs.size).toBe(0);
  });

  it("whole-word matching: 'querosene' is not 'quero'", async () => {
    campaignsDb([campaign({ id: "any", trigger: "STORY_REPLY", storyId: null })]);
    await run(messageJob({ storyKind: "reply", storyId: "story_42", messageText: "querosene" }));
    expect(h.sendDm).not.toHaveBeenCalled();
  });

  it("a campaign for this story and an 'any story' one with the same word send ONE DM, from the specific one", async () => {
    campaignsDb([
      campaign({ id: "any", trigger: "STORY_REPLY", storyId: null }),
      campaign({ id: "st42", trigger: "STORY_REPLY", storyId: "story_42" }),
    ]);
    await run(messageJob({ storyKind: "reply", storyId: "story_42" }));
    expect(h.sendDm).toHaveBeenCalledTimes(1);
    expect(sentFor("dm:mid_1")).toEqual(["st42"]);

    // BullMQ retry of the same message: nothing new goes out.
    await run(messageJob({ storyKind: "reply", storyId: "story_42" }));
    expect(h.sendDm).toHaveBeenCalledTimes(1);
  });

  it("a story campaign that is off, or on a channel that is off, never answers", async () => {
    campaignsDb([
      campaign({ id: "off", trigger: "STORY_REPLY", isActive: false }),
      campaign({
        id: "chan_off",
        trigger: "STORY_REPLY",
        instagramAccount: { instagramId: "ig_owner", accessToken: "enc", status: "DISCONNECTED" },
      }),
    ]);
    await run(messageJob({ storyKind: "reply", storyId: "story_42" }));
    expect(h.sendDm).not.toHaveBeenCalled();
  });

  it("takeover: the story campaign is logged as skipped and a DM campaign does not answer instead", async () => {
    campaignsDb([
      campaign({ id: "any", trigger: "STORY_REPLY" }),
      campaign({ id: "dm_kw", trigger: "DM", dmTriggerEnabled: true }),
    ]);
    h.check.mockResolvedValue({ ok: false, reason: "takeover", contact: null });
    await run(messageJob({ storyKind: "reply", storyId: "story_42" }));
    expect(h.sendDm).not.toHaveBeenCalled();
    expect(h.logs.get(key("any", "dm:mid_1"))?.status).toBe("SKIPPED_TAKEOVER");
  });

  it("follow gate: someone who does not follow gets the follow prompt, not the link", async () => {
    const { getUserFollowStatus } = await import("@/lib/meta/client");
    vi.mocked(getUserFollowStatus).mockResolvedValueOnce(false);
    campaignsDb([campaign({ id: "any", trigger: "STORY_REPLY", requireFollow: true })]);
    await run(messageJob({ storyKind: "reply", storyId: "story_42" }));
    expect(h.sendDm).not.toHaveBeenCalled();
    expect(h.sendDmButton).toHaveBeenCalledTimes(1);
    expect(h.sendDmButton.mock.calls[0][5]).toBe("followcheck:any");
  });
});

describe("QA story mention", () => {
  const mention = (mid = "mid_m") => messageJob({ messageId: mid, messageText: "", storyKind: "mention" });

  it("fires without any word, once per mention even with two mention campaigns on", async () => {
    campaignsDb([
      campaign({ id: "m1", trigger: "STORY_MENTION", keywords: [], matchAnyWord: true }),
      campaign({ id: "m2", trigger: "STORY_MENTION", keywords: [], matchAnyWord: true }),
    ]);
    await run(mention());
    expect(h.sendDm).toHaveBeenCalledTimes(1);
    expect(sentFor("mention:mid_m")).toEqual(["m1"]);
  });

  it("a retry of the same mention and a second mention by the same person send nothing new", async () => {
    campaignsDb([campaign({ id: "m1", trigger: "STORY_MENTION", keywords: [], matchAnyWord: true })]);
    await run(mention("mid_a"));
    await run(mention("mid_a"));
    await run(mention("mid_b"));
    expect(h.sendDm).toHaveBeenCalledTimes(1);
  });

  it("a mention never fires a DM-keyword or story-reply campaign", async () => {
    campaignsDb([
      campaign({ id: "dm_any", trigger: "DM", dmTriggerEnabled: true, matchAnyWord: true, keywords: [] }),
      campaign({ id: "st_any", trigger: "STORY_REPLY", matchAnyWord: true, keywords: [] }),
    ]);
    await run(mention());
    expect(h.sendDm).not.toHaveBeenCalled();
  });

  it("channel off: nothing is sent", async () => {
    campaignsDb([
      campaign({
        id: "m1",
        trigger: "STORY_MENTION",
        keywords: [],
        matchAnyWord: true,
        instagramAccount: { instagramId: "ig_owner", accessToken: "enc", status: "NEEDS_RECONNECT" },
      }),
    ]);
    await run(mention());
    expect(h.sendDm).not.toHaveBeenCalled();
  });

  it("takeover: no DM for the mention", async () => {
    campaignsDb([campaign({ id: "m1", trigger: "STORY_MENTION", keywords: [], matchAnyWord: true })]);
    h.check.mockResolvedValue({ ok: false, reason: "takeover", contact: null });
    await run(mention());
    expect(h.sendDm).not.toHaveBeenCalled();
    expect(h.logs.get(key("m1", "mention:mid_m"))?.status).toBe("SKIPPED_TAKEOVER");
  });
});

describe("QA live comment", () => {
  const live = (over: Record<string, unknown> = {}) => campaign({ id: "live", trigger: "LIVE_COMMENT", ...over });

  it("a live comment with the word gets ONE private reply, and a retry does not send another", async () => {
    campaignsDb([live()]);
    await run(liveJob());
    await run(liveJob());
    expect(h.sendPrivateReply).toHaveBeenCalledTimes(1);
    expect(h.sendPrivateReply.mock.calls[0][2]).toBe("cmt_live");
    expect(sentFor("cmt_live")).toEqual(["live"]);
    expect(h.sendCommentReply).not.toHaveBeenCalled();
  });

  it("two live campaigns matching the same comment: Instagram's one private reply goes out once", async () => {
    campaignsDb([live({ id: "live_a" }), live({ id: "live_b" })]);
    await run(liveJob());
    expect(h.sendPrivateReply).toHaveBeenCalledTimes(1);
    expect(h.logs.get(key("live_b", "cmt_live"))?.status).toBe("SKIPPED_DEDUP");
  });

  it("without the word nothing goes out", async () => {
    campaignsDb([live()]);
    await run(liveJob({ commentText: "boa noite pessoal" }));
    expect(h.sendPrivateReply).not.toHaveBeenCalled();
    expect(h.logs.size).toBe(0);
  });

  it("a channel that is off sends nothing", async () => {
    campaignsDb([live({ instagramAccount: { instagramId: "ig_owner", accessToken: "enc", status: "DISCONNECTED" } })]);
    await run(liveJob());
    expect(h.sendPrivateReply).not.toHaveBeenCalled();
  });

  it("takeover is respected on a live too", async () => {
    campaignsDb([live()]);
    h.check.mockResolvedValue({ ok: false, reason: "takeover", contact: null });
    await run(liveJob());
    expect(h.sendPrivateReply).not.toHaveBeenCalled();
    expect(h.logs.get(key("live", "cmt_live"))?.status).toBe("SKIPPED_TAKEOVER");
  });

  it("a public reply set on a live campaign is never posted", async () => {
    campaignsDb([live({ publicReplyEnabled: true, publicReplyMessages: ["valeu!"] })]);
    await run(liveJob());
    await run(liveJob());
    expect(h.sendCommentReply).not.toHaveBeenCalled();
    expect(h.sendPrivateReply).toHaveBeenCalledTimes(1);
  });

  it("with an opening DM the private reply is the button message", async () => {
    campaignsDb([live({ openingDmEnabled: true, openingDmMessage: "Oi! Toca no botão", openingDmButtonLabel: "Quero" })]);
    await run(liveJob());
    expect(h.sendPrivateReply).not.toHaveBeenCalled();
    expect(h.sendPrivateReplyWithButton).toHaveBeenCalledTimes(1);
    expect(h.sendPrivateReplyWithButton.mock.calls[0][2]).toBe("cmt_live");
  });

  it("a post campaign ('any post') never answers a live comment, and a live campaign never answers a post", async () => {
    campaignsDb([campaign({ id: "any_post", trigger: "COMMENT", matchAnyPost: true }), live()]);
    await run(liveJob());
    expect(sentFor("cmt_live")).toEqual(["live"]);
    h.logs.clear();
    h.sendPrivateReply.mockClear();
    await run(liveJob({ surface: undefined, commentId: "cmt_post", mediaId: "post_1" }));
    expect(sentFor("cmt_post")).toEqual(["any_post"]);
  });
});
