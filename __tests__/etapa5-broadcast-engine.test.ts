/**
 * Etapa 5: o motor de disparos (lib/broadcasts/engine.ts) com as tabelas em
 * memória e o envio REAL (sendTracked + sendFlowMessage, só o fetch é falso).
 * Prova: só quem está com a janela de 24 h aberta recebe; opt-out, takeover,
 * canal desligado, quem está no meio de fluxo e o dedupe ficam de fora; o
 * corpo do POST nunca leva "tag" (nada de HUMAN_AGENT); limite por hora
 * reagenda sem pular ninguém; cota acabou para; cancelar no meio para; job
 * duplicado não envia duas vezes; erro ambíguo vira MAYBE_SENT e não reenvia.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const h = vi.hoisted(() => {
  const state = {
    broadcast: null as Row | null,
    account: {} as Row,
    recipients: [] as Row[],
    contacts: new Map<string, Row>(),
    busy: new Set<string>(),
    outbound: [] as Row[],
    links: [] as Row[],
    segment: null as Row | null,
    seq: 0,
  };
  const matches = (r: Row, where: Row): boolean =>
    Object.entries(where).every(([k, v]) => {
      if (k === "OR") return (v as Row[]).some((w) => matches(r, w));
      if (v && typeof v === "object" && !(v instanceof Date)) {
        const o = v as { in?: unknown[]; lt?: Date; lte?: Date };
        if (o.in) return o.in.includes(r[k]);
        if (o.lt) return r[k] instanceof Date && (r[k] as Date) < o.lt;
        if (o.lte) return r[k] instanceof Date && (r[k] as Date) <= o.lte;
        return true;
      }
      return r[k] === v;
    });
  const apply = (r: Row, data: Row) => {
    for (const [k, v] of Object.entries(data)) r[k] = v;
    r.updatedAt = new Date();
  };
  const prisma = {
    broadcast: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const b = state.broadcast;
        if (!b || b.id !== where.id) return null;
        return { ...b, instagramAccount: { ...state.account }, links: state.links.map((l) => ({ ...l })) };
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const b = state.broadcast;
        if (b && matches(b, where)) {
          apply(b, data);
          return { count: 1 };
        }
        return { count: 0 };
      }),
      update: vi.fn(async ({ data }: { data: Row }) => {
        apply(state.broadcast!, data);
        return state.broadcast;
      }),
      findMany: vi.fn(async ({ where }: { where: Row }) =>
        state.broadcast && matches(state.broadcast, where) ? [{ ...state.broadcast, instagramAccount: { ...state.account } }] : []
      ),
    },
    broadcastRecipient: {
      createMany: vi.fn(async ({ data }: { data: Row[] }) => {
        let count = 0;
        for (const d of data) {
          if (state.recipients.some((r) => r.broadcastId === d.broadcastId && r.contactId === d.contactId)) continue;
          state.recipients.push({ id: `rcp_${++state.seq}`, status: "PENDING", createdAt: new Date(), updatedAt: new Date(), ...d });
          count += 1;
        }
        return { count };
      }),
      findMany: vi.fn(async ({ where, take }: { where: Row; take: number }) =>
        state.recipients
          .filter((r) => matches(r, where))
          .slice(0, take)
          .map((r) => ({ ...r, contact: state.contacts.get(r.contactId as string) ?? null }))
      ),
      updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        let count = 0;
        for (const r of state.recipients) {
          if (matches(r, where)) {
            apply(r, data);
            count += 1;
          }
        }
        return { count };
      }),
      count: vi.fn(async ({ where }: { where: Row }) => state.recipients.filter((r) => matches(r, where)).length),
      groupBy: vi.fn(async () => {
        const by = new Map<string, number>();
        for (const r of state.recipients) by.set(r.status as string, (by.get(r.status as string) ?? 0) + 1);
        return [...by].map(([status, n]) => ({ status, _count: { _all: n } }));
      }),
    },
    segment: { findFirst: vi.fn(async () => state.segment) },
    flowRun: { findFirst: vi.fn(async ({ where }: { where: { contactId: string } }) => (state.busy.has(where.contactId) ? { id: "run" } : null)) },
    sequenceEnrollment: { findFirst: vi.fn(async () => null) },
    instagramAccount: {
      findUnique: vi.fn(async () => ({ status: state.account.status })),
      updateMany: vi.fn(async () => ({ count: 0 })),
      findFirst: vi.fn(async () => null),
    },
    outboundMessage: {
      create: vi.fn(async ({ data }: { data: Row }) => {
        const row = { id: `out_${++state.seq}`, ...data };
        state.outbound.push(row);
        return { id: row.id };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Row }) => {
        const row = state.outbound.find((o) => o.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
    },
    operationalEvent: { create: vi.fn(async () => ({})) },
    $queryRaw: vi.fn(),
  };
  return {
    state,
    prisma,
    add: vi.fn(),
    slot: vi.fn(),
    reserve: vi.fn(),
    release: vi.fn(),
    recordEvent: vi.fn(),
    fetch: vi.fn(),
  };
});

vi.mock("@/lib/db/client", () => ({ prisma: h.prisma }));
vi.mock("@/lib/queue/client", () => ({ getDMQueue: () => ({ add: h.add }) }));
vi.mock("@/lib/meta/oauth", () => ({ decryptToken: () => "token" }));
vi.mock("@/lib/utils/rate-limiter", () => ({ reserveBroadcastSlot: h.slot }));
vi.mock("@/lib/billing/usage", () => ({ reserveWorkspaceDMSend: h.reserve, releaseWorkspaceDMReservation: h.release }));
vi.mock("@/lib/contacts/record", () => ({ recordEvent: h.recordEvent, clearAccountCache: vi.fn() }));

import { cancelBroadcast, runBroadcastBatch, runBroadcastStart, sweepBroadcasts } from "../lib/broadcasts/engine";
import { windowOpenSince } from "../lib/segments/filters";

const NOW = new Date("2026-10-08T15:00:00.000Z");
const clock = () => new Date(NOW);
const HOUR = 3_600_000;

function contact(id: string, over: Row = {}): Row {
  return {
    lastInboundAt: new Date(NOW.getTime() - HOUR),
    humanTakeover: false,
    humanTakeoverUntil: null,
    broadcastOptOutAt: null,
    username: id,
    name: `${id} Silva`,
    ...over,
  };
}

function setBroadcast(over: Row = {}) {
  h.state.broadcast = {
    id: "b_1",
    workspaceId: "ws_A",
    instagramAccountId: "acc_1",
    segmentId: null,
    filtersSnapshot: {},
    name: "Promo",
    text: "Oi {first_name}, tem novidade!",
    buttons: [],
    variants: null,
    abWinnerKey: null,
    skipBusy: true,
    status: "SENDING",
    batchSize: 20,
    pauseSeconds: 60,
    batchSeq: 0,
    nextBatchAt: null,
    scheduledAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function addRecipient(contactId: string, over: Row = {}, contactOver: Row = {}) {
  h.state.contacts.set(contactId, contact(contactId, contactOver));
  h.state.recipients.push({
    id: `rcp_${contactId}`,
    broadcastId: "b_1",
    workspaceId: "ws_A",
    contactId,
    igUserId: `ig_${contactId}`,
    variantKey: null,
    status: "PENDING",
    createdAt: new Date(NOW.getTime() + h.state.recipients.length),
    updatedAt: NOW,
    ...over,
  });
}

const status = (contactId: string) => h.state.recipients.find((r) => r.contactId === contactId)?.status;
const posts = () =>
  h.fetch.mock.calls.map((c: unknown[]) => JSON.parse((c[1] as { body: string }).body) as Record<string, unknown>);
const batch = (seq = 0) => runBroadcastBatch({ instagramAccountId: "ig_1", broadcastId: "b_1", seq }, clock);

beforeEach(() => {
  vi.clearAllMocks();
  h.state.recipients = [];
  h.state.contacts.clear();
  h.state.busy.clear();
  h.state.outbound = [];
  h.state.links = [];
  h.state.segment = null;
  h.state.account = { id: "acc_1", instagramId: "ig_1", status: "ACTIVE", accessToken: "enc" };
  setBroadcast();
  h.slot.mockResolvedValue({ allowed: true, count: 1, retryInMs: 0 });
  h.reserve.mockResolvedValue({ allowed: true, periodStart: NOW, limit: 1000 });
  h.release.mockResolvedValue({});
  h.recordEvent.mockResolvedValue(true);
  h.add.mockResolvedValue({});
  let n = 0;
  h.fetch.mockImplementation(async () =>
    new Response(JSON.stringify({ recipient_id: "x", message_id: `mid_${++n}` }), { status: 200 })
  );
  vi.stubGlobal("fetch", h.fetch);
});

describe("only an open 24 h window receives", () => {
  it("sends to the open ones, skips closed window / opt-out / takeover / mid-flow, never with a tag", async () => {
    addRecipient("open");
    addRecipient("closed", {}, { lastInboundAt: new Date(NOW.getTime() - 24 * HOUR) });
    addRecipient("edge", {}, { lastInboundAt: new Date(windowOpenSince(NOW).getTime() - 1000) });
    addRecipient("never", {}, { lastInboundAt: null });
    addRecipient("optout", {}, { broadcastOptOutAt: new Date(NOW.getTime() - HOUR) });
    addRecipient("takeover", {}, { humanTakeover: true, humanTakeoverUntil: new Date(NOW.getTime() + HOUR) });
    addRecipient("busy");
    h.state.busy.add("busy");

    expect(await batch()).toBe("done");

    expect(status("open")).toBe("SENT");
    expect(status("closed")).toBe("SKIPPED_WINDOW");
    expect(status("edge")).toBe("SKIPPED_WINDOW");
    expect(status("never")).toBe("SKIPPED_WINDOW");
    expect(status("optout")).toBe("SKIPPED_OPTOUT");
    expect(status("takeover")).toBe("SKIPPED_TAKEOVER");
    expect(status("busy")).toBe("SKIPPED_BUSY");

    // Exactly one POST, to the open one, with no tag / messaging_type.
    expect(h.fetch).toHaveBeenCalledTimes(1);
    const body = posts()[0];
    expect(body.recipient).toEqual({ id: "ig_open" });
    expect(body).not.toHaveProperty("tag");
    expect(body).not.toHaveProperty("messaging_type");
    expect(JSON.stringify(body)).not.toMatch(/HUMAN_AGENT/);
    expect((body.message as { text: string }).text).toBe("Oi open, tem novidade!");
    expect((body.message as { metadata: string }).metadata).toMatch(/^le:broadcast:out_/);

    // Ledger: origin broadcast, refId = the recipient.
    expect(h.state.outbound).toHaveLength(1);
    expect(h.state.outbound[0]).toMatchObject({ origin: "broadcast", refId: "rcp_open", contactIgUserId: "ig_open", mid: "mid_1" });
    expect(h.recordEvent).toHaveBeenCalledWith(
      { id: "open", workspaceId: "ws_A" },
      expect.objectContaining({ type: "BROADCAST_SENT", refId: "rcp_open" })
    );
    // Only one reservation of each (the skipped cost nothing).
    expect(h.slot).toHaveBeenCalledTimes(1);
    expect(h.reserve).toHaveBeenCalledTimes(1);
    expect(h.state.broadcast).toMatchObject({ status: "DONE", stopReason: "done", sentCount: 1, failedCount: 0, skippedCount: 6 });
  });

  it("a takeover whose deadline passed is no longer a takeover", async () => {
    addRecipient("was", {}, { humanTakeover: true, humanTakeoverUntil: new Date(NOW.getTime() - 1000) });
    await batch();
    expect(status("was")).toBe("SENT");
  });
});

describe("buttons and A/B", () => {
  it("link buttons go through /r/<slug> signed for the person; flow buttons carry bc:<recipient>:<button>", async () => {
    setBroadcast({
      buttons: [
        { id: "b1", label: "Ver oferta", kind: "link", url: "https://loja.com" },
        { id: "b2", label: "Quero saber", kind: "flow", flowId: "f_1" },
      ],
    });
    h.state.links = [{ buttonId: "b1", slug: "abc123" }];
    addRecipient("maria");
    await batch();
    const payload = (posts()[0].message as { attachment: { payload: { buttons: Row[] } } }).attachment.payload;
    expect(payload.buttons[0]).toMatchObject({ type: "web_url", title: "Ver oferta" });
    expect(String(payload.buttons[0].url)).toMatch(/\/r\/abc123\?c=ig_maria\./);
    expect(payload.buttons[1]).toEqual({ type: "postback", title: "Quero saber", payload: "bc:rcp_maria:b2" });
    // The flow id never travels in the payload.
    expect(JSON.stringify(payload)).not.toContain("f_1");
  });

  it("each person gets their variant's text; a declared winner replaces it for whoever is pending", async () => {
    setBroadcast({
      variants: [
        { key: "A", weight: 50, text: "Texto A {username}" },
        { key: "B", weight: 50, text: "Texto B {username}" },
      ],
    });
    addRecipient("ana", { variantKey: "A" });
    addRecipient("bia", { variantKey: "B" });
    setBroadcast({ ...h.state.broadcast, batchSize: 1 });
    expect(await batch(0)).toBe("next");
    expect((posts()[0].message as { text: string }).text).toBe("Texto A ana");
    h.state.broadcast!.abWinnerKey = "A";
    expect(await batch(1)).toBe("done");
    expect((posts()[1].message as { text: string }).text).toBe("Texto A bia");
  });
});

describe("pace, limits and stopping", () => {
  it("sends batchSize, then schedules the next batch after pauseSeconds", async () => {
    setBroadcast({ batchSize: 2, pauseSeconds: 90 });
    addRecipient("a");
    addRecipient("b");
    addRecipient("c");
    expect(await batch(0)).toBe("next");
    expect(h.fetch).toHaveBeenCalledTimes(2);
    expect(status("c")).toBe("PENDING");
    const [name, data, opts] = h.add.mock.calls.at(-1)!;
    expect(name).toBe("broadcast-batch");
    expect(data).toEqual({ instagramAccountId: "ig_1", broadcastId: "b_1", seq: 1 });
    expect(opts).toMatchObject({ jobId: "bcbatch_b_1_1", delay: 90_000, attempts: 1 });
    expect(h.state.broadcast!.nextBatchAt).toEqual(new Date(NOW.getTime() + 90_000));
    expect(await batch(1)).toBe("done");
    expect(status("c")).toBe("SENT");
  });

  it("a duplicated batch job (same seq) sends nothing", async () => {
    addRecipient("a");
    expect(await batch(0)).toBe("done");
    setBroadcast({ ...h.state.broadcast, status: "SENDING" });
    h.state.recipients[0].status = "PENDING";
    expect(await batch(0)).toBe("duplicate");
    expect(h.fetch).toHaveBeenCalledTimes(1);
  });

  it("hourly limit: nobody is skipped, the batch comes back when the bucket frees", async () => {
    addRecipient("a");
    addRecipient("b");
    h.slot.mockResolvedValueOnce({ allowed: true }).mockResolvedValueOnce({ allowed: false, retryInMs: 1_200_000 });
    expect(await batch(0)).toBe("rate_limited");
    expect(status("a")).toBe("SENT");
    expect(status("b")).toBe("PENDING");
    expect(h.add.mock.calls.at(-1)![2]).toMatchObject({ jobId: "bcbatch_b_1_1", delay: 1_200_000 });
    expect(h.reserve).toHaveBeenCalledTimes(1);
  });

  it("monthly quota over: the rest is SKIPPED_LIMIT and it ends", async () => {
    addRecipient("a");
    addRecipient("b");
    h.reserve.mockResolvedValue({ allowed: false, periodStart: null, limit: 0 });
    expect(await batch(0)).toBe("monthly_limit");
    expect(status("a")).toBe("SKIPPED_LIMIT");
    expect(status("b")).toBe("SKIPPED_LIMIT");
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.state.broadcast).toMatchObject({ status: "DONE", stopReason: "monthly_limit" });
  });

  it("canceled between two people: stops, the rest stays canceled", async () => {
    addRecipient("a");
    addRecipient("b");
    h.fetch.mockImplementationOnce(async () => {
      await cancelBroadcast("b_1", "ws_A", "u_A", NOW);
      return new Response(JSON.stringify({ message_id: "mid_a" }), { status: 200 });
    });
    expect(await batch(0)).toBe("canceled");
    expect(status("a")).toBe("SENT");
    expect(status("b")).toBe("SKIPPED_CANCELED");
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(h.state.broadcast).toMatchObject({ status: "CANCELED", canceledBy: "u_A" });
    // The cancel counted before the send in flight finished: counted again.
    expect(h.state.broadcast).toMatchObject({ sentCount: 1, skippedCount: 1 });
  });

  it("a channel turned off: nothing is sent, everyone pending is SKIPPED_CHANNEL", async () => {
    addRecipient("a");
    h.state.account.status = "DISCONNECTED";
    expect(await batch(0)).toBe("channel_off");
    expect(status("a")).toBe("SKIPPED_CHANNEL");
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.state.broadcast).toMatchObject({ status: "FAILED", stopReason: "channel_off" });
  });

  it("Meta's ambiguous error = MAYBE_SENT (never resent); a closed-window error = SKIPPED_WINDOW", async () => {
    addRecipient("a");
    addRecipient("b");
    addRecipient("c");
    h.fetch
      .mockImplementationOnce(async () => new Response(JSON.stringify({ error: { code: 1, message: "An unknown error has occurred." } }), { status: 500 }))
      .mockImplementationOnce(async () => new Response(JSON.stringify({ error: { code: 10, error_subcode: 2534022, message: "This message is sent outside of allowed window." } }), { status: 400 }))
      .mockImplementationOnce(async () => new Response(JSON.stringify({ error: { code: 100, message: "Invalid parameter" } }), { status: 400 }));
    expect(await batch(0)).toBe("done");
    expect(status("a")).toBe("MAYBE_SENT");
    expect(status("b")).toBe("SKIPPED_WINDOW");
    expect(status("c")).toBe("FAILED");
    // Every failed send gave its quota back.
    expect(h.release).toHaveBeenCalledTimes(3);
    expect(h.state.broadcast).toMatchObject({ sentCount: 0, failedCount: 2, skippedCount: 1 });
  });
});

describe("start: recipients picked when it starts", () => {
  it("materializes only eligible people (the SQL), dedupes, assigns variants, queues batch 0", async () => {
    setBroadcast({
      status: "SCHEDULED",
      variants: [
        { key: "A", weight: 50, text: "A" },
        { key: "B", weight: 50, text: "B" },
      ],
    });
    h.prisma.$queryRaw
      .mockResolvedValueOnce([{ total: 259, windowOpen: 3, optedOut: 1, takeover: 0, busy: 0, eligible: 2 }])
      .mockResolvedValueOnce([
        { id: "c1", igUserId: "u1" },
        { id: "c2", igUserId: "u2" },
      ]);
    // Someone already in this broadcast (retry) is not added twice.
    h.state.recipients.push({ id: "old", broadcastId: "b_1", contactId: "c1", status: "SENT" });
    expect(await runBroadcastStart({ instagramAccountId: "ig_1", broadcastId: "b_1" }, clock)).toBe("started");
    expect(h.state.recipients.filter((r) => r.contactId === "c1")).toHaveLength(1);
    const added = h.state.recipients.find((r) => r.contactId === "c2")!;
    expect(["A", "B"]).toContain(added.variantKey);
    expect(h.state.broadcast).toMatchObject({ status: "SENDING", segmentCount: 259, eligibleCount: 2, startedAt: NOW });
    const eligibleSql = h.prisma.$queryRaw.mock.calls[1][0] as { sql: string; values: unknown[] };
    expect(eligibleSql.sql).toContain('c."lastInboundAt" > ?');
    expect(eligibleSql.values).toContainEqual(windowOpenSince(NOW));
    expect(h.add.mock.calls.at(-1)).toEqual([
      "broadcast-batch",
      { instagramAccountId: "ig_1", broadcastId: "b_1", seq: 0 },
      { jobId: "bcbatch_b_1_0", attempts: 1 },
    ]);
  });

  it("nobody with the conversation open: ends DONE no_open_window, sends nothing", async () => {
    setBroadcast({ status: "SCHEDULED" });
    h.prisma.$queryRaw.mockResolvedValueOnce([{ total: 259, windowOpen: 0, eligible: 0 }]).mockResolvedValueOnce([]);
    expect(await runBroadcastStart({ instagramAccountId: "ig_1", broadcastId: "b_1" }, clock)).toBe("empty");
    expect(h.state.broadcast).toMatchObject({ status: "DONE", stopReason: "no_open_window", segmentCount: 259, eligibleCount: 0 });
    expect(h.add).not.toHaveBeenCalled();
  });

  it("uses the segment's filters as they are NOW", async () => {
    setBroadcast({ status: "SCHEDULED", segmentId: "seg_1", filtersSnapshot: { hasTags: ["antiga"] } });
    h.state.segment = { filters: { hasTags: ["nova"] } };
    h.prisma.$queryRaw.mockResolvedValueOnce([{ total: 1, eligible: 0 }]).mockResolvedValueOnce([]);
    await runBroadcastStart({ instagramAccountId: "ig_1", broadcastId: "b_1" }, clock);
    const countSql = h.prisma.$queryRaw.mock.calls[0][0] as { values: unknown[] };
    expect(countSql.values).toContain("nova");
    expect(countSql.values).not.toContain("antiga");
  });

  it("not SCHEDULED (canceled, already started) or another account: noop; too early: re-queued", async () => {
    setBroadcast({ status: "CANCELED" });
    expect(await runBroadcastStart({ instagramAccountId: "ig_1", broadcastId: "b_1" }, clock)).toBe("noop");
    setBroadcast({ status: "SCHEDULED" });
    expect(await runBroadcastStart({ instagramAccountId: "ig_OTHER", broadcastId: "b_1" }, clock)).toBe("noop");
    setBroadcast({ status: "SCHEDULED", scheduledAt: new Date(NOW.getTime() + HOUR) });
    expect(await runBroadcastStart({ instagramAccountId: "ig_1", broadcastId: "b_1" }, clock)).toBe("early");
    expect(h.add.mock.calls.at(-1)![2]).toMatchObject({ delay: HOUR });
    // Not the id of the job still running (BullMQ would drop the add).
    expect(h.add.mock.calls.at(-1)![2].jobId).toMatch(/^bcstart_b_1_early\d+$/);
    expect(h.state.broadcast!.status).toBe("SCHEDULED");
    expect(h.prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("channel off at start: FAILED, nobody picked", async () => {
    setBroadcast({ status: "SCHEDULED" });
    h.state.account.status = "NEEDS_RECONNECT";
    expect(await runBroadcastStart({ instagramAccountId: "ig_1", broadcastId: "b_1" }, clock)).toBe("channel_off");
    expect(h.state.broadcast).toMatchObject({ status: "FAILED", stopReason: "channel_off" });
    expect(h.prisma.$queryRaw).not.toHaveBeenCalled();
  });
});

describe("sweep", () => {
  it("resumes a SENDING broadcast whose next batch is 10 min late, and marks stuck sends MAYBE_SENT", async () => {
    setBroadcast({ status: "SENDING", batchSeq: 4, nextBatchAt: new Date(NOW.getTime() - 11 * 60_000) });
    addRecipient("stuck", { status: "SENDING", updatedAt: new Date(NOW.getTime() - 11 * 60_000) });
    addRecipient("fresh", { status: "SENDING", updatedAt: new Date(NOW.getTime() - 60_000) });
    const out = await sweepBroadcasts(NOW);
    expect(out).toMatchObject({ resumed: 1, maybeSent: 1 });
    expect(status("stuck")).toBe("MAYBE_SENT");
    expect(status("fresh")).toBe("SENDING");
    const call = h.add.mock.calls.find((c: unknown[]) => c[0] === "broadcast-batch")!;
    expect(call[1]).toEqual({ instagramAccountId: "ig_1", broadcastId: "b_1", seq: 4 });
  });

  it("starts a SCHEDULED broadcast whose start job was lost", async () => {
    setBroadcast({ status: "SCHEDULED", scheduledAt: new Date(NOW.getTime() - 5 * 60_000) });
    const out = await sweepBroadcasts(NOW);
    expect(out.started).toBe(1);
    expect(h.add.mock.calls.find((c: unknown[]) => c[0] === "broadcast-start")![1]).toEqual({ instagramAccountId: "ig_1", broadcastId: "b_1" });
  });
});
