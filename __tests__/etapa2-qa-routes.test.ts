/**
 * QA da Etapa 2 (rotas): toda rota nova responde 401 sem login, toda leitura
 * e escrita fica no workspace de quem chama, aprovar exige o texto que o
 * humano viu (a IA não troca o texto depois que o Matheus olhou), e o CRM da
 * DM não se perde quando a fila cai.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHmac } from "crypto";

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
  const prisma = new Proxy({} as Record<string, unknown>, {
    get(_t, name: string) {
      if (name === "$transaction") return vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma));
      if (name === "$executeRaw") return vi.fn(async () => 1);
      return model(name);
    },
  });
  return {
    prisma: prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>,
    models,
    mockContext: vi.fn(),
    mockCaller: vi.fn(),
    mockSend: vi.fn(),
    mockAdd: vi.fn(),
    mockCrm: vi.fn(),
  };
});

vi.mock("@/lib/db/client", () => ({ prisma: h.prisma }));
vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext: h.mockContext,
  canManageWorkspace: (role: string) => role === "OWNER" || role === "ADMIN",
}));
vi.mock("@/lib/auth", () => ({
  getApiCaller: h.mockCaller,
  isApiTokenRequest: vi.fn(async () => false),
  getCurrentWorkspaceId: vi.fn(async () => (h.mockContext.getMockImplementation() ? "ws_A" : null)),
}));
vi.mock("@/lib/meta/client", () => ({
  sendDirectMessage: h.mockSend,
  getConversations: vi.fn(),
  getConversationMessages: vi.fn(),
  MetaApiError: class MetaApiError extends Error {
    code = 0;
  },
}));
vi.mock("@/lib/meta/send", () => ({
  sendTracked: vi.fn(async (_c: unknown, send: (o: unknown) => Promise<unknown>) => send({ metadata: "le:draft:r" })),
}));
vi.mock("@/lib/meta/oauth", () => ({ decryptToken: (t: string) => `plain:${t}` }));
vi.mock("@/lib/queue/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/queue/client")>();
  return { ...real, getDMQueue: () => ({ add: h.mockAdd }) };
});
vi.mock("@/lib/messaging/crm-dm", () => ({ handleCrmDm: h.mockCrm }));
vi.mock("@/lib/messages/store", () => ({ storeParsedDirectMessages: vi.fn(async () => []) }));

import * as draftsRoute from "../app/api/drafts/route";
import * as draftRoute from "../app/api/drafts/[id]/route";
import * as approveRoute from "../app/api/drafts/[id]/approve/route";
import * as rejectRoute from "../app/api/drafts/[id]/reject/route";
import * as unansweredRoute from "../app/api/inbox/unanswered/route";
import * as takeoverRoute from "../app/api/contacts/[id]/takeover/route";
import * as contactRoute from "../app/api/contacts/[id]/route";
import * as sequenceRoute from "../app/api/automations/[id]/sequence/route";
import * as linksRoute from "../app/api/conversation-links/route";
import * as linkRoute from "../app/api/conversation-links/[id]/route";
import * as moderationSettingsRoute from "../app/api/moderation/settings/route";
import * as conversationsRoute from "../app/api/instagram/conversations/route";
import * as sweepRoute from "../app/api/cron/messaging-sweep/route";
import * as webhookRoute from "../app/api/webhook/route";

const CTX_A = { userId: "u_A", workspaceId: "ws_A", workspace: { id: "ws_A" }, role: "OWNER" };
const now = Date.now();

function req(path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(new URL(path, "http://localhost"), {
    method,
    headers: { "content-type": "application/json", ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
const params = (id = "x") => ({ params: Promise.resolve({ id }) });

function resetModels() {
  for (const m of h.models.values()) {
    for (const key of Object.keys(m)) delete m[key];
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  resetModels();
  h.mockContext.mockReset();
  h.mockContext.mockResolvedValue(null);
  h.mockCaller.mockResolvedValue({ kind: "session" });
});

describe("401 without login on every Etapa 2 route", () => {
  const cases: [string, () => Promise<Response>][] = [
    ["GET /api/drafts", () => draftsRoute.GET(req("/api/drafts"))],
    ["POST /api/drafts", () => draftsRoute.POST(req("/api/drafts", "POST", { contactId: "c", text: "oi" }))],
    ["GET /api/drafts/[id]", () => draftRoute.GET(req("/api/drafts/d"), params("d"))],
    ["PATCH /api/drafts/[id]", () => draftRoute.PATCH(req("/api/drafts/d", "PATCH", { text: "x" }), params("d"))],
    [
      "POST /api/drafts/[id]/approve",
      () => approveRoute.POST(req("/api/drafts/d/approve", "POST", { aprovadoPor: "x", confirmar: true }), params("d")),
    ],
    ["POST /api/drafts/[id]/reject", () => rejectRoute.POST(req("/api/drafts/d/reject", "POST", {}), params("d"))],
    ["GET /api/inbox/unanswered", () => unansweredRoute.GET(req("/api/inbox/unanswered"))],
    ["POST /api/contacts/[id]/takeover", () => takeoverRoute.POST(req("/api/contacts/c/takeover", "POST", { on: true }), params("c"))],
    ["GET /api/contacts/[id]", () => contactRoute.GET(req("/api/contacts/c"), params("c"))],
    ["GET /api/automations/[id]/sequence", () => sequenceRoute.GET(req("/api/automations/a/sequence"), params("a"))],
    ["PUT /api/automations/[id]/sequence", () => sequenceRoute.PUT(req("/api/automations/a/sequence", "PUT", { isActive: true }), params("a"))],
    ["GET /api/conversation-links", () => linksRoute.GET(req("/api/conversation-links"))],
    ["POST /api/conversation-links", () => linksRoute.POST(req("/api/conversation-links", "POST", { origin: "story" }))],
    ["PATCH /api/conversation-links/[id]", () => linkRoute.PATCH(req("/api/conversation-links/l", "PATCH", { isActive: false }), params("l"))],
    ["DELETE /api/conversation-links/[id]", () => linkRoute.DELETE(req("/api/conversation-links/l", "DELETE"), params("l"))],
    ["PATCH /api/moderation/settings", () => moderationSettingsRoute.PATCH(req("/api/moderation/settings", "PATCH", { maxHidesPerHour: 10 }))],
    ["POST /api/instagram/conversations", () => conversationsRoute.POST(req("/api/instagram/conversations", "POST", { recipientId: "p", text: "oi" }))],
  ];

  it.each(cases)("%s -> 401 and touches nothing", async (_name, run) => {
    const res = await run();
    expect(res.status).toBe(401);
    expect(h.mockSend).not.toHaveBeenCalled();
    // No write of any kind happened.
    for (const m of h.models.values()) {
      for (const method of ["create", "update", "updateMany", "upsert", "delete", "deleteMany", "createMany"]) {
        if (m[method]) expect(m[method]).not.toHaveBeenCalled();
      }
    }
  });

  it("the messaging sweep cron needs its secret", async () => {
    vi.stubEnv("CRON_SECRET", "s3cr3t-cron");
    expect((await sweepRoute.GET(req("/api/cron/messaging-sweep"))).status).toBe(401);
    expect(
      (await sweepRoute.GET(req("/api/cron/messaging-sweep", "GET", undefined, { authorization: "Bearer nope" }))).status
    ).toBe(401);
    vi.unstubAllEnvs();
  });

  it("a MEMBER cannot change sequences, links or the hide ceiling (403)", async () => {
    h.mockContext.mockResolvedValue({ ...CTX_A, role: "MEMBER" });
    expect((await sequenceRoute.PUT(req("/api/automations/a/sequence", "PUT", { isActive: true }), params("a"))).status).toBe(403);
    expect((await linksRoute.POST(req("/api/conversation-links", "POST", { origin: "story" }))).status).toBe(403);
    expect((await linkRoute.DELETE(req("/api/conversation-links/l", "DELETE"), params("l"))).status).toBe(403);
    expect((await moderationSettingsRoute.PATCH(req("/api/moderation/settings", "PATCH", { maxHidesPerHour: 10 }))).status).toBe(403);
  });
});

describe("workspace scope: workspace A never reads or changes workspace B", () => {
  beforeEach(() => {
    h.mockContext.mockResolvedValue(CTX_A);
  });

  const scopedTo = (fn: ReturnType<typeof vi.fn>) =>
    fn.mock.calls.every((c) => JSON.stringify(c[0]?.where ?? {}).includes('"workspaceId":"ws_A"'));

  it("a draft of another workspace is 404 to read, edit, approve and discard, and nothing is sent", async () => {
    // findFirst scoped by workspaceId finds nothing (the row belongs to ws_B).
    h.prisma.draftReply.updateMany.mockResolvedValue({ count: 0 });
    expect((await draftRoute.GET(req("/api/drafts/d_B"), params("d_B"))).status).toBe(404);
    expect((await draftRoute.PATCH(req("/api/drafts/d_B", "PATCH", { text: "x" }), params("d_B"))).status).toBe(404);
    expect((await approveRoute.POST(req("/api/drafts/d_B/approve", "POST", {}), params("d_B"))).status).toBe(404);
    expect((await rejectRoute.POST(req("/api/drafts/d_B/reject", "POST", {}), params("d_B"))).status).toBe(404);
    expect(h.mockSend).not.toHaveBeenCalled();
    expect(scopedTo(h.prisma.draftReply.findFirst)).toBe(true);
    expect(scopedTo(h.prisma.draftReply.updateMany)).toBe(true);
  });

  it("drafts list, unanswered DMs and links are filtered by the caller's workspace", async () => {
    h.prisma.draftReply.findMany.mockResolvedValue([]);
    h.prisma.draftReply.count.mockResolvedValue(0);
    h.prisma.contact.findMany.mockResolvedValue([]);
    h.prisma.conversationLink.findMany.mockResolvedValue([]);
    expect((await draftsRoute.GET(req("/api/drafts?status=all"))).status).toBe(200);
    expect((await unansweredRoute.GET(req("/api/inbox/unanswered"))).status).toBe(200);
    expect((await linksRoute.GET(req("/api/conversation-links"))).status).toBe(200);
    expect(scopedTo(h.prisma.draftReply.findMany)).toBe(true);
    expect(scopedTo(h.prisma.draftReply.count)).toBe(true);
    expect(scopedTo(h.prisma.contact.findMany)).toBe(true);
    expect(scopedTo(h.prisma.conversationLink.findMany)).toBe(true);
  });

  it("proposing for, or taking over, a contact of another workspace is 404", async () => {
    const res = await draftsRoute.POST(req("/api/drafts", "POST", { contactId: "ct_B", text: "oi" }));
    expect(res.status).toBe(404);
    expect(h.prisma.draftReply.create).not.toHaveBeenCalled();
    const t = await takeoverRoute.POST(req("/api/contacts/ct_B/takeover", "POST", { on: true }), params("ct_B"));
    expect(t.status).toBe(404);
    expect(h.prisma.contact.update).not.toHaveBeenCalled();
    expect(scopedTo(h.prisma.contact.findFirst)).toBe(true);
  });

  it("a sequence or a link can only point at a campaign of the caller's workspace", async () => {
    expect((await sequenceRoute.PUT(req("/api/automations/a_B/sequence", "PUT", { isActive: true }), params("a_B"))).status).toBe(404);
    expect(scopedTo(h.prisma.automation.findFirst)).toBe(true);
    h.prisma.conversationLink.findFirst.mockResolvedValue({ id: "l_A", instagramAccountId: "acc_A" });
    const res = await linkRoute.PATCH(req("/api/conversation-links/l_A", "PATCH", { automationId: "a_B" }), params("l_A"));
    expect(res.status).toBe(404);
    expect(h.prisma.conversationLink.update).not.toHaveBeenCalled();
    expect(h.prisma.automation.findFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { id: "a_B", workspaceId: "ws_A", instagramAccountId: "acc_A" } })
    );
  });

  it("deleting a link of another workspace deletes nothing", async () => {
    h.prisma.conversationLink.deleteMany.mockResolvedValue({ count: 0 });
    const res = await linkRoute.DELETE(req("/api/conversation-links/l_B", "DELETE"), params("l_B"));
    expect(res.status).toBe(404);
    expect(h.prisma.conversationLink.deleteMany).toHaveBeenCalledWith({ where: { id: "l_B", workspaceId: "ws_A" } });
  });
});

describe("approve sends exactly what the human saw", () => {
  const pending = (text: string) => ({
    id: "d_1",
    workspaceId: "ws_A",
    instagramAccountId: "acc_A",
    text,
    origin: "vendedor",
    status: "PENDING",
    contact: { id: "ct_1", workspaceId: "ws_A", igUserId: "ig_p", lastInboundAt: new Date(now - 3_600_000) },
    instagramAccount: { id: "acc_A", instagramId: "ig_owner", accessToken: "enc" },
  });

  beforeEach(() => {
    h.mockContext.mockResolvedValue(CTX_A);
    h.mockSend.mockResolvedValue({ message_id: "mid_ok" });
  });

  it("the AI edited the draft after the owner opened it: 409 'changed', nothing sent, still PENDING", async () => {
    h.prisma.draftReply.findFirst.mockResolvedValue(pending("Texto NOVO que a IA trocou"));
    const res = await approveRoute.POST(
      req("/api/drafts/d_1/approve", "POST", { expectedText: "Texto que o Matheus viu" }),
      params("d_1")
    );
    expect(res.status).toBe(409);
    expect((await res.json()).details.code).toBe("changed");
    expect(h.mockSend).not.toHaveBeenCalled();
    expect(h.prisma.draftReply.updateMany).not.toHaveBeenCalled();
  });

  it("an edit that lands between the read and the claim makes the claim miss: nothing sent", async () => {
    h.prisma.draftReply.findFirst.mockResolvedValue(pending("oi"));
    h.prisma.draftReply.updateMany.mockResolvedValue({ count: 0 });
    h.prisma.draftReply.findUnique.mockResolvedValue({ status: "PENDING" });
    const res = await approveRoute.POST(req("/api/drafts/d_1/approve", "POST", { expectedText: "oi" }), params("d_1"));
    expect(res.status).toBe(409);
    expect((await res.json()).details.code).toBe("changed");
    expect(h.prisma.draftReply.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "d_1", status: "PENDING", text: "oi" } })
    );
    expect(h.mockSend).not.toHaveBeenCalled();
  });

  it("same text (spacing aside) approves and sends it", async () => {
    h.prisma.draftReply.findFirst.mockResolvedValue(pending("Oi! Te mando o link"));
    h.prisma.draftReply.updateMany.mockResolvedValue({ count: 1 });
    const res = await approveRoute.POST(
      req("/api/drafts/d_1/approve", "POST", { expectedText: "  Oi! Te mando o link \n" }),
      params("d_1")
    );
    expect(res.status).toBe(200);
    expect(h.mockSend).toHaveBeenCalledWith("plain:enc", "ig_owner", "ig_p", "Oi! Te mando o link", { metadata: "le:draft:r" });
  });

  it("the Telegram key (drafts:approve) must say which text the owner approved", async () => {
    h.mockCaller.mockResolvedValue({ kind: "token", tokenId: "tok_bot", scopes: ["drafts:approve"] });
    h.prisma.draftReply.findFirst.mockResolvedValue(pending("oi"));
    const missing = await approveRoute.POST(
      req("/api/drafts/d_1/approve", "POST", { aprovadoPor: "Matheus via Telegram", confirmar: true }),
      params("d_1")
    );
    expect(missing.status).toBe(400);
    expect((await missing.json()).details.code).toBe("approval_required");
    expect(h.mockSend).not.toHaveBeenCalled();
  });
});

describe("webhook: the DM CRM is never lost", () => {
  const SECRET = "test_app_secret_12345";
  function signed(payload: unknown) {
    const body = JSON.stringify(payload);
    const sig = "sha256=" + createHmac("sha256", SECRET).update(body).digest("hex");
    return new NextRequest(new URL("/api/webhook", "http://localhost"), {
      method: "POST",
      body,
      headers: { "content-type": "application/json", "x-hub-signature-256": sig },
    });
  }
  const echoPayload = {
    object: "instagram",
    entry: [
      {
        id: "ig_owner",
        time: 1,
        messaging: [
          {
            sender: { id: "ig_owner" },
            recipient: { id: "ig_person" },
            timestamp: 1_700_000_000_000,
            message: { mid: "mid_echo_1", text: "digitei no celular", is_echo: true },
          },
        ],
      },
    ],
  };

  beforeEach(() => {
    vi.stubEnv("FACEBOOK_APP_SECRET", SECRET);
    h.prisma.webhookEvent.create.mockResolvedValue({ id: "we_1" });
    h.prisma.dmLog.findMany.mockResolvedValue([]);
  });

  it("queue up: CRM_DM_JOB is queued, nothing runs inline", async () => {
    h.mockAdd.mockResolvedValue({});
    const res = await webhookRoute.POST(signed(echoPayload));
    expect(res.status).toBe(200);
    expect(h.mockAdd).toHaveBeenCalledWith("crm-dm", expect.objectContaining({ mid: "mid_echo_1", fromMe: true }), expect.anything());
    expect(h.mockCrm).not.toHaveBeenCalled();
  });

  it("queue down: the CRM runs inline (echo -> takeover still happens) and Meta gets 200", async () => {
    h.mockAdd.mockRejectedValue(new Error("ECONNREFUSED redis"));
    h.mockCrm.mockResolvedValue("takeover");
    const res = await webhookRoute.POST(signed(echoPayload));
    expect(res.status).toBe(200);
    expect(h.mockCrm).toHaveBeenCalledWith(
      expect.objectContaining({ mid: "mid_echo_1", fromMe: true, igUserId: "ig_person", instagramAccountId: "ig_owner" }),
      { inline: true }
    );
  });

  it("a link opened by a typed message: the keyword job and a delayed referral job (one answer per message)", async () => {
    h.mockAdd.mockResolvedValue({});
    const res = await webhookRoute.POST(
      signed({
        object: "instagram",
        entry: [
          {
            id: "ig_owner",
            time: 1,
            messaging: [
              {
                sender: { id: "ig_person" },
                recipient: { id: "ig_owner" },
                timestamp: 1_700_000_000_000,
                message: { mid: "mid_ref_1", text: "oi", referral: { ref: "story1", source: "SHORTLINKS", type: "OPEN_THREAD" } },
              },
            ],
          },
        ],
      })
    );
    expect(res.status).toBe(200);
    expect(h.mockAdd).toHaveBeenCalledWith("process-message", expect.objectContaining({ messageId: "mid_ref_1" }), expect.anything());
    expect(h.mockAdd).toHaveBeenCalledWith(
      "process-referral",
      expect.objectContaining({ ref: "story1", kind: "message", mid: "mid_ref_1" }),
      expect.objectContaining({ delay: 5_000 })
    );
  });

  it("queue down and inline failed too: 500, so Meta delivers the payload again", async () => {
    h.mockAdd.mockRejectedValue(new Error("ECONNREFUSED redis"));
    h.mockCrm.mockRejectedValue(new Error("db down"));
    const res = await webhookRoute.POST(signed(echoPayload));
    expect(res.status).toBe(500);
    expect(h.prisma.webhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) })
    );
  });
});

describe("takeover turns on when the owner answers from the Lead Engine Direct", () => {
  beforeEach(() => {
    h.mockContext.mockResolvedValue(CTX_A);
    h.mockSend.mockResolvedValue({ recipient_id: "ig_p", message_id: "mid_manual" });
    h.prisma.instagramAccount.findFirst.mockResolvedValue({ id: "acc_A", instagramId: "ig_owner", accessToken: "enc", workspaceId: "ws_A" });
    h.prisma.contact.upsert.mockResolvedValue({ id: "ct_1", workspaceId: "ws_A", firstSeenAt: new Date(now), lastSeenAt: new Date(now + 60_000) });
    h.prisma.contact.findUnique.mockResolvedValue({
      id: "ct_1",
      workspaceId: "ws_A",
      humanTakeover: false,
      humanTakeoverUntil: null,
      instagramAccount: { takeoverHours: 24 },
    });
    h.prisma.contactEvent.createMany.mockResolvedValue({ count: 1 });
    h.prisma.sequenceEnrollment.updateMany.mockResolvedValue({ count: 0 });
  });

  it("a manual send turns takeover on for 24 h (by the user) and returns takeoverUntil", async () => {
    const res = await conversationsRoute.POST(
      req("/api/instagram/conversations", "POST", { recipientId: "ig_p", text: "oi, aqui é o Matheus" })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(h.mockSend).toHaveBeenCalledWith("plain:enc", "ig_owner", "ig_p", "oi, aqui é o Matheus", { metadata: "le:draft:r" });
    const update = h.prisma.contact.update.mock.calls.find((c) => c[0].data.humanTakeover === true)?.[0];
    expect(update?.data).toMatchObject({ humanTakeover: true, humanTakeoverBy: "u_A", humanTakeoverReason: "inbox_send" });
    const hours = (new Date(body.data.takeoverUntil).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(23.9);
    expect(hours).toBeLessThanOrEqual(24);
  });

  it("an API key can never send from the Direct (the AI only proposes)", async () => {
    h.mockCaller.mockResolvedValue({ kind: "token", tokenId: "tok_vendedor", scopes: ["drafts:approve"] });
    const res = await conversationsRoute.POST(req("/api/instagram/conversations", "POST", { recipientId: "ig_p", text: "oi" }));
    expect(res.status).toBe(403);
    expect(h.mockSend).not.toHaveBeenCalled();
  });

  it("the button gives it back: takeover off", async () => {
    h.prisma.contact.findFirst.mockResolvedValue({ id: "ct_1" });
    h.prisma.contact.findUnique.mockResolvedValue({ id: "ct_1", workspaceId: "ws_A", humanTakeover: true, humanTakeoverUntil: new Date(now + 3_600_000) });
    h.prisma.contact.updateMany.mockResolvedValue({ count: 1 });
    const res = await takeoverRoute.POST(req("/api/contacts/ct_1/takeover", "POST", { on: false }), params("ct_1"));
    expect(res.status).toBe(200);
    expect(h.prisma.contact.updateMany).toHaveBeenCalledWith({
      where: { id: "ct_1", humanTakeover: true },
      data: expect.objectContaining({ humanTakeover: false, humanTakeoverUntil: null }),
    });
  });

  it("the AI's key cannot give the conversation back to the robot (403, nothing changes)", async () => {
    h.mockContext.mockResolvedValue(CTX_A);
    h.mockCaller.mockResolvedValue({ kind: "token", tokenId: "tok_vendedor", scopes: [] });
    h.prisma.contact.findFirst.mockResolvedValue({ id: "ct_1" });
    const res = await takeoverRoute.POST(req("/api/contacts/ct_1/takeover", "POST", { on: false }), params("ct_1"));
    expect(res.status).toBe(403);
    expect(h.prisma.contact.updateMany).not.toHaveBeenCalled();
  });

  it("the Telegram key (drafts:approve) can give it back", async () => {
    h.mockContext.mockResolvedValue(CTX_A);
    h.mockCaller.mockResolvedValue({ kind: "token", tokenId: "tok_tg", scopes: ["drafts:approve"] });
    h.prisma.contact.findFirst.mockResolvedValue({ id: "ct_1" });
    h.prisma.contact.findUnique.mockResolvedValue({ id: "ct_1", workspaceId: "ws_A", humanTakeover: true, humanTakeoverUntil: new Date(now + 3_600_000) });
    h.prisma.contact.updateMany.mockResolvedValue({ count: 1 });
    const res = await takeoverRoute.POST(req("/api/contacts/ct_1/takeover", "POST", { on: false }), params("ct_1"));
    expect(res.status).toBe(200);
  });

  it("an API key cannot write or turn on a sequence (its steps go out automatically)", async () => {
    h.mockContext.mockResolvedValue(CTX_A);
    h.mockCaller.mockResolvedValue({ kind: "token", tokenId: "tok_vendedor", scopes: ["drafts:approve"] });
    h.prisma.automation.findFirst.mockResolvedValue({ id: "a_1", workspaceId: "ws_A" });
    const res = await sequenceRoute.PUT(
      req("/api/automations/a_1/sequence", "PUT", { isActive: true, steps: [{ message: "compra agora", delayMinutes: 10 }] }),
      params("a_1")
    );
    expect(res.status).toBe(403);
    expect(h.prisma.sequence.upsert).not.toHaveBeenCalled();
    expect(h.prisma.sequenceStep.createMany).not.toHaveBeenCalled();
  });
});
