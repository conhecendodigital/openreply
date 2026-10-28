/**
 * Abrir a conversa de uma pessoa fora das recentes que o Instagram lista
 * (link de Aprovações / contato). Mocks da Meta e do Prisma; nada de rede.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  prisma: {
    contact: { findFirst: vi.fn() },
    directMessage: { findFirst: vi.fn(), findMany: vi.fn() },
    $queryRaw: vi.fn(async () => []),
  },
  findConversationIdByUser: vi.fn(),
  getConversationMessages: vi.fn(),
  noteMetaError: vi.fn(),
  account: { id: "acc_row", instagramId: "ig_owner", status: "ACTIVE", accessToken: "enc" } as Record<string, unknown>,
}));

vi.mock("@/lib/db/client", () => ({ prisma: h.prisma }));
vi.mock("@/lib/auth", () => ({ getCurrentWorkspaceId: vi.fn(async () => "ws") }));
vi.mock("@/lib/instagram-accounts", () => ({ getWorkspaceInstagramAccount: vi.fn(async () => h.account) }));
vi.mock("@/lib/meta/oauth", () => ({ decryptToken: (t: string) => `plain:${t}` }));
vi.mock("@/lib/meta/client", () => ({
  findConversationIdByUser: h.findConversationIdByUser,
  getConversationMessages: h.getConversationMessages,
  MetaApiError: class MetaApiError extends Error {},
}));
vi.mock("@/lib/channels/status", () => ({
  ChannelOffError: class ChannelOffError extends Error {},
  channelOffCode: () => "channel_disconnected",
  isChannelOffError: () => false,
  noteMetaError: h.noteMetaError,
}));
vi.mock("@/lib/contacts/profile", () => ({ saveKnownUsernames: vi.fn() }));
vi.mock("@/lib/messages/preview", () => ({ previewTextsByMid: vi.fn(async () => new Map()) }));

import { GET as resolve } from "../app/api/instagram/conversations/resolve/route";
import { GET as thread } from "../app/api/instagram/conversations/[id]/route";
import { canReplyToSavedOnly, mergeResolved, profileUrlFor } from "../lib/inbox/saved-conversation";

const req = (path: string) => new NextRequest(new URL(path, "http://localhost"));
const savedRow = (over: Record<string, unknown> = {}) => ({
  mid: "m1", text: "oi, quero o Comando", fromMe: false, template: null, storyReply: false, storyKind: null,
  deleted: false, attachmentKinds: [], sentAt: new Date("2026-10-20T10:00:00Z"), media: [], ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.account = { id: "acc_row", instagramId: "ig_owner", status: "ACTIVE", accessToken: "enc" };
  h.prisma.contact.findFirst.mockResolvedValue({ username: "maria" });
  h.prisma.directMessage.findFirst.mockResolvedValue(null);
  h.prisma.directMessage.findMany.mockResolvedValue([]);
  h.findConversationIdByUser.mockResolvedValue(null);
});

describe("resolve: contato fora da lista recente", () => {
  it("acha pela busca por usuário da Meta (user_id)", async () => {
    h.findConversationIdByUser.mockResolvedValue("t_123");
    const res = await resolve(req("/x?contactId=p1&instagramAccountId=acc_row"));
    const body = await res.json();
    expect(h.findConversationIdByUser).toHaveBeenCalledWith("plain:enc", "ig_owner", "p1");
    expect(body.data.source).toBe("meta");
    expect(body.data.conversation).toMatchObject({ id: "t_123", contact: { id: "p1", username: "maria" } });
  });

  it("sem resposta da Meta mas com mensagens salvas: abre só as salvas", async () => {
    h.prisma.directMessage.findFirst.mockResolvedValue(savedRow());
    const body = await (await resolve(req("/x?contactId=p1"))).json();
    expect(body.data.source).toBe("saved");
    expect(body.data.conversation.id).toBe("saved:p1");
    expect(body.data.conversation.lastMessage.text).toBe("oi, quero o Comando");
  });

  it("erro da Meta na busca não derruba: cai nas mensagens salvas", async () => {
    h.findConversationIdByUser.mockRejectedValue(new Error("boom"));
    h.prisma.directMessage.findFirst.mockResolvedValue(savedRow());
    const body = await (await resolve(req("/x?contactId=p1"))).json();
    expect(body.data.source).toBe("saved");
  });

  it("canal desconectado: nem chama a Meta, usa as salvas", async () => {
    h.account = { ...h.account, status: "NEEDS_RECONNECT" };
    h.prisma.directMessage.findFirst.mockResolvedValue(savedRow());
    const body = await (await resolve(req("/x?contactId=p1"))).json();
    expect(h.findConversationIdByUser).not.toHaveBeenCalled();
    expect(body.data.source).toBe("saved");
  });

  it("sem mensagens e sem Meta: 'none' com link do perfil, sem erro técnico", async () => {
    const res = await resolve(req("/x?contactId=p1"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toEqual({ source: "none", username: "maria", profileUrl: "https://www.instagram.com/maria/" });
  });

  it("sem @ conhecido não inventa link", async () => {
    h.prisma.contact.findFirst.mockResolvedValue(null);
    const body = await (await resolve(req("/x?contactId=p1"))).json();
    expect(body.data.profileUrl).toBeNull();
  });

  it("exige contactId", async () => {
    expect((await resolve(req("/x"))).status).toBe(400);
  });
});

describe("thread saved:<igsid>", () => {
  it("lê só o banco, nunca chama a Meta, e filtra pela pessoa", async () => {
    h.prisma.directMessage.findMany.mockResolvedValue([savedRow()]);
    const res = await thread(req("/x?instagramAccountId=acc_row"), { params: Promise.resolve({ id: "saved:p1" }) });
    const body = await res.json();
    expect(h.getConversationMessages).not.toHaveBeenCalled();
    expect(h.noteMetaError).not.toHaveBeenCalled();
    expect(h.prisma.directMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { accountId: "ig_owner", contactId: "p1" } })
    );
    expect(body.data.messages).toHaveLength(1);
    expect(body.data.messages[0].text).toBe("oi, quero o Comando");
  });

  it("sem nada salvo devolve erro claro (não técnico)", async () => {
    const res = await thread(req("/x"), { params: Promise.resolve({ id: "saved:p1" }) });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("No saved messages for this person.");
  });

  it("sem regressão: conversa normal da lista continua usando a Meta", async () => {
    h.getConversationMessages.mockResolvedValue([
      { id: "x1", message: "oi", from: { id: "p1" }, created_time: "2026-10-20T10:00:00Z" },
    ]);
    const body = await (await thread(req("/x?contactId=p1"), { params: Promise.resolve({ id: "t_9" }) })).json();
    expect(h.getConversationMessages).toHaveBeenCalledWith("plain:enc", "t_9");
    expect(body.data.messages[0].id).toBe("x1");
  });
});

describe("helpers da tela", () => {
  it("lista: acrescenta a resolvida sem duplicar pessoa nem id", () => {
    const a = { id: "t1", contact: { id: "p1" } };
    const novo = { id: "saved:p2", contact: { id: "p2" } };
    expect(mergeResolved([a], novo)).toEqual([novo, a]);
    expect(mergeResolved([a], { id: "t1", contact: { id: "p1" } })).toEqual([a]);
    expect(mergeResolved([a], { id: "saved:p1", contact: { id: "p1" } })).toEqual([a]);
    expect(mergeResolved([a], null)).toEqual([a]);
  });

  it("janela de 24 h fechada (ou desconhecida) não permite enviar; aberta permite", () => {
    expect(canReplyToSavedOnly({ open: false })).toBe(false);
    expect(canReplyToSavedOnly(null)).toBe(false);
    expect(canReplyToSavedOnly(undefined)).toBe(false);
    expect(canReplyToSavedOnly({ open: true })).toBe(true);
  });

  it("link do perfil só com @ válido", () => {
    expect(profileUrlFor("@a.b_c")).toBe("https://www.instagram.com/a.b_c/");
    expect(profileUrlFor("a b")).toBeNull();
    expect(profileUrlFor(null)).toBeNull();
  });
});
