/**
 * Canais: desconectar desliga sem apagar nada; token derrubado pela Meta vira
 * "Precisa reconectar"; nada envia por canal desligado; excluir de verdade só
 * pelo dono, numa sessão humana, digitando o @.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => {
  // Any prisma model/method exists and resolves to null unless a test says otherwise.
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
  const prisma = new Proxy({} as Record<string, unknown>, {
    get(_t, name: string) {
      if (name === "$transaction") return transaction;
      if (name === "$queryRaw") return vi.fn(async () => []);
      return model(name);
    },
  });
  transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
  return {
    prisma: prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>,
    models,
    transaction,
    mockContext: vi.fn(),
    mockCaller: vi.fn(),
    mockUnsubscribe: vi.fn(),
    mockUserInfo: vi.fn(),
    mockFields: vi.fn(),
  };
});

vi.mock("@/lib/db/client", () => ({ prisma: h.prisma }));
vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext: h.mockContext,
  canManageWorkspace: (role: string) => role === "OWNER" || role === "ADMIN",
}));
vi.mock("@/lib/auth", () => ({ getApiCaller: h.mockCaller }));
vi.mock("@/lib/meta/oauth", () => ({ decryptToken: (t: string) => `plain:${t}` }));
vi.mock("@/lib/meta/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/meta/client")>();
  return {
    ...real,
    unsubscribeInstagramAccountFromWebhooks: h.mockUnsubscribe,
    getUserInfo: h.mockUserInfo,
    getSubscribedWebhookFields: h.mockFields,
  };
});

import { TokenExpiredError } from "../lib/meta/client";
import * as disconnectRoute from "../app/api/instagram/disconnect/route";
import * as purgeRoute from "../app/api/instagram/purge/route";
import * as testRoute from "../app/api/channels/instagram/[id]/test/route";
import * as channelsRoute from "../app/api/channels/route";
import { channelAlerts } from "../lib/channels/overview";
import { ChannelOffError, markNeedsReconnect, noteMetaError } from "../lib/channels/status";
import { requireActiveInstagramAccount } from "../lib/instagram-accounts";
import { sendTracked } from "../lib/meta/send";
import { approveAndSend } from "../lib/drafts/drafts";
import { TOOLS } from "../lib/mcp/server";

const OWNER = { userId: "u_owner", workspaceId: "ws_A", role: "OWNER" };
const ADMIN = { userId: "u_admin", workspaceId: "ws_A", role: "ADMIN" };
const ACCOUNT = {
  id: "acc_A",
  instagramId: "ig_owner",
  username: "omatheus.ai",
  accessToken: "enc",
  status: "ACTIVE",
};

const post = (path: string, body: unknown) =>
  new NextRequest(`http://localhost${path}`, { method: "POST", body: JSON.stringify(body) });

/** Every delete-ish call made on any model. */
function deletes() {
  const calls: string[] = [];
  for (const [name, methods] of h.models) {
    for (const method of ["delete", "deleteMany"]) {
      if (methods[method]?.mock.calls.length) calls.push(`${name}.${method}`);
    }
  }
  return calls;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.models.clear();
  h.mockCaller.mockResolvedValue({ kind: "session" });
  h.mockContext.mockResolvedValue(OWNER);
  h.mockUnsubscribe.mockResolvedValue({ success: true });
});

