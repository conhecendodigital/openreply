/**
 * QA da Etapa 1: todas as rotas novas de moderação e contatos exigem login
 * (sessão ou chave de API) e só enxergam o workspace de quem chamou.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockPrisma, mockContext, mockHideComment } = vi.hoisted(() => ({
  mockPrisma: {
    instagramAccount: { findFirst: vi.fn() },
    moderationSettings: { upsert: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
    commentModeration: {
      findMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    contact: {
      findMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
    },
    contactTag: { groupBy: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn() },
    contactEvent: { findMany: vi.fn(), createMany: vi.fn() },
  },
  mockContext: vi.fn(),
  mockHideComment: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext: mockContext,
  canManageWorkspace: (role: string) => role === "OWNER" || role === "ADMIN",
}));
vi.mock("@/lib/auth", () => ({ isApiTokenRequest: vi.fn(async () => false) }));
vi.mock("@/lib/meta/client", () => ({ hideComment: mockHideComment }));
vi.mock("@/lib/meta/oauth", () => ({ decryptToken: (t: string) => `plain:${t}` }));

import * as settingsRoute from "../app/api/moderation/settings/route";
import * as logRoute from "../app/api/moderation/log/route";
import * as restoreRoute from "../app/api/moderation/log/[id]/restore/route";
import * as hideRoute from "../app/api/moderation/log/[id]/hide/route";
import * as testRoute from "../app/api/moderation/test/route";
import * as contactsRoute from "../app/api/contacts/route";
import * as tagsRoute from "../app/api/contacts/tags/route";
import * as contactRoute from "../app/api/contacts/[id]/route";
import * as contactTagsRoute from "../app/api/contacts/[id]/tags/route";

const WS = "ws_mine";
const ctx = (role = "OWNER") => ({ userId: "u1", workspaceId: WS, workspace: { id: WS }, role });
const idParams = (id = "x1") => ({ params: Promise.resolve({ id }) });

function req(path: string, init?: { method?: string; body?: unknown }) {
  return new NextRequest(new URL(path, "http://localhost"), {
    method: init?.method ?? "GET",
    ...(init?.body !== undefined
      ? { body: JSON.stringify(init.body), headers: { "content-type": "application/json" } }
      : {}),
  });
}

type Call = { name: string; run: () => Promise<Response> };

const calls: Call[] = [
  { name: "GET /api/moderation/settings", run: () => settingsRoute.GET(req("/api/moderation/settings")) },
  {
    name: "PATCH /api/moderation/settings",
    run: () => settingsRoute.PATCH(req("/api/moderation/settings", { method: "PATCH", body: { mode: "HIDE" } })),
  },
  { name: "GET /api/moderation/log", run: () => logRoute.GET(req("/api/moderation/log")) },
  {
    name: "POST /api/moderation/log/[id]/restore",
    run: () => restoreRoute.POST(req("/api/moderation/log/x1/restore", { method: "POST" }), idParams()),
  },
  {
    name: "POST /api/moderation/log/[id]/hide",
    run: () => hideRoute.POST(req("/api/moderation/log/x1/hide", { method: "POST" }), idParams()),
  },
  {
    name: "POST /api/moderation/test",
    run: () => testRoute.POST(req("/api/moderation/test", { method: "POST", body: { text: "segue de volta" } })),
  },
  { name: "GET /api/contacts", run: () => contactsRoute.GET(req("/api/contacts")) },
  { name: "GET /api/contacts/tags", run: () => tagsRoute.GET(req("/api/contacts/tags")) },
  { name: "GET /api/contacts/[id]", run: () => contactRoute.GET(req("/api/contacts/x1"), idParams()) },
  {
    name: "PATCH /api/contacts/[id]",
    run: () => contactRoute.PATCH(req("/api/contacts/x1", { method: "PATCH", body: { notes: "oi" } }), idParams()),
  },
  {
    name: "POST /api/contacts/[id]/tags",
    run: () =>
      contactTagsRoute.POST(req("/api/contacts/x1/tags", { method: "POST", body: { add: ["vip"] } }), idParams()),
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.instagramAccount.findFirst.mockResolvedValue(null);
  mockPrisma.commentModeration.findMany.mockResolvedValue([]);
  mockPrisma.commentModeration.count.mockResolvedValue(0);
  mockPrisma.commentModeration.groupBy.mockResolvedValue([]);
  mockPrisma.commentModeration.findFirst.mockResolvedValue(null);
  mockPrisma.contact.findMany.mockResolvedValue([]);
  mockPrisma.contact.count.mockResolvedValue(0);
  mockPrisma.contact.findFirst.mockResolvedValue(null);
  mockPrisma.contact.updateMany.mockResolvedValue({ count: 0 });
  mockPrisma.contactTag.groupBy.mockResolvedValue([]);
  mockPrisma.moderationSettings.findUnique.mockResolvedValue(null);
});

describe("Etapa 1 routes: login required", () => {
  for (const call of calls) {
    it(`${call.name} answers 401 without a session or API key and touches no data`, async () => {
      mockContext.mockResolvedValue(null);
      const res = await call.run();
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ success: false });
      for (const model of Object.values(mockPrisma)) {
        for (const fn of Object.values(model)) expect(fn).not.toHaveBeenCalled();
      }
      expect(mockHideComment).not.toHaveBeenCalled();
    });
  }
});

describe("Etapa 1 routes: admin-only writes", () => {
  const adminOnly = [
    "PATCH /api/moderation/settings",
    "POST /api/moderation/log/[id]/restore",
    "POST /api/moderation/log/[id]/hide",
  ];
  for (const name of adminOnly) {
    it(`${name} answers 403 for a MEMBER`, async () => {
      mockContext.mockResolvedValue(ctx("MEMBER"));
      const res = await calls.find((c) => c.name === name)!.run();
      expect(res.status).toBe(403);
      expect(mockHideComment).not.toHaveBeenCalled();
      expect(mockPrisma.moderationSettings.update).not.toHaveBeenCalled();
    });
  }
});

describe("Etapa 1 routes: workspace scope", () => {
  beforeEach(() => mockContext.mockResolvedValue(ctx()));

  it("settings only resolve an Instagram account of the caller's workspace", async () => {
    const res = await settingsRoute.GET(req("/api/moderation/settings?instagramAccountId=acc_other"));
    expect(res.status).toBe(404);
    expect(mockPrisma.instagramAccount.findFirst).toHaveBeenCalledWith({
      where: { id: "acc_other", workspaceId: WS },
    });
    expect(mockPrisma.moderationSettings.upsert).not.toHaveBeenCalled();
  });

  it("PATCH settings with an account of another workspace changes nothing", async () => {
    const res = await settingsRoute.PATCH(
      req("/api/moderation/settings", { method: "PATCH", body: { instagramAccountId: "acc_other", mode: "HIDE" } })
    );
    expect(res.status).toBe(404);
    expect(mockPrisma.moderationSettings.update).not.toHaveBeenCalled();
  });

  it("PATCH settings rejects an unknown mode", async () => {
    const res = await settingsRoute.PATCH(
      req("/api/moderation/settings", { method: "PATCH", body: { mode: "DELETE_ALL" } })
    );
    expect(res.status).toBe(400);
  });

  it("the moderation log is filtered by workspace, even when another account id is passed", async () => {
    await logRoute.GET(req("/api/moderation/log?instagramAccountId=acc_other&action=HIDDEN"));
    const where = mockPrisma.commentModeration.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ workspaceId: WS, instagramAccountId: "acc_other", action: "HIDDEN" });
    expect(mockPrisma.commentModeration.count.mock.calls[0][0].where.workspaceId).toBe(WS);
    expect(mockPrisma.commentModeration.groupBy.mock.calls[0][0].where.workspaceId).toBe(WS);
  });

  it("restore/hide of a record from another workspace is 404 and never calls Meta", async () => {
    for (const route of [restoreRoute, hideRoute]) {
      const res = await route.POST(req("/api/moderation/log/mod_x", { method: "POST" }), idParams("mod_x"));
      expect(res.status).toBe(404);
    }
    for (const [arg] of mockPrisma.commentModeration.findFirst.mock.calls) {
      expect(arg.where).toEqual({ id: "mod_x", workspaceId: WS });
    }
    expect(mockHideComment).not.toHaveBeenCalled();
  });

  it("restore of a hidden record of the caller's workspace unhides through the API", async () => {
    mockPrisma.commentModeration.findFirst.mockResolvedValue({
      id: "mod_1",
      workspaceId: WS,
      action: "HIDDEN",
      commentId: "c_1",
      commenterIgId: "ig_person",
      commenterUsername: "pessoa",
      commentText: "segue de volta",
      mediaId: "m_1",
      verdict: "spam_link",
      instagramAccount: { id: "acc_1", workspaceId: WS, instagramId: "ig_owner", accessToken: "enc", status: "ACTIVE" },
    });
    mockPrisma.commentModeration.update.mockResolvedValue({ id: "mod_1", action: "RESTORED" });
    mockPrisma.contact.upsert.mockResolvedValue({ id: "ct_1", workspaceId: WS, firstSeenAt: new Date(), lastSeenAt: new Date() });
    mockPrisma.contactEvent.createMany.mockResolvedValue({ count: 1 });
    mockPrisma.contactTag.deleteMany.mockResolvedValue({ count: 1 });
    const res = await restoreRoute.POST(req("/api/moderation/log/mod_1/restore", { method: "POST" }), idParams("mod_1"));
    expect(res.status).toBe(200);
    expect(mockHideComment).toHaveBeenCalledWith("plain:enc", "c_1", false);
  });

  it("the test route writes nothing and never calls Meta", async () => {
    const res = await testRoute.POST(
      req("/api/moderation/test", { method: "POST", body: { text: "renda extra, me chama no zap" } })
    );
    const body = await res.json();
    expect(body.data).toMatchObject({ flagged: true, verdict: "scam", mode: "OBSERVE", wouldDo: "record" });
    expect(mockPrisma.moderationSettings.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.moderationSettings.update).not.toHaveBeenCalled();
    expect(mockHideComment).not.toHaveBeenCalled();
  });

  it("the contact list, tag list and contact page are scoped by workspace", async () => {
    await contactsRoute.GET(req("/api/contacts?q=@maria&tag=clicou&instagramAccountId=acc_other"));
    const where = mockPrisma.contact.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ workspaceId: WS, instagramAccountId: "acc_other", tags: { some: { name: "clicou" } } });
    expect(where.OR[0]).toEqual({ username: { contains: "maria", mode: "insensitive" } });

    await tagsRoute.GET(req("/api/contacts/tags"));
    expect(mockPrisma.contactTag.groupBy.mock.calls[0][0].where).toEqual({ workspaceId: WS });

    const res = await contactRoute.GET(req("/api/contacts/ct_other"), idParams("ct_other"));
    expect(res.status).toBe(404);
    expect(mockPrisma.contact.findFirst.mock.calls[0][0].where).toEqual({ id: "ct_other", workspaceId: WS });
    expect(mockPrisma.contactEvent.findMany).not.toHaveBeenCalled();
  });

  it("notes and manual tags on a contact of another workspace are 404 and write nothing", async () => {
    const notes = await contactRoute.PATCH(
      req("/api/contacts/ct_other", { method: "PATCH", body: { notes: "x" } }),
      idParams("ct_other")
    );
    expect(notes.status).toBe(404);
    expect(mockPrisma.contact.updateMany.mock.calls[0][0].where).toEqual({ id: "ct_other", workspaceId: WS });

    const tags = await contactTagsRoute.POST(
      req("/api/contacts/ct_other/tags", { method: "POST", body: { add: ["vip"] } }),
      idParams("ct_other")
    );
    expect(tags.status).toBe(404);
    expect(mockPrisma.contactTag.createMany).not.toHaveBeenCalled();
  });

  it("the contact page caps the count and returns the Direct link", async () => {
    mockPrisma.contact.count.mockResolvedValue(10_001);
    const list = await (await contactsRoute.GET(req("/api/contacts"))).json();
    expect(list.data.pagination).toMatchObject({ total: 10_000, totalCapped: true });

    mockPrisma.contact.findFirst.mockResolvedValue({
      id: "ct_1",
      workspaceId: WS,
      instagramAccountId: "acc_1",
      igUserId: "123",
      username: "maria",
      tags: [],
    });
    mockPrisma.contactEvent.findMany.mockResolvedValue([]);
    const one = await (await contactRoute.GET(req("/api/contacts/ct_1"), idParams("ct_1"))).json();
    expect(one.data.links).toEqual({
      inbox: "/inbox?account=acc_1&contact=123",
      profile: "https://www.instagram.com/maria/",
    });
    expect(mockPrisma.commentModeration.findMany.mock.calls[0][0].where).toMatchObject({ workspaceId: WS });
  });
});
