/**
 * QA dos Canais (rotas): regra do dono de 03/10.
 *  - desconectar não apaga NEM ALTERA nenhuma linha ligada à conta (só a
 *    própria conta muda de status e um evento operacional é gravado);
 *  - reconectar a mesma conta (callback, upsert por instagramId) volta ACTIVE
 *    na MESMA linha, sem mexer em campanha nenhuma;
 *  - excluir de verdade: só sessão humana, só OWNER, só com o @ certo e só
 *    conta já desconectada; chave de API nunca;
 *  - 401 sem sessão e escopo por workspace em todas as rotas novas.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => {
  const models = new Map<string, Record<string, ReturnType<typeof vi.fn>>>();
  const model = (name: string) => {
    if (!models.has(name)) {
      models.set(
        name,
        new Proxy({} as Record<string, ReturnType<typeof vi.fn>>, {
          get(target, method: string) {
            if (!target[method]) target[method] = vi.fn(async () => null);
            return target[method];
          },
        })
      );
    }
    return models.get(name)!;
  };
  const transaction = vi.fn();
  const queryRaw = vi.fn(async () => [] as unknown[]);
  const executeRaw = vi.fn(async () => 0);
  const prisma = new Proxy({} as Record<string, unknown>, {
    get(_t, name: string) {
      if (name === "$transaction") return transaction;
      if (name === "$queryRaw") return queryRaw;
      if (name === "$executeRaw") return executeRaw;
      return model(name);
    },
  });
  transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
  return {
    prisma: prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>,
    models,
    transaction,
    queryRaw,
    mockContext: vi.fn(),
    mockCaller: vi.fn(),
    mockAuth: vi.fn(),
    mockUnsubscribe: vi.fn(),
    mockSubscribe: vi.fn(),
    mockUserInfo: vi.fn(),
    mockFields: vi.fn(),
    mockState: vi.fn(),
  };
});

vi.mock("@/lib/db/client", () => ({ prisma: h.prisma }));
vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext: h.mockContext,
  canManageWorkspace: (role: string) => role === "OWNER" || role === "ADMIN",
}));
vi.mock("@/lib/auth", () => ({ getApiCaller: h.mockCaller, auth: h.mockAuth }));
vi.mock("@/lib/env", () => ({ getBaseUrl: () => "https://app.test" }));
vi.mock("@/lib/meta/oauth", () => ({
  decryptToken: (t: string) => `plain:${t}`,
  encryptToken: (t: string) => `enc:${t}`,
  exchangeCodeForToken: vi.fn(async () => ({ accessToken: "short" })),
  verifyOAuthState: h.mockState,
}));
vi.mock("@/lib/meta/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/meta/client")>();
  return {
    ...real,
    getLongLivedToken: vi.fn(async () => ({ accessToken: "long", expiresIn: 60 * 24 * 3600 })),
    subscribeInstagramAccountToWebhooks: h.mockSubscribe,
    unsubscribeInstagramAccountFromWebhooks: h.mockUnsubscribe,
    getUserInfo: h.mockUserInfo,
    getSubscribedWebhookFields: h.mockFields,
  };
});

import * as disconnectRoute from "../app/api/instagram/disconnect/route";
import * as purgeRoute from "../app/api/instagram/purge/route";
import * as callbackRoute from "../app/api/instagram/callback/route";
import * as testRoute from "../app/api/channels/instagram/[id]/test/route";
import * as channelsRoute from "../app/api/channels/route";
import { getChannelAlerts } from "../lib/channels/overview";

const OWNER = { userId: "u_owner", workspaceId: "ws_A", role: "OWNER" };
const ADMIN = { userId: "u_admin", workspaceId: "ws_A", role: "ADMIN" };
const MEMBER = { userId: "u_member", workspaceId: "ws_A", role: "MEMBER" };
const ACCOUNT = { id: "acc_A", instagramId: "ig_owner", username: "omatheus.ai", accessToken: "enc", status: "ACTIVE" };
const DISCONNECTED = { ...ACCOUNT, accessToken: "", status: "DISCONNECTED" };

/** Every model that holds something of the channel (none may be touched by a disconnect). */
const LINKED_MODELS = [
  "automation",
  "trackedLink",
  "sequence",
  "sequenceStep",
  "sequenceEnrollment",
  "contact",
  "contactTag",
  "contactEvent",
  "tag",
  "directMessage",
  "directMedia",
  "draftReply",
  "outboundMessage",
  "conversationLink",
  "conversationLinkOpen",
  "linkClick",
  "commentModeration",
  "moderationSettings",
  "dmLog",
  "followerSnapshot",
  "processedComment",
  "webhookEvent",
];
const WRITE_METHODS = ["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"];