describe("POST /api/instagram/disconnect = turn the channel off, delete nothing", () => {
  it("marks DISCONNECTED, wipes the token, unsubscribes webhooks first and deletes nothing", async () => {
    h.prisma.instagramAccount.findFirst.mockResolvedValue(ACCOUNT);
    h.prisma.automation.count.mockResolvedValue(3);

    const res = await disconnectRoute.POST(post("/api/instagram/disconnect", { instagramAccountId: "acc_A" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.status).toBe("DISCONNECTED");
    expect(json.data.kept.campaigns).toBe(3);
    expect(h.mockUnsubscribe).toHaveBeenCalledWith("ig_owner", "plain:enc");
    const update = h.prisma.instagramAccount.update.mock.calls[0][0];
    expect(update.where).toEqual({ id: "acc_A" });
    expect(update.data).toMatchObject({
      status: "DISCONNECTED",
      accessToken: "",
      disconnectedBy: "u_owner",
      webhookSubscribed: false,
    });
    // Campaigns keep their on/off state: nothing touches them.
    expect(h.prisma.automation.updateMany).not.toHaveBeenCalled();
    expect(deletes()).toEqual([]);
  });

  it("a failed webhook unsubscribe never blocks the disconnect (recorded as lastError)", async () => {
    h.prisma.instagramAccount.findFirst.mockResolvedValue(ACCOUNT);
    h.mockUnsubscribe.mockRejectedValue(new Error("boom"));

    const res = await disconnectRoute.POST(post("/api/instagram/disconnect", { instagramAccountId: "acc_A" }));
    expect(res.status).toBe(200);
    const data = h.prisma.instagramAccount.update.mock.calls[0][0].data;
    expect(data.status).toBe("DISCONNECTED");
    expect(data.lastError).toContain("boom");
    expect(deletes()).toEqual([]);
  });

  it("requires the account id (never 'every account of the workspace')", async () => {
    const res = await disconnectRoute.POST(post("/api/instagram/disconnect", {}));
    expect(res.status).toBe(400);
    expect(h.prisma.instagramAccount.update).not.toHaveBeenCalled();
    expect(deletes()).toEqual([]);
  });

  it("an API key (MCP, scripts) cannot disconnect", async () => {
    h.mockCaller.mockResolvedValue({ kind: "token", tokenId: "t1", scopes: [] });
    const res = await disconnectRoute.POST(post("/api/instagram/disconnect", { instagramAccountId: "acc_A" }));
    expect(res.status).toBe(403);
    expect(h.prisma.instagramAccount.update).not.toHaveBeenCalled();
  });

  it("only touches an account of the caller's workspace", async () => {
    h.prisma.instagramAccount.findFirst.mockResolvedValue(null);
    const res = await disconnectRoute.POST(post("/api/instagram/disconnect", { instagramAccountId: "acc_other" }));
    expect(res.status).toBe(404);
    expect(h.prisma.instagramAccount.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "acc_other", workspaceId: "ws_A" } })
    );
  });
});

