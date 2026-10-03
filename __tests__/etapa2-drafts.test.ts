/**
 * Etapa 2: rascunhos com aprovação. Regra do dono: nenhuma DM escrita por IA
 * sai sem aprovação humana registrada.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockPrisma, mockContext, mockCaller, mockSend, mockRecordEvent } = vi.hoisted(() => ({
  mockPrisma: {
    contact: { findFirst: vi.fn(), updateMany: vi.fn(async () => ({ count: 1 })) },
    draftReply: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
    instagramAccount: { findFirst: vi.fn() },
  },
  mockContext: vi.fn(),
  mockCaller: vi.fn(),
  mockSend: vi.fn(),
  mockRecordEvent: vi.fn(async () => true),
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext: mockContext,
  canManageWorkspace: () => true,
}));
vi.mock("@/lib/auth", () => ({
  getApiCaller: mockCaller,
  isApiTokenRequest: vi.fn(async () => false),
  getCurrentWorkspaceId: vi.fn(async () => "ws"),
}));
vi.mock("@/lib/meta/client", () => ({
  sendDirectMessage: mockSend,
  getConversations: vi.fn(),
  MetaApiError: class MetaApiError extends Error {
    constructor(public code: number, public subcode: number | undefined, _t: string | undefined, message: string) {
      super(message);
    }
  },
}));
vi.mock("@/lib/meta/send", () => ({
  sendTracked: vi.fn(async (_ctx: unknown, send: (o: unknown) => Promise<unknown>) => send({ metadata: "le:draft:r" })),
}));
vi.mock("@/lib/meta/oauth", () => ({ decryptToken: (t: string) => `plain:${t}` }));
vi.mock("@/lib/contacts/record", () => ({ recordEvent: mockRecordEvent, upsertContact: vi.fn() }));

import { approveAndSend, createDraft, rejectDraft } from "../lib/drafts/drafts";
import * as approveRoute from "../app/api/drafts/[id]/approve/route";
import * as draftsRoute from "../app/api/drafts/route";
import * as conversationsRoute from "../app/api/instagram/conversations/route";
import { handleMcpMessage, TOOLS, type InternalCall } from "../lib/mcp/server";

const now = new Date("2026-10-04T12:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);
const ctx = { userId: "u_matheus", workspaceId: "ws", workspace: { id: "ws" }, role: "OWNER" };

function contact(over: Record<string, unknown> = {}) {
  return {
    id: "ct_1",
    workspaceId: "ws",
    igUserId: "ig_person",
    instagramAccountId: "acc_row",
    lastInboundAt: hoursAgo(1),
    humanTakeover: false,
    humanTakeoverUntil: null,
    ...over,
  };
}

function draft(over: Record<string, unknown> = {}) {
  return {
    id: "d_1",
    workspaceId: "ws",
    instagramAccountId: "acc_row",
    text: "Oi! Te mando o link agora",
    origin: "vendedor",
    status: "PENDING",
    contact: contact(),
    instagramAccount: { id: "acc_row", instagramId: "ig_owner", accessToken: "enc" },
    ...over,
  };
}

function req(path: string, body?: unknown) {
  return new NextRequest(new URL(path, "http://localhost"), {
    method: "POST",
    ...(body !== undefined ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}),
  });
}
const params = (id = "d_1") => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  mockContext.mockResolvedValue(ctx);
  mockCaller.mockResolvedValue({ kind: "session" });
  mockPrisma.contact.findFirst.mockResolvedValue(contact());
  mockPrisma.draftReply.create.mockResolvedValue({ id: "d_1", status: "PENDING", expiresAt: null });
  mockPrisma.draftReply.findFirst.mockResolvedValue(draft());
  mockPrisma.draftReply.updateMany.mockResolvedValue({ count: 1 });
  mockSend.mockResolvedValue({ recipient_id: "ig_person", message_id: "mid_sent" });
});

describe("createDraft", () => {
  it("creates a PENDING draft and never sends", async () => {
    const res = await createDraft({ workspaceId: "ws", contactId: "ct_1", text: "oi", origin: "vendedor", now });
    expect(res.ok).toBe(true);
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockPrisma.draftReply.create.mock.calls[0][0].data).toMatchObject({ origin: "vendedor", contactId: "ct_1" });
  });

  it("the vendedor stays out of a conversation a human took over", async () => {
    mockPrisma.contact.findFirst.mockResolvedValue(contact({ humanTakeover: true, humanTakeoverUntil: new Date(now.getTime() + 3_600_000) }));
    const res = await createDraft({ workspaceId: "ws", contactId: "ct_1", text: "oi", origin: "vendedor", now });
    expect(res).toMatchObject({ ok: false, status: 409, code: "takeover" });
    expect(mockPrisma.draftReply.create).not.toHaveBeenCalled();
  });

  it("refuses when the 24-hour window is closed", async () => {
    mockPrisma.contact.findFirst.mockResolvedValue(contact({ lastInboundAt: hoursAgo(25) }));
    const res = await createDraft({ workspaceId: "ws", contactId: "ct_1", text: "oi", origin: "manual", now });
    expect(res).toMatchObject({ ok: false, status: 409, code: "window_closed" });
  });

  it("one pending draft per person (unique index) answers 409 with the existing id", async () => {
    mockPrisma.draftReply.create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    mockPrisma.draftReply.findFirst.mockResolvedValue({ id: "d_old" });
    const res = await createDraft({ workspaceId: "ws", contactId: "ct_1", text: "oi", origin: "vendedor", now });
    expect(res).toMatchObject({ ok: false, code: "pending_exists", details: { draftId: "d_old" } });
  });
});

describe("approveAndSend (status machine)", () => {
  const approval = { workspaceId: "ws", id: "d_1", approvedBy: "u_matheus", approvedVia: "session" as const, now };

  it("claims PENDING -> APPROVED, sends, then SENT with the mid", async () => {
    const res = await approveAndSend(approval);
    expect(res).toMatchObject({ ok: true, draft: { status: "SENT", sentMid: "mid_sent" } });
    expect(mockPrisma.draftReply.updateMany).toHaveBeenCalledWith({
      where: { id: "d_1", status: "PENDING", text: "Oi! Te mando o link agora" },
      data: expect.objectContaining({ status: "APPROVED", approvedBy: "u_matheus", approvedVia: "session" }),
    });
    expect(mockSend).toHaveBeenCalledWith("plain:enc", "ig_owner", "ig_person", "Oi! Te mando o link agora", {
      metadata: "le:draft:r",
    });
    expect(mockPrisma.draftReply.update).toHaveBeenLastCalledWith({
      where: { id: "d_1" },
      data: expect.objectContaining({ status: "SENT", sentMid: "mid_sent" }),
    });
    expect(mockRecordEvent).toHaveBeenCalledWith(
      { id: "ct_1", workspaceId: "ws" },
      expect.objectContaining({ type: "DRAFT_SENT", refId: "d_1" })
    );
  });

  it("a second approval of the same draft sends nothing (409)", async () => {
    mockPrisma.draftReply.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.draftReply.findUnique.mockResolvedValue({ status: "SENT" });
    const res = await approveAndSend(approval);
    expect(res).toMatchObject({ ok: false, status: 409, code: "not_pending" });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("window closed at approval time -> EXPIRED with a clear message, nothing sent", async () => {
    mockPrisma.draftReply.findFirst.mockResolvedValue(draft({ contact: contact({ lastInboundAt: hoursAgo(24) }) }));
    const res = await approveAndSend(approval);
    expect(res).toMatchObject({ ok: false, code: "window_closed" });
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockPrisma.draftReply.update).toHaveBeenCalledWith({
      where: { id: "d_1" },
      data: { status: "EXPIRED", error: expect.stringMatching(/24-hour window closed at .* The person needs to message again/) },
    });
  });

  it("Meta's closed-window error -> EXPIRED; an unknown Meta error -> FAILED 'maybe sent', never retried", async () => {
    mockSend.mockRejectedValueOnce(Object.assign(new Error("(#10) This message is sent outside of allowed window."), { code: 10 }));
    expect(await approveAndSend(approval)).toMatchObject({ ok: false, code: "window_closed" });

    mockSend.mockRejectedValueOnce(new Error("An unexpected error has occurred. Please retry your request later."));
    expect(await approveAndSend(approval)).toMatchObject({ ok: false, code: "maybe_sent" });
    expect(mockPrisma.draftReply.update).toHaveBeenLastCalledWith({
      where: { id: "d_1" },
      data: expect.objectContaining({ status: "FAILED" }),
    });
  });

  it("rejecting only touches PENDING drafts", async () => {
    await rejectDraft({ workspaceId: "ws", id: "d_1", by: "u" });
    expect(mockPrisma.draftReply.updateMany).toHaveBeenCalledWith({
      where: { id: "d_1", workspaceId: "ws", status: "PENDING" },
      data: expect.objectContaining({ status: "REJECTED" }),
    });
  });
});

describe("POST /api/drafts/[id]/approve: who may approve", () => {
  it("401 without login", async () => {
    mockContext.mockResolvedValue(null);
    const res = await approveRoute.POST(req("/api/drafts/d_1/approve", {}), params());
    expect(res.status).toBe(401);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("the owner's session approves and is recorded as the approver", async () => {
    const res = await approveRoute.POST(req("/api/drafts/d_1/approve", {}), params());
    expect(res.status).toBe(200);
    expect(mockPrisma.draftReply.updateMany.mock.calls[0][0].data).toMatchObject({
      approvedBy: "u_matheus",
      approvedVia: "session",
    });
  });

  it("an API key without the drafts:approve scope gets 403 and nothing is sent (the vendedor's key)", async () => {
    mockCaller.mockResolvedValue({ kind: "token", tokenId: "tok_vendedor", scopes: [] });
    const res = await approveRoute.POST(
      req("/api/drafts/d_1/approve", { aprovadoPor: "Matheus", confirmar: true }),
      params()
    );
    expect(res.status).toBe(403);
    expect(mockPrisma.draftReply.updateMany).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("an API key with the scope still needs aprovadoPor, confirmar: true and the approved text", async () => {
    mockCaller.mockResolvedValue({ kind: "token", tokenId: "tok_bot", scopes: ["drafts:approve"] });
    for (const body of [
      {},
      { aprovadoPor: "Matheus" },
      { confirmar: true },
      { aprovadoPor: " ", confirmar: true },
      { aprovadoPor: "Matheus via Telegram", confirmar: true },
    ]) {
      const res = await approveRoute.POST(req("/api/drafts/d_1/approve", body), params());
      expect([400]).toContain(res.status);
    }
    expect(mockSend).not.toHaveBeenCalled();

    const ok = await approveRoute.POST(
      req("/api/drafts/d_1/approve", {
        aprovadoPor: "Matheus via Telegram",
        confirmar: true,
        textoAprovado: "Oi! Te mando o link agora",
      }),
      params()
    );
    expect(ok.status).toBe(200);
    expect(mockPrisma.draftReply.updateMany.mock.calls[0][0].data).toMatchObject({
      approvedBy: "Matheus via Telegram",
      approvedVia: "mcp",
      approvedTokenId: "tok_bot",
    });
  });
});

describe("the AI can never send a DM directly", () => {
  it("POST /api/drafts from an API key is always origin 'vendedor' and answers sent: false", async () => {
    mockCaller.mockResolvedValue({ kind: "token", tokenId: "tok_vendedor", scopes: [] });
    const res = await draftsRoute.POST(req("/api/drafts", { contactId: "ct_1", text: "oi", origin: "manual" }));
    expect(res.status).toBe(201);
    expect((await res.json()).data.sent).toBe(false);
    expect(mockPrisma.draftReply.create.mock.calls[0][0].data.origin).toBe("vendedor");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("POST /api/instagram/conversations refuses API keys (the old enviar_dm hole)", async () => {
    mockCaller.mockResolvedValue({ kind: "token", tokenId: "tok_vendedor", scopes: [] });
    const res = await conversationsRoute.POST(req("/api/instagram/conversations", { recipientId: "ig_person", text: "oi" }));
    expect(res.status).toBe(403);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("MCP has no enviar_dm; propor_resposta only creates a draft", async () => {
    const names = TOOLS.map((t) => t.name);
    expect(names).not.toContain("enviar_dm");
    expect(names).toEqual(expect.arrayContaining(["listar_dms_sem_resposta", "propor_resposta", "listar_rascunhos", "aprovar_rascunho"]));

    const call = vi.fn<InternalCall>(async () => ({ status: 201, json: { success: true, data: { id: "d_1" } } }));
    const res = await handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "propor_resposta", arguments: { contactId: "ct_1", texto: "oi", motivo: "pediu o link" } },
      },
      call
    );
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith("POST", "/api/drafts", expect.objectContaining({ contactId: "ct_1", text: "oi" }));
    expect(JSON.stringify(res)).toMatch(/NADA foi enviado/);
  });

  it("aprovar_rascunho without aprovadoPor or confirmar: true never calls the API", async () => {
    const call = vi.fn<InternalCall>(async () => ({ status: 200, json: { success: true, data: {} } }));
    for (const args of [{ id: "d_1" }, { id: "d_1", aprovadoPor: "Matheus" }, { id: "d_1", confirmar: true }, { id: "d_1", aprovadoPor: "", confirmar: true }]) {
      const res = await handleMcpMessage(
        { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "aprovar_rascunho", arguments: args } },
        call
      );
      expect(res?.result).toMatchObject({ isError: true });
    }
    expect(call).not.toHaveBeenCalled();

    await handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "aprovar_rascunho",
          arguments: { id: "d_1", aprovadoPor: "Matheus via Telegram", confirmar: true, textoAprovado: "Oi!" },
        },
      },
      call
    );
    expect(call).toHaveBeenCalledWith("POST", "/api/drafts/d_1/approve", {
      aprovadoPor: "Matheus via Telegram",
      confirmar: true,
      textoAprovado: "Oi!",
    });
  });

  it("initialize tells the agent that AI DMs need human approval", async () => {
    const res = await handleMcpMessage({ jsonrpc: "2.0", id: 9, method: "initialize" }, vi.fn<InternalCall>());
    expect((res?.result as { instructions: string }).instructions).toMatch(/nunca sai sem aprovação humana/);
  });
});
