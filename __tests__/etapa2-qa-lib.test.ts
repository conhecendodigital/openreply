/**
 * QA da Etapa 2 (bibliotecas, com um banco em memória onde dá):
 *  - rascunho nunca é enviado sem aprovação: criar, editar, descartar, expirar
 *    e TODAS as ferramentas do MCP (menos aprovar_rascunho com ok explícito)
 *    nunca chegam no envio;
 *  - aprovar só envia com a janela aberta (com a margem de 30 min) e marca
 *    EXPIRED fora dela;
 *  - sequência ponta a ponta: passo 1 sai na janela, a pessoa responde, o
 *    passo 2 não sai; janela fechada para; erro ambíguo da Meta encerra;
 *  - teto de esconder por hora com 35 jobs em paralelo: exatamente 30;
 *  - CRM com throwOnError propaga erro de banco (o job tenta de novo).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  prisma: {
    contact: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), upsert: vi.fn() },
    draftReply: { create: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    sequence: { findUnique: vi.fn() },
    sequenceEnrollment: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    directMessage: { findFirst: vi.fn() },
    contactEvent: { createMany: vi.fn() },
    instagramAccount: { findUnique: vi.fn() },
    automation: { findMany: vi.fn(async () => []) },
    commentModeration: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(async () => 1),
  },
  mockSend: vi.fn(),
  mockHide: vi.fn(),
  mockQueueAdd: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: h.prisma }));
vi.mock("@/lib/meta/client", () => ({
  sendDirectMessage: h.mockSend,
  hideComment: h.mockHide,
  MetaApiError: class MetaApiError extends Error {
    constructor(
      public code: number,
      public subcode: number | undefined,
      _t: string | undefined,
      message: string
    ) {
      super(message);
    }
  },
}));
vi.mock("@/lib/meta/send", () => ({
  sendTracked: vi.fn(async (_c: unknown, send: (o: unknown) => Promise<unknown>) => send({ metadata: "le:qa:r" })),
}));
vi.mock("@/lib/meta/oauth", () => ({ decryptToken: (t: string) => `plain:${t}` }));
vi.mock("@/lib/queue/client", () => ({
  getDMQueue: () => ({ add: h.mockQueueAdd }),
  SEQUENCE_STEP_JOB_NAME: "sequence-step",
}));
vi.mock("@/lib/billing/usage", () => ({
  reserveWorkspaceDMSend: vi.fn(async () => ({ allowed: true, periodStart: new Date() })),
  releaseWorkspaceDMReservation: vi.fn(),
}));

import { MetaApiError } from "@/lib/meta/client";
import { approveAndSend, createDraft, editDraft, expireDrafts, rejectDraft } from "../lib/drafts/drafts";
import { enrollInSequence, onPersonReplied, runSequenceStep } from "../lib/sequences/engine";
import { DEFAULT_MODERATION_SETTINGS, moderateComment } from "../lib/moderation/moderate";
import { trackInteraction } from "../lib/contacts/record";
import { handleMcpMessage, TOOLS, type InternalCall } from "../lib/mcp/server";

const HOUR = 3_600_000;
const now = new Date("2026-10-04T12:00:00Z");
const at = (msFromNow: number) => new Date(now.getTime() + msFromNow);

beforeEach(() => {
  vi.clearAllMocks();
  h.mockSend.mockResolvedValue({ recipient_id: "ig_p", message_id: "mid_out" });
  h.prisma.contactEvent.createMany.mockResolvedValue({ count: 1 });
  h.prisma.contact.updateMany.mockResolvedValue({ count: 1 });
  h.prisma.draftReply.update.mockResolvedValue({});
});

describe("a draft is never sent without approval", () => {
  const contact = {
    id: "ct_1",
    instagramAccountId: "acc",
    lastInboundAt: at(-HOUR),
    humanTakeover: false,
    humanTakeoverUntil: null,
  };

  it("create, edit, discard and the expiry sweep never call Meta", async () => {
    h.prisma.contact.findFirst.mockResolvedValue(contact);
    h.prisma.draftReply.create.mockResolvedValue({ id: "d_1", status: "PENDING", expiresAt: at(23 * HOUR) });
    h.prisma.draftReply.updateMany.mockResolvedValue({ count: 1 });
    expect(await createDraft({ workspaceId: "ws", contactId: "ct_1", text: "oi", origin: "vendedor", now })).toMatchObject({
      ok: true,
      draft: { status: "PENDING" },
    });
    await editDraft({ workspaceId: "ws", id: "d_1", text: "oi de novo" });
    await rejectDraft({ workspaceId: "ws", id: "d_1", by: "u" });
    await expireDrafts(now);
    expect(h.mockSend).not.toHaveBeenCalled();
    // Created PENDING: the status is never set by the caller.
    expect(h.prisma.draftReply.create.mock.calls[0][0].data.status).toBeUndefined();
  });

  it("no MCP tool other than aprovar_rascunho (with aprovadoPor + confirmar + textoAprovado) reaches a send route", async () => {
    const calls: [string, string][] = [];
    const call: InternalCall = async (method, path) => {
      calls.push([method, path]);
      return { status: 200, json: { success: true, data: {} } };
    };
    // Every argument any tool could want, but no approval.
    const args = {
      id: "d_1",
      contactId: "ct_1",
      automationId: "a_1",
      texto: "oi",
      text: "oi",
      motivo: "x",
      name: "n",
      keywords: ["k"],
      dmMessage: "m",
      origem: "story",
      origin: "story",
      conversationId: "c_1",
      commentId: "c_1",
      etiqueta: "t",
      tag: "t",
      nota: "n",
      ligar: true,
      confirmar: false,
    };
    for (const tool of TOOLS) {
      await handleMcpMessage(
        { jsonrpc: "2.0", id: tool.name, method: "tools/call", params: { name: tool.name, arguments: args } },
        call
      );
    }
    const sends = calls.filter(([m, p]) => m === "POST" && (/\/approve$/.test(p) || p === "/api/instagram/conversations"));
    expect(sends).toEqual([]);
  });

  it("approval without the explicit ok from the human never calls the approve route", async () => {
    const call = vi.fn<InternalCall>(async () => ({ status: 200, json: { success: true, data: {} } }));
    for (const a of [
      { id: "d_1", aprovadoPor: "Matheus", confirmar: true },
      { id: "d_1", aprovadoPor: "Matheus", textoAprovado: "oi" },
      { id: "d_1", confirmar: true, textoAprovado: "oi" },
      { id: "d_1", aprovadoPor: "Matheus", confirmar: "true", textoAprovado: "oi" },
    ]) {
      await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "aprovar_rascunho", arguments: a } }, call);
    }
    expect(call).not.toHaveBeenCalled();
  });
});

describe("approving sends only inside the 24-hour window", () => {
  const draft = (lastInboundAt: Date | null) => ({
    id: "d_1",
    workspaceId: "ws",
    instagramAccountId: "acc",
    text: "Oi!",
    origin: "vendedor",
    status: "PENDING",
    contact: { id: "ct_1", workspaceId: "ws", igUserId: "ig_p", lastInboundAt },
    instagramAccount: { id: "acc", instagramId: "ig_owner", accessToken: "enc", status: "ACTIVE" },
  });
  const approve = () => approveAndSend({ workspaceId: "ws", id: "d_1", approvedBy: "u", approvedVia: "session", now });

  beforeEach(() => {
    h.prisma.draftReply.updateMany.mockResolvedValue({ count: 1 });
  });

  it("open (23 h ago, inside the margin): sends and marks SENT", async () => {
    h.prisma.draftReply.findFirst.mockResolvedValue(draft(at(-23 * HOUR)));
    expect(await approve()).toMatchObject({ ok: true, draft: { status: "SENT" } });
    expect(h.mockSend).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["23 h 40 min ago (inside the 30 min safety margin)", at(-(23 * HOUR + 40 * 60_000))],
    ["2 days ago", at(-48 * HOUR)],
    ["never wrote to us", null],
  ])("closed — %s: EXPIRED with the 'message again' warning, nothing sent", async (_label, last) => {
    h.prisma.draftReply.findFirst.mockResolvedValue(draft(last));
    const res = await approve();
    expect(res).toMatchObject({ ok: false, code: "window_closed" });
    expect(h.mockSend).not.toHaveBeenCalled();
    expect(h.prisma.draftReply.update).toHaveBeenCalledWith({
      where: { id: "d_1" },
      data: { status: "EXPIRED", error: expect.stringMatching(/needs to message again/) },
    });
  });
});

describe("sequence, end to end on an in-memory enrollment", () => {
  const automation = {
    id: "auto_1",
    workspaceId: "ws",
    instagramAccountId: "acc",
    isActive: true,
    instagramAccount: { instagramId: "ig_owner", accessToken: "enc", status: "ACTIVE" },
    trackedLinks: [],
  };
  const steps = [
    { order: 1, message: "Conseguiu abrir o link?", delayMinutes: 10 },
    { order: 2, message: "Qualquer coisa me chama", delayMinutes: 60 },
  ];
  let enrollment: Row;
  let contact: Row;
  let inbox: { sentAt: Date }[];

  beforeEach(() => {
    contact = { id: "ct_1", workspaceId: "ws", igUserId: "ig_p", username: "maria", lastInboundAt: now, humanTakeover: false, humanTakeoverUntil: null };
    inbox = [];
    h.prisma.contact.upsert.mockResolvedValue({ id: "ct_1", workspaceId: "ws", firstSeenAt: now, lastSeenAt: now });
    h.prisma.contact.findUnique.mockImplementation(async () => contact);
    h.prisma.sequence.findUnique.mockResolvedValue({ id: "seq_1", isActive: true, steps });
    h.prisma.sequenceEnrollment.create.mockImplementation(async ({ data }: { data: Row }) => {
      enrollment = { id: "en_1", status: "ACTIVE", lastStepOrder: 0, ...data };
      return { id: "en_1" };
    });
    h.prisma.sequenceEnrollment.findUnique.mockImplementation(async () =>
      enrollment ? { ...enrollment, contact, sequence: { isActive: true, steps, automation } } : null
    );
    h.prisma.sequenceEnrollment.findMany.mockImplementation(async ({ where }: { where: { startedAt: { lt: Date } } }) =>
      enrollment.status === "ACTIVE" && (enrollment.startedAt as Date) < where.startedAt.lt
        ? [{ ...enrollment, sequence: { steps } }]
        : []
    );
    h.prisma.sequenceEnrollment.updateMany.mockImplementation(async ({ where, data }: { where: Row; data: Row }) => {
      const matches = Object.entries(where).every(([k, v]) => k === "id" || enrollment[k] === v);
      if (!matches) return { count: 0 };
      Object.assign(enrollment, data);
      return { count: 1 };
    });
    h.prisma.directMessage.findFirst.mockImplementation(async ({ where }: { where: { sentAt: { gt: Date } } }) =>
      inbox.find((m) => m.sentAt > where.sentAt.gt) ?? null
    );
  });

  async function enrollAtTap() {
    return enrollInSequence({
      automation: { id: "auto_1", workspaceId: "ws", instagramAccountId: "acc", instagramAccount: { instagramId: "ig_owner" } },
      igUserId: "ig_p",
      inboundAt: now,
      now,
    });
  }

  it("step 1 goes out inside the window; the person answers; step 2 never goes out", async () => {
    expect(await enrollAtTap()).toEqual({ enrollmentId: "en_1", waitingReply: false });
    expect(await runSequenceStep({ enrollmentId: "en_1", order: 1 }, at(10 * 60_000))).toBe("sent");
    expect(h.mockSend).toHaveBeenCalledTimes(1);

    // She answers 20 min later: the CRM job stops the sequence.
    const reply = at(20 * 60_000);
    inbox.push({ sentAt: reply });
    contact.lastInboundAt = reply;
    expect(await onPersonReplied({ contactId: "ct_1", instagramId: "ig_owner", at: reply })).toEqual({ stopped: 1, resumed: 0 });
    expect(enrollment.status).toBe("STOPPED_REPLY");

    expect(await runSequenceStep({ enrollmentId: "en_1", order: 2 }, at(70 * 60_000))).toBe("noop");
    expect(h.mockSend).toHaveBeenCalledTimes(1);
  });

  it("even if the CRM job lags, a reply already in the inbox stops step 2", async () => {
    await enrollAtTap();
    await runSequenceStep({ enrollmentId: "en_1", order: 1 }, at(10 * 60_000));
    inbox.push({ sentAt: at(20 * 60_000) });
    expect(await runSequenceStep({ enrollmentId: "en_1", order: 2 }, at(70 * 60_000))).toBe("stopped_reply");
    expect(h.mockSend).toHaveBeenCalledTimes(1);
  });

  it("the window closing stops it: nothing leaves after 24 h (minus the margin)", async () => {
    await enrollAtTap();
    expect(await runSequenceStep({ enrollmentId: "en_1", order: 1 }, at(23 * HOUR + 31 * 60_000))).toBe("stopped_window");
    expect(enrollment.status).toBe("STOPPED_WINDOW");
    expect(h.mockSend).not.toHaveBeenCalled();
  });

  it("an ambiguous Meta error ends the enrollment (not stuck ACTIVE, never retried)", async () => {
    await enrollAtTap();
    h.mockSend.mockRejectedValue(new MetaApiError(1, undefined, undefined, "An unknown error has occurred."));
    await expect(runSequenceStep({ enrollmentId: "en_1", order: 1 }, at(10 * 60_000))).rejects.toThrow();
    expect(enrollment.status).toBe("STOPPED_OFF");
    expect(enrollment.lastStepOrder).toBe(1);
  });

  it("a plain Meta failure gives the step back for the retry", async () => {
    await enrollAtTap();
    h.mockSend.mockRejectedValueOnce(new MetaApiError(4, undefined, undefined, "rate limited"));
    await expect(runSequenceStep({ enrollmentId: "en_1", order: 1 }, at(10 * 60_000))).rejects.toThrow();
    expect(enrollment).toMatchObject({ status: "ACTIVE", lastStepOrder: 0 });
    expect(await runSequenceStep({ enrollmentId: "en_1", order: 1 }, at(15 * 60_000))).toBe("sent");
  });

  it("no enrollment while a human took over", async () => {
    contact.humanTakeover = true;
    contact.humanTakeoverUntil = at(HOUR);
    expect(await enrollAtTap()).toBeNull();
    expect(h.prisma.sequenceEnrollment.create).not.toHaveBeenCalled();
  });
});

describe("hourly hide ceiling under parallel jobs", () => {
  it("35 matching comments at once with the default 30/h: exactly 30 hidden, 5 WOULD_HIDE 'teto'", async () => {
    const rows: Row[] = [];
    // Older hides and manual hides do not count.
    rows.push({ id: "old", instagramAccountId: "acc", hiddenBy: "auto", hiddenAt: new Date(Date.now() - 2 * HOUR) });
    rows.push({ id: "manual", instagramAccountId: "acc", hiddenBy: "u_matheus", hiddenAt: new Date() });

    h.prisma.instagramAccount.findUnique.mockResolvedValue({
      id: "acc",
      workspaceId: "ws",
      instagramId: "ig_owner",
      accessToken: "enc", status: "ACTIVE",
      moderationSettings: { ...DEFAULT_MODERATION_SETTINGS, mode: "HIDE" },
    });
    h.prisma.commentModeration.findUnique.mockResolvedValue(null);
    h.prisma.commentModeration.create.mockImplementation(async ({ data }: { data: Row }) => {
      const row = { id: `mod_${rows.length}`, ...data };
      rows.push(row);
      return { id: row.id };
    });
    h.prisma.commentModeration.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: Row }) => {
      const row = rows.find((r) => r.id === where.id)!;
      Object.assign(row, data);
      return row;
    });
    h.prisma.commentModeration.count.mockImplementation(async ({ where }: { where: { hiddenAt: { gt: Date } } }) =>
      rows.filter((r) => r.hiddenBy === "auto" && r.hiddenAt instanceof Date && r.hiddenAt > where.hiddenAt.gt).length
    );
    // pg_advisory_xact_lock: transactions on the same account run one at a time.
    let lock: Promise<unknown> = Promise.resolve();
    h.prisma.$transaction.mockImplementation((fn: (tx: unknown) => Promise<unknown>) => {
      const next = lock.then(() => fn(h.prisma));
      lock = next.catch(() => undefined);
      return next;
    });
    h.mockHide.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 1));
      return { success: true };
    });

    const outcomes = await Promise.all(
      Array.from({ length: 35 }, (_, i) =>
        moderateComment(
          { instagramAccountId: "ig_owner", commentId: `c_${i}`, commentText: "ganhe dinheiro fácil no pix acesse bit.ly/xyz", commenterId: `p_${i}`, commenterName: null, mediaId: "m" },
          { campaigns: [] }
        )
      )
    );
    const hidden = outcomes.filter((o) => o.action === "HIDDEN").length;
    const capped = outcomes.filter((o) => o.action === "WOULD_HIDE" && o.capped).length;
    expect(hidden + capped).toBe(35);
    expect(hidden).toBe(30);
    expect(capped).toBe(5);
    expect(h.mockHide).toHaveBeenCalledTimes(30);
    expect(rows.filter((r) => r.matchedRule === "teto")).toHaveLength(5);
  });
});

describe("CRM errors are not swallowed when a queued job asks", () => {
  const input = {
    account: { id: "acc", workspaceId: "ws", instagramId: "ig_owner" },
    igUserId: "ig_p",
    event: { type: "DM_IN" as const, refId: "mid_1", occurredAt: now, text: "oi" },
  };

  it("throwOnError: the database error reaches BullMQ (retry, idempotent by mid)", async () => {
    h.prisma.contact.upsert.mockRejectedValue(new Error("db down"));
    await expect(trackInteraction(input, { throwOnError: true })).rejects.toThrow("db down");
  });

  it("default (inline callers like a DM send): never throws, returns null", async () => {
    h.prisma.contact.upsert.mockRejectedValue(new Error("db down"));
    await expect(trackInteraction(input)).resolves.toBeNull();
  });
});