describe("POST /api/instagram/purge = delete for real, hidden and guarded", () => {
  const disconnected = { ...ACCOUNT, accessToken: "", status: "DISCONNECTED" };

  it("never from an API key", async () => {
    h.mockCaller.mockResolvedValue({ kind: "token", tokenId: "t1", scopes: ["drafts:approve"] });
    const res = await purgeRoute.POST(post("/api/instagram/purge", { instagramAccountId: "acc_A", confirmUsername: "@omatheus.ai" }));
    expect(res.status).toBe(403);
    expect(h.transaction).not.toHaveBeenCalled();
  });

  it("only the OWNER (an admin cannot)", async () => {
    h.mockContext.mockResolvedValue(ADMIN);
    const res = await purgeRoute.POST(post("/api/instagram/purge", { instagramAccountId: "acc_A", confirmUsername: "@omatheus.ai" }));
    expect(res.status).toBe(403);
    expect(h.transaction).not.toHaveBeenCalled();
  });

  it("the typed @ must match the account", async () => {
    h.prisma.instagramAccount.findFirst.mockResolvedValue(disconnected);
    const res = await purgeRoute.POST(post("/api/instagram/purge", { instagramAccountId: "acc_A", confirmUsername: "@outra" }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("confirmation_mismatch");
    expect(h.transaction).not.toHaveBeenCalled();
  });

  it("an ACTIVE channel must be disconnected first", async () => {
    h.prisma.instagramAccount.findFirst.mockResolvedValue(ACCOUNT);
    const res = await purgeRoute.POST(post("/api/instagram/purge", { instagramAccountId: "acc_A", confirmUsername: "omatheus.ai" }));
    expect(res.status).toBe(409);
    expect(h.transaction).not.toHaveBeenCalled();
  });

  it("with everything right, deletes the account and its data in one transaction", async () => {
    h.prisma.instagramAccount.findFirst.mockResolvedValue(disconnected);
    const res = await purgeRoute.POST(post("/api/instagram/purge", { instagramAccountId: "acc_A", confirmUsername: "@OMatheus.ai" }));
    expect(res.status).toBe(200);
    expect(h.transaction).toHaveBeenCalledTimes(1);
    expect(h.prisma.instagramAccount.delete).toHaveBeenCalledWith({ where: { id: "acc_A" } });
    expect(h.prisma.directMessage.deleteMany).toHaveBeenCalledWith({ where: { accountId: "ig_owner" } });
    expect(h.prisma.automation.deleteMany).toHaveBeenCalledWith({ where: { instagramAccountId: "acc_A" } });
  });
});

describe("token rejected by Meta -> NEEDS_RECONNECT, nothing deleted", () => {
  it("markNeedsReconnect only moves an ACTIVE account (a DISCONNECTED one stays)", async () => {
    h.prisma.instagramAccount.updateMany.mockResolvedValue({ count: 1 });
    await markNeedsReconnect({ instagramId: "ig_owner" }, "expired");
    expect(h.prisma.instagramAccount.updateMany).toHaveBeenCalledWith({
      where: { instagramId: "ig_owner", status: "ACTIVE" },
      data: expect.objectContaining({ status: "NEEDS_RECONNECT", lastError: "expired" }),
    });
    expect(deletes()).toEqual([]);
  });

  it("noteMetaError reacts only to code 190", async () => {
    h.prisma.instagramAccount.updateMany.mockResolvedValue({ count: 1 });
    expect(await noteMetaError({ id: "acc_A" }, new Error("network"))).toBe(false);
    expect(h.prisma.instagramAccount.updateMany).not.toHaveBeenCalled();
    expect(await noteMetaError({ id: "acc_A" }, new TokenExpiredError("Session expired"))).toBe(true);
    expect(h.prisma.instagramAccount.updateMany).toHaveBeenCalledTimes(1);
  });

  it("a send that gets 190 flags the channel", async () => {
    h.prisma.instagramAccount.findUnique.mockResolvedValue({ status: "ACTIVE" });
    h.prisma.outboundMessage.create.mockResolvedValue({ id: "row_1" });
    h.prisma.instagramAccount.updateMany.mockResolvedValue({ count: 1 });
    await expect(
      sendTracked(
        { workspaceId: "ws_A", instagramAccountId: "acc_A", contactIgUserId: "ig_p", origin: "automation" },
        async () => {
          throw new TokenExpiredError("Error validating access token");
        }
      )
    ).rejects.toBeInstanceOf(TokenExpiredError);
    expect(h.prisma.instagramAccount.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "acc_A", status: "ACTIVE" } })
    );
  });

  it("'Test connection' with a rejected token marks NEEDS_RECONNECT", async () => {
    h.prisma.instagramAccount.findFirst.mockResolvedValue(ACCOUNT);
    h.prisma.instagramAccount.updateMany.mockResolvedValue({ count: 1 });
    h.mockUserInfo.mockRejectedValue(new TokenExpiredError("expired"));
    const res = await testRoute.POST(post("/api/channels/instagram/acc_A/test", {}), {
      params: Promise.resolve({ id: "acc_A" }),
    });
    const json = await res.json();
    expect(json.data).toMatchObject({ ok: false, status: "NEEDS_RECONNECT", code: "needs_reconnect" });
  });

  it("'Test connection' OK refreshes the photo and brings a NEEDS_RECONNECT channel back", async () => {
    h.prisma.instagramAccount.findFirst.mockResolvedValue({ ...ACCOUNT, status: "NEEDS_RECONNECT" });
    h.mockUserInfo.mockResolvedValue({ id: "app_1", user_id: "ig_owner", username: "omatheus.ai", profile_picture_url: "https://cdn/p.jpg", followers_count: 425000 });
    h.mockFields.mockResolvedValue(["comments", "messages"]);
    h.prisma.instagramAccount.update.mockResolvedValue({
      status: "ACTIVE",
      webhookSubscribed: true,
      webhookFields: ["comments", "messages"],
      profilePictureUrl: "https://cdn/p.jpg",
      username: "omatheus.ai",
    });
    const res = await testRoute.POST(post("/api/channels/instagram/acc_A/test", {}), {
      params: Promise.resolve({ id: "acc_A" }),
    });
    const json = await res.json();
    expect(json.data).toMatchObject({ ok: true, status: "ACTIVE", followers: 425000 });
    // Back on only if still NEEDS_RECONNECT with the same token (a disconnect
    // during the test is never undone).
    expect(h.prisma.instagramAccount.updateMany).toHaveBeenCalledWith({
      where: { id: "acc_A", status: "NEEDS_RECONNECT", accessToken: ACCOUNT.accessToken },
      data: { status: "ACTIVE" },
    });
    const data = h.prisma.instagramAccount.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ profilePictureUrl: "https://cdn/p.jpg", lastError: null });
    expect(data).not.toHaveProperty("status");
  });
});

