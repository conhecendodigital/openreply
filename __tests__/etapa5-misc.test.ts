/**
 * Etapa 5: as pontas. Toque no botão de disparo que inicia fluxo (só quem
 * recebeu, fluxo tirado da linha e nunca do payload, fluxo desligado não
 * inicia), PARAR/SAIR pela DM (crm-dm) marca opt-out sem mudar mais nada,
 * /r/<slug> de botão de disparo (3º fallback) e a montagem do relatório.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  prisma: {
    broadcastRecipient: { findUnique: vi.fn(), findFirst: vi.fn(), groupBy: vi.fn() },
    flow: { findFirst: vi.fn(), findMany: vi.fn() },
    contact: { updateMany: vi.fn() },
    draftReply: { updateMany: vi.fn() },
    trackedLink: { findUnique: vi.fn() },
    flowLink: { findUnique: vi.fn() },
    broadcastLink: { findUnique: vi.fn() },
    broadcastLinkClick: { create: vi.fn() },
    outboundMessage: { groupBy: vi.fn() },
    dmLog: { groupBy: vi.fn(), count: vi.fn() },
    linkClick: { groupBy: vi.fn() },
    commentModeration: { groupBy: vi.fn() },
    automation: { findMany: vi.fn() },
    broadcast: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
  },
  add: vi.fn(),
  onDirectMessage: vi.fn(),
  addTag: vi.fn(),
  recordEvent: vi.fn(),
  trackInteraction: vi.fn(),
  onPersonReplied: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: h.prisma }));
vi.mock("@/lib/queue/client", () => ({
  getDMQueue: () => ({ add: h.add }),
  CRM_DM_JOB_NAME: "crm-dm",
  safeJobKey: (v: string) => v,
}));
vi.mock("@/lib/contacts/record", () => ({
  AUTO_TAGS: { optedOut: "saiu:disparos", clicked: "clicou" },
  addTag: h.addTag,
  recordEvent: h.recordEvent,
  trackInteraction: h.trackInteraction,
  onDirectMessage: h.onDirectMessage,
  resolveAccountByInstagramId: vi.fn(async () => ({ id: "acc_1", workspaceId: "ws_A", instagramId: "ig_1" })),
}));
vi.mock("@/lib/sequences/engine", () => ({ onPersonReplied: h.onPersonReplied }));
vi.mock("@/lib/messaging/echo", () => ({ classifyEcho: vi.fn(), ECHO_RECHECK_DELAY_MS: 20_000 }));
vi.mock("@/lib/messaging/takeover", () => ({ startTakeover: vi.fn() }));

import { routeBroadcastTap } from "../lib/broadcasts/tap";
import { handleCrmDm } from "../lib/messaging/crm-dm";
import { GET as redirect } from "../app/r/[slug]/route";
import { recipientToken } from "../lib/tracking/recipient";
import { buildPeriodReport, reportCsvRows } from "../lib/reports/period";

const AT = new Date("2026-10-08T15:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  h.add.mockResolvedValue({});
});

describe("broadcast button that starts a flow", () => {
  const recipient = {
    id: "rcp_1",
    igUserId: "u_1",
    broadcast: {
      id: "b_1",
      workspaceId: "ws_A",
      instagramAccountId: "acc_1",
      buttons: [
        { id: "b1", label: "Quero", kind: "flow", flowId: "f_real" },
        { id: "b2", label: "Site", kind: "link", url: "https://x.com" },
      ],
      instagramAccount: { instagramId: "ig_1" },
    },
  };
  const tap = (over: Record<string, unknown> = {}) =>
    routeBroadcastTap({ instagramId: "ig_1", igUserId: "u_1", payload: "bc:rcp_1:b1", at: AT, ...over });

  it("queues flow-start (kind BROADCAST) for the flow of the broadcast row, with the tap as inboundAt", async () => {
    h.prisma.broadcastRecipient.findUnique.mockResolvedValue(recipient);
    h.prisma.flow.findFirst.mockResolvedValue({ id: "f_real" });
    expect(await tap()).toBe("queued");
    expect(h.prisma.flow.findFirst).toHaveBeenCalledWith({
      where: { id: "f_real", workspaceId: "ws_A", instagramAccountId: "acc_1", isActive: true },
      select: { id: true },
    });
    const [name, job, opts] = h.add.mock.calls[0];
    expect(name).toBe("flow-start");
    expect(job).toEqual({
      instagramAccountId: "ig_1",
      flowId: "f_real",
      kind: "BROADCAST",
      triggerKey: "bc:rcp_1:b1",
      triggerRef: "rcp_1",
      igUserId: "u_1",
      inboundAt: AT.getTime(),
    });
    expect(job).not.toHaveProperty("commentId");
    expect(opts).toMatchObject({ attempts: 1 });
  });

  it("someone else tapping (forwarded message) or another account starts nothing", async () => {
    h.prisma.broadcastRecipient.findUnique.mockResolvedValue(recipient);
    expect(await tap({ igUserId: "intruso" })).toBe("not_recipient");
    expect(await tap({ instagramId: "ig_other" })).toBe("not_recipient");
    expect(h.add).not.toHaveBeenCalled();
  });

  it("a link button id or a flow turned off since: nothing starts", async () => {
    h.prisma.broadcastRecipient.findUnique.mockResolvedValue(recipient);
    expect(await tap({ payload: "bc:rcp_1:b2" })).toBe("no_flow");
    h.prisma.flow.findFirst.mockResolvedValue(null);
    expect(await tap()).toBe("flow_off");
    expect(await tap({ payload: "bc:broken" })).toBe("invalid");
    expect(h.add).not.toHaveBeenCalled();
  });
});

describe("PARAR / SAIR by DM (crm-dm)", () => {
  const job = (text: string, fromMe = false) => ({
    instagramAccountId: "ig_1",
    igUserId: "u_1",
    mid: "mid_9",
    fromMe,
    text,
    sentAt: AT.getTime(),
    storyReply: false,
    metadata: null,
    appId: null,
    hasTemplate: false,
  });

  beforeEach(() => {
    h.onDirectMessage.mockResolvedValue({ contact: { id: "ct_1", workspaceId: "ws_A" }, inserted: true });
    h.prisma.contact.updateMany.mockResolvedValue({ count: 1 });
    h.prisma.draftReply.updateMany.mockResolvedValue({ count: 0 });
  });

  it("marks the opt-out, tags saiu:disparos and the rest of the inbound path runs as before", async () => {
    expect(await handleCrmDm(job("Parar") as never)).toBe("inbound");
    expect(h.prisma.contact.updateMany).toHaveBeenCalledWith({
      where: { id: "ct_1", broadcastOptOutAt: null },
      data: { broadcastOptOutAt: AT },
    });
    expect(h.addTag).toHaveBeenCalledWith({ id: "ct_1", workspaceId: "ws_A" }, "saiu:disparos", "auto", AT);
    expect(h.onPersonReplied).toHaveBeenCalledWith({ contactId: "ct_1", instagramId: "ig_1", at: AT });
  });

  it("any other DM, or our own echo, never opts out", async () => {
    expect(await handleCrmDm(job("quero parar de fumar") as never)).toBe("inbound");
    expect(h.prisma.contact.updateMany).not.toHaveBeenCalled();
    expect(h.addTag).not.toHaveBeenCalled();
  });
});

describe("/r/<slug> for a broadcast button", () => {
  it("is the 3rd fallback: records the click for the recipient and redirects", async () => {
    h.prisma.trackedLink.findUnique.mockResolvedValue(null);
    h.prisma.flowLink.findUnique.mockResolvedValue(null);
    h.prisma.broadcastLink.findUnique.mockResolvedValue({
      id: "bl_1",
      broadcastId: "b_1",
      destinationUrl: "https://loja.com/oferta",
      broadcast: { name: "Promo", workspaceId: "ws_A", instagramAccount: { id: "acc_1", workspaceId: "ws_A", instagramId: "ig_1" } },
    });
    h.prisma.broadcastRecipient.findFirst.mockResolvedValue({ id: "rcp_1" });
    h.prisma.broadcastLinkClick.create.mockResolvedValue({ id: "clk_1", createdAt: AT });
    const url = `https://lead.engine/r/bcslug?c=${encodeURIComponent(recipientToken("bcslug", "u_1"))}`;
    const res = await redirect(new Request(url) as never, { params: Promise.resolve({ slug: "bcslug" }) });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://loja.com/oferta");
    expect(h.prisma.broadcastLinkClick.create.mock.calls[0][0].data).toMatchObject({
      broadcastLinkId: "bl_1",
      broadcastId: "b_1",
      recipientId: "rcp_1",
      contactIgUserId: "u_1",
    });
    expect(h.trackInteraction).toHaveBeenCalledWith(
      expect.objectContaining({ igUserId: "u_1", event: expect.objectContaining({ type: "CLICK", refId: "bc:clk_1" }), tags: ["clicou"] })
    );
  });

  it("an unknown slug still goes home", async () => {
    h.prisma.trackedLink.findUnique.mockResolvedValue(null);
    h.prisma.flowLink.findUnique.mockResolvedValue(null);
    h.prisma.broadcastLink.findUnique.mockResolvedValue(null);
    const res = await redirect(new Request("https://lead.engine/r/nope") as never, { params: Promise.resolve({ slug: "nope" }) });
    expect(res.headers.get("location")).toBe("https://lead.engine/");
    expect(h.prisma.broadcastLinkClick.create).not.toHaveBeenCalled();
  });
});

describe("period report", () => {
  beforeEach(() => {
    h.prisma.outboundMessage.groupBy.mockResolvedValue([
      { origin: "automation", _count: { _all: 10 } },
      { origin: "private_reply", _count: { _all: 30 } },
      { origin: "followup", _count: { _all: 2 } },
      { origin: "flow", _count: { _all: 5 } },
      { origin: "broadcast", _count: { _all: 7 } },
      { origin: "inbox", _count: { _all: 4 } },
      { origin: "draft", _count: { _all: 1 } },
    ]);
    h.prisma.dmLog.groupBy.mockResolvedValue([{ automationId: "a_1", _count: { _all: 40 } }]);
    h.prisma.dmLog.count.mockResolvedValue(40);
    h.prisma.linkClick.groupBy.mockResolvedValue([{ automationId: "a_1", _count: { _all: 6 } }]);
    h.prisma.broadcastRecipient.groupBy.mockResolvedValue([{ broadcastId: "b_1", _count: { _all: 7 } }]);
    h.prisma.commentModeration.groupBy.mockResolvedValue([
      { action: "HIDDEN", _count: { _all: 3 } },
      { action: "WOULD_HIDE", _count: { _all: 2 } },
    ]);
    h.prisma.automation.findMany.mockResolvedValue([{ id: "a_1", name: "FOTO" }]);
    h.prisma.flow.findMany.mockResolvedValue([{ id: "f_1", name: "Boas-vindas" }]);
    h.prisma.broadcast.findMany.mockResolvedValue([{ id: "b_1", name: "Promo" }]);
    h.prisma.$queryRaw.mockImplementation(async (sql: { sql: string }) => {
      const s = sql.sql;
      if (s.includes('FROM "FlowStep"')) return [{ flowId: "f_1", sent: 5 }];
      if (s.includes('FROM "FlowLinkClick"')) return [{ flowId: "f_1", clicks: 1 }];
      if (s.includes('FROM "BroadcastLinkClick"')) return [{ broadcastId: "b_1", clicks: 2 }];
      if (s.includes('FROM "Contact" c')) return [{ day: "2026-10-07", count: 4 }, { day: "2026-10-08", count: 2 }];
      if (s.includes("TAG_ADDED")) return [{ tag: "clicou", added: 9, removed: 1, net: 8 }];
      if (s.includes('FROM "DmLog" d')) return [{ mediaId: "m_1", dms: 12, people: 10 }];
      if (s.includes("WITH com")) return [{ commented: 50, received: 40, clicked: 6 }];
      return [];
    });
  });

  it("groups DMs by origin, CTR per campaign/flow/broadcast, days filled, funnel rates", async () => {
    const r = await buildPeriodReport("ws_A", 7, AT);
    expect(r.dms.groups).toEqual({ campaign: 42, flow: 5, broadcast: 7, inbox: 4, draft: 1 });
    expect(r.dms.total).toBe(59);
    expect(r.ctr.campaigns).toEqual([{ id: "a_1", name: "FOTO", sent: 40, clicks: 6, ctr: 15 }]);
    expect(r.ctr.flows).toEqual([{ id: "f_1", name: "Boas-vindas", sent: 5, clicks: 1, ctr: 20 }]);
    expect(r.ctr.broadcasts).toEqual([{ id: "b_1", name: "Promo", sent: 7, clicks: 2, ctr: 28.6 }]);
    expect(r.newContacts.byDay).toHaveLength(8);
    expect(r.newContacts.byDay.at(-1)).toEqual({ day: "2026-10-08", count: 2 });
    expect(r.newContacts.byDay[0]).toEqual({ day: "2026-10-01", count: 0 });
    expect(r.newContacts.total).toBe(6);
    expect(r.topTags[0]).toEqual({ tag: "clicou", added: 9, removed: 1, net: 8 });
    expect(r.topPosts[0]).toEqual({ mediaId: "m_1", dms: 12, people: 10 });
    expect(r.moderation).toMatchObject({ hidden: 3, wouldHide: 2 });
    expect(r.funnel).toEqual({ commented: 50, received: 40, clicked: 6, receivedRate: 80, clickRate: 15 });
    // Only the ledger rows that went out (error null), in this workspace.
    expect(h.prisma.outboundMessage.groupBy.mock.calls[0][0].where).toMatchObject({ workspaceId: "ws_A", error: null });
    // Every raw query is pinned to the workspace.
    for (const [sql] of h.prisma.$queryRaw.mock.calls) expect((sql as { values: unknown[] }).values).toContain("ws_A");
  });

  it("CSV rows: one long table section/item/metric/value", async () => {
    const r = await buildPeriodReport("ws_A", 7, AT);
    const rows = reportCsvRows(r);
    expect(rows[0]).toEqual(["secao", "item", "metrica", "valor"]);
    expect(rows).toContainEqual(["dms_por_origem", "broadcast", "enviadas", 7]);
    expect(rows).toContainEqual(["campanhas", "FOTO", "ctr_%", 15]);
    expect(rows).toContainEqual(["funil", "clicou", "pessoas", 6]);
    const only = reportCsvRows(r, "tags");
    expect(only.slice(1).every((row) => row[0] === "etiquetas")).toBe(true);
  });
});