/** Every write made on any model, as "model.method". */
function writes() {
  const calls: string[] = [];
  for (const [name, methods] of h.models) {
    for (const method of WRITE_METHODS) {
      const fn = methods[method];
      for (let i = 0; i < (fn?.mock.calls.length ?? 0); i++) calls.push(`${name}.${method}`);
    }
  }
  return calls;
}

const post = (path: string, body: unknown, headers?: Record<string, string>) =>
  new NextRequest(`http://localhost${path}`, { method: "POST", body: JSON.stringify(body), headers });

beforeEach(() => {
  vi.clearAllMocks();
  h.models.clear();
  h.mockCaller.mockResolvedValue({ kind: "session" });
  h.mockContext.mockResolvedValue(OWNER);
  h.mockUnsubscribe.mockResolvedValue({ success: true });
  h.mockSubscribe.mockResolvedValue({ success: true });
  h.queryRaw.mockResolvedValue([]);
});

describe("disconnect touches NOTHING but the account row", () => {
  it("ACTIVE account: the only writes are instagramAccount.update + one operational event", async () => {
    h.prisma.instagramAccount.findFirst.mockResolvedValue(ACCOUNT);
    for (const [name, n] of [
      ["automation", 4],
      ["contact", 120],
      ["directMessage", 900],
      ["draftReply", 3],
      ["conversationLink", 2],
      ["commentModeration", 40],
      ["dmLog", 300],
      ["followerSnapshot", 30],
    ] as const) {
      h.prisma[name].count.mockResolvedValue(n);
    }

    const res = await disconnectRoute.POST(post("/api/instagram/disconnect", { instagramAccountId: "acc_A" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(writes().sort()).toEqual(["instagramAccount.update", "operationalEvent.create"]);
    expect(h.transaction).not.toHaveBeenCalled();
    for (const name of LINKED_MODELS) {
      for (const method of WRITE_METHODS) {
        expect(h.models.get(name)?.[method]?.mock.calls.length ?? 0, `${name}.${method}`).toBe(0);
      }
    }
    // The account keeps its id/instagramId (so the reconnect upsert finds it).
    const update = h.prisma.instagramAccount.update.mock.calls[0][0];
    expect(update.where).toEqual({ id: "acc_A" });
    expect(update.data).not.toHaveProperty("instagramId");
    expect(update.data).not.toHaveProperty("workspaceId");
    expect(json.data.kept).toEqual({
      campaigns: 4,
      contacts: 120,
      messages: 900,
      drafts: 3,
      links: 2,
      moderation: 40,
      dmLogs: 300,
      followerSnapshots: 30,
    });
  });

  it("an account that already needs reconnect (no token): no Meta call, still nothing deleted", async () => {
    h.prisma.instagramAccount.findFirst.mockResolvedValue({ ...ACCOUNT, accessToken: "", status: "NEEDS_RECONNECT" });
    const res = await disconnectRoute.POST(post("/api/instagram/disconnect", { instagramAccountId: "acc_A" }));
    expect(res.status).toBe(200);
    expect(h.mockUnsubscribe).not.toHaveBeenCalled();
    expect(h.prisma.instagramAccount.update.mock.calls[0][0].data.status).toBe("DISCONNECTED");
    expect(writes().sort()).toEqual(["instagramAccount.update", "operationalEvent.create"]);
  });

  it("401 without a session, 403 for a MEMBER, nothing written", async () => {
    h.mockContext.mockResolvedValue(null);
    expect((await disconnectRoute.POST(post("/api/instagram/disconnect", { instagramAccountId: "acc_A" }))).status).toBe(401);
    h.mockContext.mockResolvedValue(MEMBER);
    expect((await disconnectRoute.POST(post("/api/instagram/disconnect", { instagramAccountId: "acc_A" }))).status).toBe(403);
    expect(writes()).toEqual([]);
  });

  it("an invalid API key is refused the same as a valid one", async () => {
    h.mockCaller.mockResolvedValue({ kind: "token", tokenId: null, scopes: [] });
    const res = await disconnectRoute.POST(post("/api/instagram/disconnect", { instagramAccountId: "acc_A" }));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("human_only");
    expect(writes()).toEqual([]);
  });
});

describe("reconnect (OAuth callback upsert) turns the same row back on, as it was", () => {
  const callback = () =>
    callbackRoute.GET(new NextRequest("http://localhost/api/instagram/callback?code=abc&state=s"));

  beforeEach(() => {
    h.mockState.mockReturnValue({ workspaceId: "ws_A" });
    h.mockAuth.mockResolvedValue({ user: { id: "u_owner" } });
    h.prisma.workspaceMember.findFirst.mockResolvedValue({ role: "OWNER" });
    h.mockUserInfo.mockResolvedValue({
      id: "app_scoped",
      user_id: "ig_owner",
      username: "omatheus.ai",
      name: "Matheus",
      profile_picture_url: "https://cdn/p.jpg",
    });
  });

  it("a DISCONNECTED account comes back ACTIVE on the same row; campaigns are not touched", async () => {
    h.prisma.instagramAccount.findUnique.mockImplementation(async () => ({ id: "acc_A", workspaceId: "ws_A", status: "DISCONNECTED" }));
    const res = await callback();

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://app.test/channels?connected=true");
    const upsert = h.prisma.instagramAccount.upsert.mock.calls[0][0];
    expect(upsert.where).toEqual({ instagramId: "ig_owner" });
    expect(upsert.update).toMatchObject({
      workspaceId: "ws_A",
      status: "ACTIVE",
      accessToken: "enc:long",
      disconnectedAt: null,
      disconnectedBy: null,
      lastError: null,
      webhookSubscribed: true,
      profilePictureUrl: "https://cdn/p.jpg",
    });
    expect(upsert.update.reconnectedAt).toBeInstanceOf(Date);
    // Nothing else changes: each campaign keeps the on/off it had.
    expect(writes().sort()).toEqual(["instagramAccount.upsert", "operationalEvent.create"]);
    expect(h.prisma.operationalEvent.create.mock.calls[0][0].data.message).toContain("reconnected");
  });

  it("the same account kept in ANOTHER workspace is not taken over (nothing written)", async () => {
    h.prisma.instagramAccount.findUnique.mockResolvedValue({ id: "acc_B", workspaceId: "ws_B", status: "DISCONNECTED" });
    const res = await callback();
    expect(res.headers.get("location")).toBe("https://app.test/channels?instagram=already_connected");
    expect(writes()).toEqual([]);
  });

  it("a MEMBER cannot reconnect", async () => {
    h.prisma.workspaceMember.findFirst.mockResolvedValue({ role: "MEMBER" });
    const res = await callback();
    expect(res.headers.get("location")).toBe("https://app.test/channels?instagram=forbidden");
    expect(writes()).toEqual([]);
  });

  it("webhook subscribe failing still reconnects (ACTIVE, error recorded), nothing deleted", async () => {
    h.prisma.instagramAccount.findUnique.mockResolvedValue({ id: "acc_A", workspaceId: "ws_A", status: "NEEDS_RECONNECT" });
    h.mockSubscribe.mockRejectedValue(new Error("meta down"));
    await callback();
    const upsert = h.prisma.instagramAccount.upsert.mock.calls[0][0];
    expect(upsert.update).toMatchObject({ status: "ACTIVE", webhookSubscribed: false, webhookFields: [] });
    expect(upsert.update.lastError).toContain("Webhook");
    expect(writes().filter((w) => w.endsWith("delete") || w.endsWith("deleteMany"))).toEqual([]);
  });
});

describe("delete for real (purge): every guard, and API keys never", () => {
  const body = { instagramAccountId: "acc_A", confirmUsername: "@omatheus.ai" };

  it("401 without a session", async () => {
    h.mockContext.mockResolvedValue(null);
    const res = await purgeRoute.POST(post("/api/instagram/purge", body));
    expect(res.status).toBe(401);
    expect(h.transaction).not.toHaveBeenCalled();
  });

  it("an API key (valid or not, any scope) is refused before anything is read", async () => {
    for (const caller of [
      { kind: "token", tokenId: "t1", scopes: ["*"] },
      { kind: "token", tokenId: null, scopes: [] },
    ]) {
      h.mockCaller.mockResolvedValue(caller);
      const res = await purgeRoute.POST(post("/api/instagram/purge", body));
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe("human_only");
    }
    expect(h.mockContext).not.toHaveBeenCalled();
    expect(h.prisma.instagramAccount.findFirst).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
  });

  it("ADMIN and MEMBER are refused", async () => {
    for (const ctx of [ADMIN, MEMBER]) {
      h.mockContext.mockResolvedValue(ctx);
      expect((await purgeRoute.POST(post("/api/instagram/purge", body))).status).toBe(403);
    }
    expect(h.transaction).not.toHaveBeenCalled();
  });

  it("without the typed @ -> 400, nothing deleted", async () => {
    h.prisma.instagramAccount.findFirst.mockResolvedValue(DISCONNECTED);
    const res = await purgeRoute.POST(post("/api/instagram/purge", { instagramAccountId: "acc_A" }));
    expect(res.status).toBe(400);
    expect(h.transaction).not.toHaveBeenCalled();
  });

  it("a near-miss @ is refused (no prefix/substring match)", async () => {
    h.prisma.instagramAccount.findFirst.mockResolvedValue(DISCONNECTED);
    for (const typed of ["omatheus", "omatheus.ai2", "@omatheus.ai.", "matheus.ai"]) {
      const res = await purgeRoute.POST(post("/api/instagram/purge", { instagramAccountId: "acc_A", confirmUsername: typed }));
      expect(res.status, typed).toBe(400);
    }
    expect(h.transaction).not.toHaveBeenCalled();
  });

  it("NEEDS_RECONNECT is not DISCONNECTED: refused with 409", async () => {
    h.prisma.instagramAccount.findFirst.mockResolvedValue({ ...ACCOUNT, status: "NEEDS_RECONNECT" });
    const res = await purgeRoute.POST(post("/api/instagram/purge", body));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("not_disconnected");
    expect(h.transaction).not.toHaveBeenCalled();
  });

  it("scoped by workspace: an account of another workspace is a 404", async () => {
    h.prisma.instagramAccount.findFirst.mockResolvedValue(null);
    const res = await purgeRoute.POST(post("/api/instagram/purge", body));
    expect(res.status).toBe(404);
    expect(h.prisma.instagramAccount.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "acc_A", workspaceId: "ws_A" } })
    );
    expect(h.transaction).not.toHaveBeenCalled();
  });

  it("everything right: one transaction, only this account's rows, the account last", async () => {
    h.prisma.instagramAccount.findFirst.mockResolvedValue(DISCONNECTED);
    const order: string[] = [];
    for (const name of [
      "draftReply",
      "outboundMessage",
      "commentModeration",
      "moderationSettings",
      "conversationLink",
      "linkClick",
      "dmLog",
      "automation",
      "contact",
      "followerSnapshot",
      "directMessage",
      "processedComment",
    ]) {
      h.prisma[name].deleteMany.mockImplementation(async (args: { where: Record<string, unknown> }) => {
        order.push(name);
        const where = JSON.stringify(args.where);
        expect(where.includes("acc_A") || where.includes("ig_owner"), `${name} scoped`).toBe(true);
        return { count: 1 };
      });
    }
    h.prisma.instagramAccount.delete.mockImplementation(async () => {
      order.push("instagramAccount");
      return {};
    });

    const res = await purgeRoute.POST(post("/api/instagram/purge", body));
    expect(res.status).toBe(200);
    expect(h.transaction).toHaveBeenCalledTimes(1);
    expect(order.at(-1)).toBe("instagramAccount");
    expect(order).toHaveLength(13);
  });
});

