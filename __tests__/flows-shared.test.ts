/**
 * Etapa 3: as peças compartilhadas que os fluxos tocam.
 *  - startTakeover para os runs abertos da pessoa (e um erro dos fluxos não
 *    desfaz o takeover);
 *  - createDraft com origin "flow" respeita takeover (igual ao vendedor);
 *  - /r/<slug> de link de fluxo registra o clique e redireciona, e um link de
 *    campanha nunca consulta a tabela de fluxos;
 *  - sendFlowMessage monta botões mistos (link + postback) e a imagem;
 *  - o balde por hora dos fluxos é separado do das respostas privadas.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  prisma: {
    contact: { findUnique: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
    contactEvent: { createMany: vi.fn() },
    sequenceEnrollment: { updateMany: vi.fn() },
    flowRun: { updateMany: vi.fn(), findFirst: vi.fn() },
    draftReply: { create: vi.fn() },
    trackedLink: { findUnique: vi.fn() },
    linkClick: { create: vi.fn() },
    flowLink: { findUnique: vi.fn() },
    flowLinkClick: { create: vi.fn() },
    flowStep: { create: vi.fn() },
  },
  evalMock: vi.fn(),
  track: vi.fn(),
}));
vi.mock("@/lib/db/client", () => ({ prisma: h.prisma }));
vi.mock("ioredis", () => {
  const MockRedis = vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.eval = h.evalMock;
    return this;
  });
  return { default: MockRedis };
});
vi.stubEnv("REDIS_URL", "redis://localhost:6379");

import { startTakeover } from "../lib/messaging/takeover";
import { createDraft } from "../lib/drafts/drafts";
import { GET as redirect } from "../app/r/[slug]/route";
import { sendFlowMessage, sendImageMessage } from "../lib/meta/client";
import { reserveDMSlot, reserveFlowSlot } from "../lib/utils/rate-limiter";
import { recipientToken } from "../lib/tracking/recipient";

beforeEach(() => {
  vi.clearAllMocks();
  h.prisma.contact.update.mockResolvedValue({});
  h.prisma.contactEvent.createMany.mockResolvedValue({ count: 1 });
  h.prisma.sequenceEnrollment.updateMany.mockResolvedValue({ count: 0 });
  h.prisma.flowRun.updateMany.mockResolvedValue({ count: 1 });
});
afterEach(() => vi.unstubAllGlobals());

describe("takeover stops flows", () => {
  const contact = { id: "ct_1", workspaceId: "ws_1", humanTakeover: false, humanTakeoverUntil: null, instagramAccount: { takeoverHours: 24 } };

  it("stops the person's open runs", async () => {
    h.prisma.contact.findUnique.mockResolvedValue(contact);
    expect(await startTakeover({ contactId: "ct_1", by: "u_1", reason: "inbox_send" })).not.toBeNull();
    expect(h.prisma.flowRun.updateMany).toHaveBeenCalledWith({
      where: { contactId: "ct_1", status: { in: ["ACTIVE", "WAITING_DELAY", "WAITING_REPLY", "WAITING_TAP"] } },
      data: expect.objectContaining({ status: "STOPPED_TAKEOVER", stopReason: "takeover" }),
    });
  });

  it("a flow error never undoes the takeover", async () => {
    h.prisma.contact.findUnique.mockResolvedValue(contact);
    h.prisma.flowRun.updateMany.mockRejectedValue(new Error("flows down"));
    expect(await startTakeover({ contactId: "ct_1", by: "u_1", reason: "flow" })).toMatchObject({ until: expect.any(Date) });
    expect(h.prisma.contact.update).toHaveBeenCalled();
  });
});

describe("drafts proposed by a flow", () => {
  it("are blocked by a human takeover like the vendedor's", async () => {
    h.prisma.contact.findFirst.mockResolvedValue({
      id: "ct_1",
      instagramAccountId: "acc_1",
      lastInboundAt: new Date(),
      humanTakeover: true,
      humanTakeoverUntil: new Date(Date.now() + 3_600_000),
    });
    const result = await createDraft({ workspaceId: "ws_1", contactId: "ct_1", text: "oi", origin: "flow" });
    expect(result).toMatchObject({ ok: false, code: "takeover" });
    expect(h.prisma.draftReply.create).not.toHaveBeenCalled();
  });
});

describe("/r/<slug> for flow links", () => {
  const call = (slug: string, query = "") =>
    redirect(new Request(`https://le.app/r/${slug}${query}`, { headers: { "user-agent": "vitest" } }) as Parameters<typeof redirect>[0], {
      params: Promise.resolve({ slug }),
    });

  it("records the click on the flow (credited to the run) and redirects", async () => {
    h.prisma.trackedLink.findUnique.mockResolvedValue(null);
    h.prisma.flowLink.findUnique.mockResolvedValue({
      id: "fl_1",
      flowId: "f_1",
      nodeId: "m2",
      destinationUrl: "https://example.com/oferta",
      flow: { name: "Fluxo", instagramAccountId: "acc_1", instagramAccount: { id: "acc_1", workspaceId: "ws_1", instagramId: "ig_1" } },
    });
    h.prisma.flowRun.findFirst.mockResolvedValue({ id: "r_1" });
    h.prisma.flowLinkClick.create.mockResolvedValue({ id: "clk_1", createdAt: new Date() });
    h.prisma.flowStep.create.mockResolvedValue({});
    const res = await call("abc", `?c=${encodeURIComponent(recipientToken("abc", "u_1"))}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://example.com/oferta");
    expect(h.prisma.flowLinkClick.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ flowLinkId: "fl_1", nodeId: "m2", runId: "r_1", contactIgUserId: "u_1" }) })
    );
    expect(h.prisma.linkClick.create).not.toHaveBeenCalled();
  });

  it("a campaign link never looks at the flow tables", async () => {
    h.prisma.trackedLink.findUnique.mockResolvedValue({
      id: "tl_1",
      workspaceId: "ws_1",
      automationId: "auto_1",
      destinationUrl: "https://example.com/campanha",
      automation: { instagramAccountId: "acc_1" },
    });
    h.prisma.linkClick.create.mockResolvedValue({});
    const res = await call("xyz");
    expect(res.headers.get("location")).toBe("https://example.com/campanha");
    expect(h.prisma.flowLink.findUnique).not.toHaveBeenCalled();
  });

  it("an unknown slug still goes home", async () => {
    h.prisma.trackedLink.findUnique.mockResolvedValue(null);
    h.prisma.flowLink.findUnique.mockResolvedValue(null);
    const res = await call("nada");
    expect(new URL(res.headers.get("location") ?? "").pathname).toBe("/");
  });
});

describe("Meta send helpers for flows", () => {
  function okFetch() {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ message_id: "m_1", recipient_id: "u_1" }) }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }
  const body = (fetchMock: ReturnType<typeof okFetch>) => JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);

  it("mixed buttons (web_url + postback) as a button template, to a comment or a person", async () => {
    const fetchMock = okFetch();
    await sendFlowMessage("tok", "ig_1", { comment_id: "c_1" }, "Oi", [
      { kind: "link", title: "Abrir o site agora mesmo", url: "https://x.com" },
      { kind: "postback", title: "Quero", payload: "flow:r_1:m2" },
    ]);
    const sent = body(fetchMock);
    expect(sent.recipient).toEqual({ comment_id: "c_1" });
    expect(sent.message.attachment.payload).toEqual({
      template_type: "button",
      text: "Oi",
      buttons: [
        { type: "web_url", url: "https://x.com", title: "Abrir o site agora m" },
        { type: "postback", title: "Quero", payload: "flow:r_1:m2" },
      ],
    });
  });

  it("plain text without buttons, and an image by URL", async () => {
    let fetchMock = okFetch();
    await sendFlowMessage("tok", "ig_1", { id: "u_1" }, "Só texto", []);
    expect(body(fetchMock).message).toEqual({ text: "Só texto" });
    fetchMock = okFetch();
    await sendImageMessage("tok", "ig_1", "u_1", "https://x.com/a.png");
    expect(body(fetchMock).message).toEqual({ attachment: { type: "image", payload: { url: "https://x.com/a.png" } } });
  });
});

describe("hourly buckets", () => {
  it("flow DMs use their own bucket; private replies keep Meta's", async () => {
    h.evalMock.mockResolvedValue([1, 1, 199]);
    await reserveFlowSlot("ig_1");
    await reserveDMSlot("ig_1");
    expect(h.evalMock.mock.calls[0][2]).toBe("rate:flow:ig_1");
    expect(h.evalMock.mock.calls[0][3]).toBe(200);
    expect(h.evalMock.mock.calls[1][2]).toBe("rate:dm:ig_1");
    h.evalMock.mockResolvedValue([0, 200, 0]);
    expect(await reserveFlowSlot("ig_1")).toEqual({ allowed: false, currentCount: 200 });
  });
});