describe("nothing goes out through a channel that is off", () => {
  it("sendTracked refuses before writing or sending", async () => {
    h.prisma.instagramAccount.findUnique.mockResolvedValue({ status: "DISCONNECTED" });
    const send = vi.fn();
    await expect(
      sendTracked({ workspaceId: "ws_A", instagramAccountId: "acc_A", contactIgUserId: "ig_p", origin: "inbox" }, send)
    ).rejects.toBeInstanceOf(ChannelOffError);
    expect(send).not.toHaveBeenCalled();
    expect(h.prisma.outboundMessage.create).not.toHaveBeenCalled();
  });

  it("approving a draft on a disconnected channel keeps it PENDING (no claim, nothing sent)", async () => {
    h.prisma.draftReply.findFirst.mockResolvedValue({
      id: "d_1",
      workspaceId: "ws_A",
      instagramAccountId: "acc_A",
      text: "Oi",
      status: "PENDING",
      contact: { id: "ct_1", workspaceId: "ws_A", igUserId: "ig_p", lastInboundAt: new Date() },
      instagramAccount: { id: "acc_A", instagramId: "ig_owner", accessToken: "", status: "DISCONNECTED" },
    });
    const result = await approveAndSend({ workspaceId: "ws_A", id: "d_1", approvedBy: "u", approvedVia: "session" });
    expect(result).toMatchObject({ ok: false, status: 409, code: "channel_disconnected" });
    expect(h.prisma.draftReply.updateMany).not.toHaveBeenCalled();
  });

  it("routes that call Meta answer 409 'needs_reconnect' instead of calling it", async () => {
    h.prisma.instagramAccount.findFirst.mockResolvedValue({ ...ACCOUNT, status: "NEEDS_RECONNECT" });
    const result = await requireActiveInstagramAccount("ws_A", "acc_A");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(409);
      expect((await result.response.json()).code).toBe("needs_reconnect");
    }
  });
});

describe("Channels page data", () => {
  const now = new Date("2026-10-05T12:00:00Z");
  const base = {
    id: "acc_A",
    username: "omatheus.ai",
    status: "ACTIVE" as const,
    tokenExpiresAt: new Date("2026-11-30T00:00:00Z"),
    webhookSubscribed: true,
    lastWebhookAt: new Date("2026-10-05T11:00:00Z"),
    connectedAt: new Date("2026-09-01T00:00:00Z"),
    reconnectedAt: null,
  };

  it("a healthy channel has no alert; a DISCONNECTED one never alerts", () => {
    expect(channelAlerts(base, now)).toEqual([]);
    expect(channelAlerts({ ...base, status: "DISCONNECTED", lastWebhookAt: null }, now)).toEqual([]);
  });

  it("alerts: needs reconnect, token expiring in < 10 days, webhooks stalled > 24 h", () => {
    expect(channelAlerts({ ...base, status: "NEEDS_RECONNECT" }, now).map((a) => a.code)).toEqual(["needs_reconnect"]);
    expect(
      channelAlerts({ ...base, tokenExpiresAt: new Date("2026-10-10T00:00:00Z") }, now).map((a) => a.code)
    ).toEqual(["token_expiring"]);
    expect(
      channelAlerts({ ...base, lastWebhookAt: new Date("2026-10-04T00:00:00Z") }, now).map((a) => a.code)
    ).toEqual(["webhooks_stale"]);
  });

  it("GET /api/channels returns the cards and the coming-soon channels", async () => {
    h.prisma.instagramAccount.findMany.mockResolvedValue([
      { ...base, instagramId: "ig_owner", name: null, profilePictureUrl: null, disconnectedAt: null, webhookFields: ["comments"], lastError: null, lastErrorAt: null, moderationSettings: { mode: "HIDE" } },
    ]);
    h.prisma.automation.count.mockResolvedValue(2);
    h.prisma.contact.count.mockResolvedValue(10);
    h.prisma.draftReply.count.mockResolvedValue(1);
    const res = await channelsRoute.GET();
    const json = await res.json();
    expect(json.data.instagram[0]).toMatchObject({
      username: "omatheus.ai",
      status: "ACTIVE",
      moderationMode: "HIDE",
      contacts: 10,
      pendingDrafts: 1,
    });
    // Subscribed before a field existed: the card says what is missing
    // (2026-10-06: live_comments for the live trigger).
    expect(json.data.instagram[0].missingWebhookFields).toEqual(
      expect.arrayContaining(["live_comments", "messages"])
    );
    expect(json.data.instagram[0].missingWebhookFields).not.toContain("comments");
    expect(json.data.comingSoon.map((c: { platform: string }) => c.platform)).toEqual([
      "telegram",
      "whatsapp",
      "messenger",
      "threads",
    ]);
  });

  it("MCP ver_canais only reads GET /api/channels", async () => {
    const tool = TOOLS.find((t) => t.name === "ver_canais");
    expect(tool).toBeDefined();
    const call = vi.fn(async () => ({ status: 200, json: { success: true, data: { instagram: [], comingSoon: [] } } }));
    await tool!.run({}, call);
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith("GET", "/api/channels", undefined);
  });
});
