/**
 * Usuários desconhecidos: quando buscar o perfil, a busca em si (fontes locais
 * antes da Meta, orçamento próprio, negado não repete, token rejeitado marca o
 * canal), os @ que já vêm na Conversations API e o backfill.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  prisma: {
    contact: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), upsert: vi.fn() },
    contactEvent: { createMany: vi.fn(), findFirst: vi.fn() },
    contactTag: { createMany: vi.fn() },
    dmLog: { findFirst: vi.fn() },
    commentModeration: { findFirst: vi.fn() },
    instagramAccount: { findMany: vi.fn(), findUnique: vi.fn() },
  },
  getUserProfile: vi.fn(),
  reserveProfileSlot: vi.fn(),
  noteMetaError: vi.fn(),
  queueAdd: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: h.prisma }));
vi.mock("@/lib/meta/client", () => ({ getUserProfile: h.getUserProfile }));
vi.mock("@/lib/meta/oauth", () => ({ decryptToken: (t: string) => `plain:${t}` }));
vi.mock("@/lib/utils/rate-limiter", () => ({ reserveProfileSlot: h.reserveProfileSlot }));
vi.mock("@/lib/channels/status", () => ({
  noteMetaError: h.noteMetaError,
  isTokenRejected: (e: unknown) => e instanceof Error && e.name === "TokenExpiredError",
}));
vi.mock("@/lib/queue/client", () => ({
  getDMQueue: () => ({ add: h.queueAdd }),
  PROFILE_JOB_NAME: "fetch-profile",
}));

import {
  PROFILE_MAX_ATTEMPTS,
  PROFILE_RETRY_DENIED_MS,
  needsProfileLookup,
  profileJobId,
  queueProfileLookup,
  resetProfileQueueCooldown,
} from "../lib/contacts/profile-queue";
import { isProfileDenied, lookupContactProfile, saveKnownUsernames } from "../lib/contacts/profile";
import { backfillUsernames } from "../lib/contacts/profile-backfill";
import { clearAccountCache, trackInteraction } from "../lib/contacts/record";

const now = new Date("2026-10-06T12:00:00Z");
const DAY = 24 * 3_600_000;

function metaError(name: string, code: number) {
  const e = new Error(`${name} (code ${code})`) as Error & { code: number };
  e.name = name;
  e.code = code;
  return e;
}

const row = (over: Record<string, unknown> = {}) => ({
  id: "ct_1",
  igUserId: "ig_person",
  username: null,
  name: null,
  profileAttempts: 0,
  instagramAccountId: "acc_row",
  instagramAccount: { id: "acc_row", instagramId: "ig_owner", status: "ACTIVE", accessToken: "enc" },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("REDIS_URL", "redis://test");
  clearAccountCache();
  resetProfileQueueCooldown();
  h.prisma.dmLog.findFirst.mockResolvedValue(null);
  h.prisma.commentModeration.findFirst.mockResolvedValue(null);
  h.prisma.contact.updateMany.mockResolvedValue({ count: 1 });
  h.reserveProfileSlot.mockResolvedValue({ allowed: true, count: 1, retryInMs: 0 });
  h.queueAdd.mockResolvedValue({});
});

describe("needsProfileLookup", () => {
  const dmIn = (at: Date) => ({ type: "DM_IN" as const, occurredAt: at });

  it("looks up a contact never tried that has no @", () => {
    expect(needsProfileLookup({ username: null, profileStatus: null }, dmIn(now), now)).toBe(true);
    expect(needsProfileLookup({ username: "ana", profileStatus: null }, dmIn(now), now)).toBe(false);
    expect(needsProfileLookup({ username: null, profileStatus: "ok" }, dmIn(now), now)).toBe(false);
  });

  it("a field missing from a select is not 'never tried'", () => {
    expect(needsProfileLookup({}, dmIn(now), now)).toBe(false);
  });

  it("denied: only a newer DM after 7 days earns another try, up to the max", () => {
    const fetchedAt = new Date(now.getTime() - 8 * DAY);
    const denied = { username: null, profileStatus: "denied", profileFetchedAt: fetchedAt, profileAttempts: 1 };
    expect(needsProfileLookup(denied, dmIn(now), now)).toBe(true);
    // Not a DM (a comment, a click): no.
    expect(needsProfileLookup(denied, { type: "COMMENT", occurredAt: now }, now)).toBe(false);
    // The DM is older than the last try: no.
    expect(needsProfileLookup(denied, dmIn(new Date(fetchedAt.getTime() - 1)), now)).toBe(false);
    // Too soon.
    const recent = { ...denied, profileFetchedAt: new Date(now.getTime() - PROFILE_RETRY_DENIED_MS + 60_000) };
    expect(needsProfileLookup(recent, dmIn(now), now)).toBe(false);
    // Out of attempts.
    expect(needsProfileLookup({ ...denied, profileAttempts: PROFILE_MAX_ATTEMPTS }, dmIn(now), now)).toBe(false);
  });

  it("an error retries sooner (1 day)", () => {
    const failed = { username: null, profileStatus: "error", profileFetchedAt: new Date(now.getTime() - 2 * DAY), profileAttempts: 1 };
    expect(needsProfileLookup(failed, dmIn(now), now)).toBe(true);
  });
});

describe("queueProfileLookup", () => {
  it("queues fetch-profile with a job id per attempt", async () => {
    expect(await queueProfileLookup({ instagramId: "ig_owner", contactId: "ct_1", attempts: 2 })).toBe(true);
    expect(h.queueAdd).toHaveBeenCalledWith(
      "fetch-profile",
      { instagramAccountId: "ig_owner", contactId: "ct_1" },
      { jobId: profileJobId("ct_1", 2), attempts: 1 }
    );
    expect(profileJobId("ct_1", 2)).toBe("profile_ct_1_2");
  });

  it("never throws when the queue fails, and does nothing without Redis", async () => {
    h.queueAdd.mockRejectedValue(new Error("redis down"));
    expect(await queueProfileLookup({ instagramId: "ig_owner", contactId: "ct_1" })).toBe(false);
    vi.stubEnv("REDIS_URL", "");
    h.queueAdd.mockClear();
    expect(await queueProfileLookup({ instagramId: "ig_owner", contactId: "ct_1" })).toBe(false);
    expect(h.queueAdd).not.toHaveBeenCalled();
  });
});

describe("trackInteraction queues the lookup", () => {
  const account = { id: "acc_row", workspaceId: "ws", instagramId: "ig_owner" };
  const at = new Date("2026-10-06T10:00:00Z");
  const upserted = (over: Record<string, unknown>) => ({
    id: "ct_1",
    workspaceId: "ws",
    firstSeenAt: at,
    lastSeenAt: at,
    username: null,
    profileStatus: null,
    profileFetchedAt: null,
    profileAttempts: 0,
    ...over,
  });

  beforeEach(() => {
    h.prisma.contactEvent.createMany.mockResolvedValue({ count: 1 });
  });

  it("a DM from someone with no @ queues the lookup (the webhook never calls Meta)", async () => {
    h.prisma.contact.upsert.mockResolvedValue(upserted({}));
    await trackInteraction({ account, igUserId: "ig_person", event: { type: "DM_IN", refId: "mid_1", occurredAt: at } });
    expect(h.queueAdd).toHaveBeenCalledWith("fetch-profile", { instagramAccountId: "ig_owner", contactId: "ct_1" }, expect.anything());
    expect(h.getUserProfile).not.toHaveBeenCalled();
  });

  it("not when the contact has an @, was already tried, or the caller opts out", async () => {
    h.prisma.contact.upsert.mockResolvedValue(upserted({ username: "ana" }));
    await trackInteraction({ account, igUserId: "ig_person", event: { type: "DM_IN", refId: "mid_1", occurredAt: at } });
    h.prisma.contact.upsert.mockResolvedValue(upserted({ profileStatus: "denied", profileFetchedAt: at }));
    await trackInteraction({ account, igUserId: "ig_person", event: { type: "DM_IN", refId: "mid_2", occurredAt: at } });
    h.prisma.contact.upsert.mockResolvedValue(upserted({}));
    await trackInteraction({ account, igUserId: "ig_person", skipProfile: true, event: { type: "DM_IN", refId: "mid_3", occurredAt: at } });
    expect(h.queueAdd).not.toHaveBeenCalled();
  });

  it("passes the display name to the contact", async () => {
    h.prisma.contact.upsert.mockResolvedValue(upserted({ username: "ana" }));
    await trackInteraction({ account, igUserId: "ig_person", username: "ana", name: "Ana", event: { type: "COMMENT", refId: "c1", occurredAt: at } });
    expect(h.prisma.contact.upsert.mock.calls[0][0].create).toMatchObject({ username: "ana", name: "Ana" });
  });
});

describe("lookupContactProfile", () => {
  it("saves @, name and photo from the User Profile API", async () => {
    h.prisma.contact.findUnique.mockResolvedValue(row());
    h.getUserProfile.mockResolvedValue({ username: "maria.silva", name: "Maria", profilePic: "https://cdn/x.jpg" });
    const res = await lookupContactProfile("ct_1", { now });
    expect(res).toEqual({ outcome: "ok", username: "maria.silva" });
    expect(h.reserveProfileSlot).toHaveBeenCalledWith("ig_owner");
    expect(h.getUserProfile).toHaveBeenCalledWith("plain:enc", "ig_person");
    expect(h.prisma.contact.update).toHaveBeenCalledWith({
      where: { id: "ct_1" },
      data: {
        username: "maria.silva",
        name: "Maria",
        profilePicUrl: "https://cdn/x.jpg",
        profileStatus: "ok",
        profileFetchedAt: now,
        profileAttempts: 1,
      },
    });
  });

  it("uses a username we already saw (campaign log) before calling Meta", async () => {
    h.prisma.contact.findUnique.mockResolvedValue(row());
    h.prisma.dmLog.findFirst.mockResolvedValue({ commenterName: "@joao" });
    const res = await lookupContactProfile("ct_1", { now });
    expect(res).toEqual({ outcome: "local", username: "joao" });
    expect(h.getUserProfile).not.toHaveBeenCalled();
    expect(h.reserveProfileSlot).not.toHaveBeenCalled();
    expect(h.prisma.contact.updateMany).toHaveBeenCalledWith({
      where: { id: "ct_1", username: null },
      data: { username: "joao", profileStatus: "ok", profileFetchedAt: now },
    });
  });

  it("then the moderation rows", async () => {
    h.prisma.contact.findUnique.mockResolvedValue(row());
    h.prisma.commentModeration.findFirst.mockResolvedValue({ commenterUsername: "bia" });
    expect((await lookupContactProfile("ct_1", { now })).outcome).toBe("local");
    expect(h.prisma.commentModeration.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ instagramAccountId: "acc_row", commenterIgId: "ig_person" }) })
    );
  });

  it("Meta denied (no consent): marked denied, attempts + 1, channel untouched", async () => {
    h.prisma.contact.findUnique.mockResolvedValue(row({ profileAttempts: 1 }));
    h.getUserProfile.mockRejectedValue(metaError("PermissionError", 100));
    expect((await lookupContactProfile("ct_1", { now })).outcome).toBe("denied");
    expect(h.prisma.contact.update).toHaveBeenCalledWith({
      where: { id: "ct_1" },
      data: { profileStatus: "denied", profileFetchedAt: now, profileAttempts: 2 },
    });
    expect(h.noteMetaError).not.toHaveBeenCalled();
  });

  it("code 230 (consent required) is a denial too", () => {
    expect(isProfileDenied(metaError("MetaApiError", 230))).toBe(true);
    expect(isProfileDenied(metaError("MetaApiError", 1))).toBe(false);
  });

  it("Meta rate limit: nothing marked, try again in 30 min", async () => {
    h.prisma.contact.findUnique.mockResolvedValue(row());
    h.getUserProfile.mockRejectedValue(metaError("RateLimitError", 368));
    expect(await lookupContactProfile("ct_1", { now })).toEqual({ outcome: "rate_limited", retryInMs: 30 * 60_000 });
    expect(h.prisma.contact.update).not.toHaveBeenCalled();
  });

  it("token rejected: the channel is flagged, the contact is not marked", async () => {
    h.prisma.contact.findUnique.mockResolvedValue(row());
    const err = metaError("TokenExpiredError", 190);
    h.getUserProfile.mockRejectedValue(err);
    expect((await lookupContactProfile("ct_1", { now })).outcome).toBe("token_rejected");
    expect(h.noteMetaError).toHaveBeenCalledWith({ id: "acc_row" }, err);
    expect(h.prisma.contact.update).not.toHaveBeenCalled();
  });

  it("out of the hourly budget: no Meta call", async () => {
    h.prisma.contact.findUnique.mockResolvedValue(row());
    h.reserveProfileSlot.mockResolvedValue({ allowed: false, count: 120, retryInMs: 900_000 });
    expect(await lookupContactProfile("ct_1", { now })).toEqual({ outcome: "no_budget", retryInMs: 900_000 });
    expect(h.getUserProfile).not.toHaveBeenCalled();
  });

  it("a channel that is off is never called; a contact with an @ is left alone", async () => {
    h.prisma.contact.findUnique.mockResolvedValue(row({ instagramAccount: { id: "acc_row", instagramId: "ig_owner", status: "DISCONNECTED", accessToken: "enc" } }));
    expect((await lookupContactProfile("ct_1")).outcome).toBe("channel_off");
    h.prisma.contact.findUnique.mockResolvedValue(row({ username: "ana" }));
    expect((await lookupContactProfile("ct_1")).outcome).toBe("has_username");
    expect(h.getUserProfile).not.toHaveBeenCalled();
    expect(h.prisma.contact.update).not.toHaveBeenCalled();
  });

  it("other errors: marked error", async () => {
    h.prisma.contact.findUnique.mockResolvedValue(row());
    h.getUserProfile.mockRejectedValue(new Error("socket hang up"));
    expect((await lookupContactProfile("ct_1", { now })).outcome).toBe("error");
    expect(h.prisma.contact.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ profileStatus: "error" }) }));
  });
});

describe("saveKnownUsernames (Conversations API participants)", () => {
  it("fills only the contacts with no @, with one lookup", async () => {
    h.prisma.contact.findMany.mockResolvedValue([{ id: "ct_2", igUserId: "p2" }]);
    const saved = await saveKnownUsernames("acc_row", [
      { igUserId: "p1", username: "ja_tem" },
      { igUserId: "p2", username: "novo" },
      { igUserId: "p3", username: null },
    ]);
    expect(saved).toBe(1);
    expect(h.prisma.contact.findMany).toHaveBeenCalledWith({
      where: { instagramAccountId: "acc_row", igUserId: { in: ["p1", "p2"] }, username: null },
      select: { id: true, igUserId: true },
    });
    expect(h.prisma.contact.updateMany).toHaveBeenCalledWith({
      where: { id: "ct_2", username: null },
      data: expect.objectContaining({ username: "novo", profileStatus: "ok" }),
    });
  });

  it("does nothing (and never throws) when there is nothing or the database fails", async () => {
    expect(await saveKnownUsernames("acc_row", [{ igUserId: "p1", username: null }])).toBe(0);
    expect(h.prisma.contact.findMany).not.toHaveBeenCalled();
    h.prisma.contact.findMany.mockRejectedValue(new Error("db down"));
    expect(await saveKnownUsernames("acc_row", [{ igUserId: "p1", username: "x" }])).toBe(0);
  });
});

describe("backfillUsernames", () => {
  beforeEach(() => {
    // Drop "once" answers a previous test left unused.
    h.prisma.contact.findMany.mockReset();
    h.prisma.contact.findMany.mockResolvedValue([]);
    h.prisma.dmLog.findFirst.mockReset();
    h.prisma.dmLog.findFirst.mockResolvedValue(null);
    h.prisma.instagramAccount.findMany.mockResolvedValue([{ id: "acc_row", username: "omatheus.ai" }]);
  });

  it("only ACTIVE accounts, only contacts with no @ never tried, small batches with a pause", async () => {
    h.prisma.contact.findMany
      .mockResolvedValueOnce([{ id: "a", igUserId: "1" }, { id: "b", igUserId: "2" }])
      .mockResolvedValueOnce([{ id: "c", igUserId: "3" }])
      .mockResolvedValueOnce([]);
    h.prisma.contact.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => row({ id: where.id }));
    h.getUserProfile.mockResolvedValue({ username: "x", name: null, profilePic: null });
    const sleep = vi.fn(async () => undefined);

    const stats = await backfillUsernames({ batchSize: 2, pauseMs: 1500, sleep });

    expect(h.prisma.instagramAccount.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: "ACTIVE" } }));
    expect(h.prisma.contact.findMany.mock.calls[0][0]).toMatchObject({
      where: { instagramAccountId: "acc_row", username: null, profileStatus: null },
      take: 2,
    });
    // Next page starts after the last id (idempotent, no offsets).
    expect(h.prisma.contact.findMany.mock.calls[1][0].where.id).toEqual({ gt: "b" });
    expect(stats).toMatchObject({ accounts: 1, looked: 3, ok: 3, apiCalls: 3 });
    expect(sleep).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledWith(1500);
  });

  it("--dry-run writes nothing and never calls Meta", async () => {
    h.prisma.contact.findMany.mockResolvedValueOnce([{ id: "a", igUserId: "1" }, { id: "b", igUserId: "2" }]);
    h.prisma.contact.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => row({ id: where.id }));
    h.prisma.dmLog.findFirst.mockResolvedValueOnce({ commenterName: "local_user" }).mockResolvedValue(null);
    const stats = await backfillUsernames({ dryRun: true, batchSize: 10, sleep: vi.fn() });
    expect(stats).toMatchObject({ looked: 2, local: 1, needs_api: 1, apiCalls: 0 });
    expect(h.getUserProfile).not.toHaveBeenCalled();
    expect(h.prisma.contact.update).not.toHaveBeenCalled();
    expect(h.prisma.contact.updateMany).not.toHaveBeenCalled();
  });

  it("--retry-denied also takes denied / failed ones; --limit caps the run", async () => {
    h.prisma.contact.findMany.mockResolvedValueOnce([{ id: "a", igUserId: "1" }]);
    h.prisma.contact.findUnique.mockResolvedValue(row({ id: "a" }));
    h.getUserProfile.mockResolvedValue({ username: "x", name: null, profilePic: null });
    const stats = await backfillUsernames({ retryDenied: true, limit: 1, sleep: vi.fn() });
    expect(h.prisma.contact.findMany.mock.calls[0][0].where).toMatchObject({
      OR: [{ profileStatus: null }, { profileStatus: { in: ["denied", "error"] } }],
    });
    expect(h.prisma.contact.findMany.mock.calls[0][0].take).toBe(1);
    expect(stats.looked).toBe(1);
  });

  it("stops when the hourly budget runs out", async () => {
    h.prisma.contact.findMany.mockResolvedValueOnce([{ id: "a", igUserId: "1" }, { id: "b", igUserId: "2" }]);
    h.prisma.contact.findUnique.mockResolvedValue(row());
    h.reserveProfileSlot.mockResolvedValue({ allowed: false, count: 120, retryInMs: 1000 });
    const stats = await backfillUsernames({ sleep: vi.fn() });
    expect(stats.looked).toBe(1);
    expect(stats.stoppedEarly).toMatch(/limite/);
    expect(h.getUserProfile).not.toHaveBeenCalled();
  });
});
