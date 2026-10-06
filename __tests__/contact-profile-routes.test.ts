/**
 * O que as telas precisam pra trocar "Usuário desconhecido": nome, foto e a
 * conta do contato saem nas APIs (rascunhos/contexto, moderação), e os @ que
 * a Conversations API já traz são gravados sem chamar a Meta de novo.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  prisma: {
    commentModeration: { findMany: vi.fn(), count: vi.fn(async () => 1), groupBy: vi.fn(async () => []) },
    contact: { findMany: vi.fn(), updateMany: vi.fn(async () => ({ count: 1 })) },
    directMessage: { findMany: vi.fn(async (): Promise<unknown[]> => []) },
    outboundMessage: { findMany: vi.fn(async (): Promise<unknown[]> => []) },
  },
  getConversations: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: h.prisma }));
vi.mock("@/lib/auth", () => ({ getCurrentWorkspaceId: vi.fn(async () => "ws"), getApiCaller: vi.fn() }));
vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext: vi.fn(async () => ({ workspaceId: "ws", userId: "u1", role: "OWNER" })),
  canManageWorkspace: () => true,
}));
vi.mock("@/lib/instagram-accounts", () => ({
  requireActiveInstagramAccount: vi.fn(async () => ({
    ok: true,
    account: { id: "acc_row", instagramId: "ig_owner", username: "omatheus.ai", accessToken: "enc" },
  })),
}));
vi.mock("@/lib/meta/oauth", () => ({ decryptToken: (t: string) => `plain:${t}` }));
vi.mock("@/lib/meta/client", () => ({
  getConversations: h.getConversations,
  sendDirectMessage: vi.fn(),
  getUserProfile: vi.fn(),
  MetaApiError: class MetaApiError extends Error {},
}));
vi.mock("@/lib/channels/status", () => ({ isChannelOffError: () => false, noteMetaError: vi.fn(), isTokenRejected: () => false }));

import { GET as moderationLog } from "../app/api/moderation/log/route";
import { GET as conversations } from "../app/api/instagram/conversations/route";
import { CONTEXT_CONTACT_SELECT, presentContact } from "../lib/inbox/context";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("moderation log", () => {
  it("each row carries the commenter's contact (name / photo / @)", async () => {
    h.prisma.commentModeration.findMany.mockResolvedValue([
      { id: "m1", instagramAccountId: "acc_row", commenterIgId: "p1", commenterUsername: null, instagramAccount: { username: "omatheus.ai" } },
      { id: "m2", instagramAccountId: "acc_row", commenterIgId: "p2", commenterUsername: "bia", instagramAccount: { username: "omatheus.ai" } },
    ]);
    h.prisma.contact.findMany.mockResolvedValue([
      { id: "ct_1", instagramAccountId: "acc_row", igUserId: "p1", username: null, name: "Maria", profilePicUrl: "https://cdn/p.jpg" },
    ]);
    const res = await moderationLog(new NextRequest(new URL("/api/moderation/log", "http://localhost")));
    const body = await res.json();
    expect(body.data.logs[0].contact).toEqual({ id: "ct_1", username: null, name: "Maria", profilePicUrl: "https://cdn/p.jpg" });
    expect(body.data.logs[1].contact).toBeNull();
    expect(h.prisma.contact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workspaceId: "ws",
          OR: [
            { instagramAccountId: "acc_row", igUserId: "p1" },
            { instagramAccountId: "acc_row", igUserId: "p2" },
          ],
        },
      })
    );
  });

  it("the log still loads when the join fails", async () => {
    h.prisma.commentModeration.findMany.mockResolvedValue([{ id: "m1", instagramAccountId: "acc_row", commenterIgId: "p1" }]);
    h.prisma.contact.findMany.mockRejectedValue(new Error("db"));
    const res = await moderationLog(new NextRequest(new URL("/api/moderation/log", "http://localhost")));
    expect(res.status).toBe(200);
    expect((await res.json()).data.logs[0].contact).toBeNull();
  });
});

describe("conversations list", () => {
  it("saves the participants' @ on contacts that have none", async () => {
    h.getConversations.mockResolvedValue([
      { id: "t1", participants: { data: [{ id: "ig_owner", username: "omatheus.ai" }, { id: "p1", username: "ana.lima" }] }, messages: { data: [] } },
    ]);
    h.prisma.contact.findMany.mockResolvedValue([{ id: "ct_1", igUserId: "p1" }]);
    const res = await conversations(new NextRequest(new URL("/api/instagram/conversations", "http://localhost")));
    expect(res.status).toBe(200);
    expect(h.prisma.contact.updateMany).toHaveBeenCalledWith({
      where: { id: "ct_1", username: null },
      data: expect.objectContaining({ username: "ana.lima" }),
    });
  });
});

describe("conversations list: campaign card preview (06/10)", () => {
  const thread = (id: string, mid: string, message = "") => ({
    id,
    participants: { data: [{ id: "ig_owner", username: "omatheus.ai" }, { id: `p_${id}`, username: null }] },
    messages: { data: [{ id: mid, message, from: { id: "ig_owner" }, created_time: "2026-10-06T12:00:00Z" }] },
  });

  it("an empty card shows the template title, then what we sent, never '(sem texto)'", async () => {
    h.getConversations.mockResolvedValue([
      thread("t1", "mid_card"),
      thread("t2", "mid_ledger"),
      thread("t3", "mid_text", "Oi, tudo bem?"),
      thread("t4", "mid_unknown"),
    ]);
    h.prisma.contact.findMany.mockResolvedValue([]);
    h.prisma.directMessage.findMany.mockResolvedValueOnce([
      { mid: "mid_card", text: null, template: { title: "Oi ana, pega o material", buttons: [{ title: "Acessar" }] } },
    ]);
    h.prisma.outboundMessage.findMany.mockResolvedValueOnce([{ mid: "mid_ledger", text: "Aqui está o link" }]);

    const res = await conversations(new NextRequest(new URL("/api/instagram/conversations", "http://localhost")));
    const list = (await res.json()).data.conversations as { lastMessage: { text: string } }[];
    expect(list.map((c) => c.lastMessage.text)).toEqual([
      "Oi ana, pega o material",
      "Aqui está o link",
      "Oi, tudo bem?",
      "",
    ]);
    // Only the blank ones are looked up, scoped to this account.
    expect(h.prisma.directMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { accountId: "ig_owner", mid: { in: ["mid_card", "mid_ledger", "mid_unknown"] } } })
    );
    expect(h.prisma.outboundMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { instagramAccountId: "acc_row", mid: { in: ["mid_ledger", "mid_unknown"] } } })
    );
  });

  it("the list still loads when the lookup fails", async () => {
    h.getConversations.mockResolvedValue([thread("t1", "mid_card")]);
    h.prisma.contact.findMany.mockResolvedValue([]);
    h.prisma.directMessage.findMany.mockRejectedValueOnce(new Error("db"));
    const res = await conversations(new NextRequest(new URL("/api/instagram/conversations", "http://localhost")));
    expect(res.status).toBe(200);
    expect((await res.json()).data.conversations[0].lastMessage.text).toBe("");
  });
});

describe("presentContact", () => {
  it("selects and returns the photo and the account (for the open-conversation link)", async () => {
    expect(CONTEXT_CONTACT_SELECT).toMatchObject({ profilePicUrl: true, instagramAccountId: true, name: true });
    const out = await presentContact({
      id: "ct_1",
      igUserId: "p1",
      username: null,
      name: "Maria",
      profilePicUrl: "https://cdn/p.jpg",
      instagramAccountId: "acc_row",
      lastInboundAt: null,
      lastOutboundAt: null,
      humanTakeover: false,
      humanTakeoverUntil: null,
      instagramAccount: { instagramId: "ig_owner", username: "omatheus.ai" },
      tags: [],
    });
    expect(out).toMatchObject({ name: "Maria", profilePicUrl: "https://cdn/p.jpg", instagramAccountId: "acc_row", igUserId: "p1" });
  });
});