describe("401 and workspace scope on the new channel routes", () => {
  it("GET /api/channels: 401 without a session, reads only the caller's workspace", async () => {
    h.mockContext.mockResolvedValue(null);
    expect((await channelsRoute.GET()).status).toBe(401);

    h.mockContext.mockResolvedValue(OWNER);
    h.prisma.instagramAccount.findMany.mockResolvedValue([]);
    const res = await channelsRoute.GET();
    expect(res.status).toBe(200);
    expect(h.prisma.instagramAccount.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: "ws_A" } })
    );
  });

  it("POST test: 401 without a session, 404 for an account of another workspace (Meta never called)", async () => {
    const params = { params: Promise.resolve({ id: "acc_other" }) };
    h.mockContext.mockResolvedValue(null);
    expect((await testRoute.POST(post("/api/channels/instagram/acc_other/test", {}), params)).status).toBe(401);

    h.mockContext.mockResolvedValue(OWNER);
    h.prisma.instagramAccount.findFirst.mockResolvedValue(null);
    const res = await testRoute.POST(post("/api/channels/instagram/acc_other/test", {}), {
      params: Promise.resolve({ id: "acc_other" }),
    });
    expect(res.status).toBe(404);
    expect(h.prisma.instagramAccount.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "acc_other", workspaceId: "ws_A" } })
    );
    expect(h.mockUserInfo).not.toHaveBeenCalled();
  });

  it("POST test on a DISCONNECTED channel: not tested, not turned back on, nothing written", async () => {
    h.prisma.instagramAccount.findFirst.mockResolvedValue(DISCONNECTED);
    const res = await testRoute.POST(post("/api/channels/instagram/acc_A/test", {}), {
      params: Promise.resolve({ id: "acc_A" }),
    });
    const json = await res.json();
    expect(json.data).toMatchObject({ ok: false, status: "DISCONNECTED", code: "channel_disconnected" });
    expect(h.mockUserInfo).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
  });
});

describe("banner alerts match the Channels card", () => {
  it("an account with no lastWebhookAt yet uses the stored WebhookEvent (no false 'stalled' alert)", async () => {
    const now = new Date("2026-10-05T12:00:00Z");
    h.prisma.instagramAccount.findMany.mockResolvedValue([
      {
        id: "acc_A",
        instagramId: "ig_owner",
        username: "omatheus.ai",
        status: "ACTIVE",
        tokenExpiresAt: new Date("2026-11-30T00:00:00Z"),
        webhookSubscribed: true,
        lastWebhookAt: null,
        connectedAt: new Date("2026-09-01T00:00:00Z"),
        reconnectedAt: null,
      },
    ]);
    h.queryRaw.mockResolvedValue([{ createdAt: new Date("2026-10-05T11:30:00Z") }]);
    expect(await getChannelAlerts("ws_A", now)).toEqual([]);

    h.queryRaw.mockResolvedValue([]);
    expect((await getChannelAlerts("ws_A", now)).map((a) => a.code)).toEqual(["webhooks_stale"]);
  });
});
