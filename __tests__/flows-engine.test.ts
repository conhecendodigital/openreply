/**
 * Etapa 3: o motor de fluxos (lib/flows/engine.ts) com uma tabela de runs em
 * memória. Cobre cada caminho: mensagem, botão (toque), condição, ação,
 * espera, fim; e todas as travas: janela de 24 h, takeover, canal desligado,
 * fluxo desligado, limite por hora, cota, dedupe, claim contra job duplicado,
 * erro ambíguo da Meta e o teto de passos.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Run = Record<string, unknown> & {
  id: string;
  flowId: string;
  contactId: string;
  status: string;
  currentNodeId: string | null;
  stepCount: number;
  triggerKey: string;
  updatedAt: Date;
};

const h = vi.hoisted(() => {
  const state = {
    flows: new Map<string, Record<string, unknown>>(),
    runs: new Map<string, Record<string, unknown>>(),
    steps: [] as Record<string, unknown>[],
    contact: {} as Record<string, unknown>,
    tags: new Set<string>(),
    clicks: [] as Record<string, unknown>[],
    links: [] as Record<string, unknown>[],
    events: [] as Record<string, unknown>[],
    seq: 0,
  };
  const OPEN = ["ACTIVE", "WAITING_DELAY", "WAITING_REPLY", "WAITING_TAP"];
  const matches = (r: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === "object" && !(v instanceof Date)) {
        const o = v as { in?: unknown[]; lt?: Date };
        if (o.in) return o.in.includes(r[k]);
        if (o.lt) return (r[k] as Date) < o.lt;
        return true;
      }
      return r[k] === v;
    });
  const apply = (r: Record<string, unknown>, data: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(data)) {
      if (v && typeof v === "object" && "increment" in (v as object)) r[k] = (r[k] as number) + (v as { increment: number }).increment;
      else r[k] = v;
    }
    r.updatedAt = new Date();
  };
  const withRelations = (r: Record<string, unknown> | undefined) => {
    if (!r) return null;
    const flow = state.flows.get(r.flowId as string)!;
    return { ...r, flow: { ...flow }, contact: { ...state.contact } };
  };
  const prisma = {
    flow: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; isActive?: boolean } }) => {
        const f = state.flows.get(where.id);
        if (!f || (where.isActive !== undefined && f.isActive !== where.isActive)) return null;
        return { ...f };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const f = state.flows.get(where.id)!;
        apply(f, data);
        return f;
      }),
    },
    flowRun: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => withRelations(state.runs.get(where.id))),
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const r = [...state.runs.values()].find((x) => matches(x, where));
        return r ? { ...r } : null;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        let count = 0;
        for (const r of state.runs.values()) {
          if (matches(r, where)) {
            apply(r, data);
            count += 1;
          }
        }
        return { count };
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const all = [...state.runs.values()];
        const dup =
          all.some((r) => r.flowId === data.flowId && r.triggerKey === data.triggerKey) ||
          all.some((r) => r.flowId === data.flowId && r.contactId === data.contactId && OPEN.includes(r.status as string));
        if (dup) throw Object.assign(new Error("unique"), { code: "P2002" });
        const id = `run_${++state.seq}`;
        state.runs.set(id, { privateReplyUsed: false, waitingUntil: null, stepCount: 0, stopReason: null, ...data, id, updatedAt: new Date() });
        return { id };
      }),
    },
    flowStep: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => state.steps.push(data)) },
    flowLink: { findMany: vi.fn(async ({ where }: { where: { flowId: string; nodeId: string } }) => state.links.filter((l) => l.flowId === where.flowId && l.nodeId === where.nodeId)) },
    contactTag: {
      findUnique: vi.fn(async ({ where }: { where: { contactId_name: { name: string } } }) =>
        state.tags.has(where.contactId_name.name) ? { id: "tag" } : null
      ),
    },
    flowLinkClick: { findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => state.clicks.find((c) => matches(c, where)) ?? null) },
    operationalEvent: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => state.events.push(data)) },
  };
  return {
    state,
    prisma,
    add: vi.fn(),
    sendFlowMessage: vi.fn(),
    sendImageMessage: vi.fn(),
    follows: vi.fn(),
    tracked: vi.fn(),
    dmSlot: vi.fn(),
    flowSlot: vi.fn(),
    reserve: vi.fn(),
    release: vi.fn(),
    addTag: vi.fn(),
    removeTag: vi.fn(),
    recordEvent: vi.fn(),
    createDraft: vi.fn(),
    startTakeover: vi.fn(),
  };
});

vi.mock("@/lib/db/client", () => ({ prisma: h.prisma }));
vi.mock("@/lib/queue/client", () => ({ getDMQueue: () => ({ add: h.add }) }));
vi.mock("@/lib/meta/client", () => ({
  sendFlowMessage: h.sendFlowMessage,
  sendImageMessage: h.sendImageMessage,
  getUserFollowStatus: h.follows,
  MetaApiError: class MetaApiError extends Error {
    code: number;
    constructor(code: number, message: string) {
      super(message);
      this.code = code;
      this.name = "MetaApiError";
    }
  },
}));
vi.mock("@/lib/meta/send", () => ({
  sendTracked: vi.fn(async (ctx: unknown, send: (o: unknown) => Promise<unknown>) => {
    h.tracked(ctx);
    return send({ metadata: "le:flow:row" });
  }),
}));
vi.mock("@/lib/meta/oauth", () => ({ decryptToken: () => "token" }));
vi.mock("@/lib/utils/rate-limiter", () => ({ reserveDMSlot: h.dmSlot, reserveFlowSlot: h.flowSlot }));
vi.mock("@/lib/billing/usage", () => ({ reserveWorkspaceDMSend: h.reserve, releaseWorkspaceDMReservation: h.release }));
vi.mock("@/lib/contacts/record", () => ({
  addTag: h.addTag,
  removeTag: h.removeTag,
  recordEvent: h.recordEvent,
  normalizeTagName: (n: string) => n.trim(),
  upsertContact: vi.fn(async () => ({ id: "ct_1", workspaceId: "ws_1" })),
  clearAccountCache: vi.fn(),
}));
vi.mock("@/lib/drafts/drafts", () => ({ createDraft: h.createDraft }));
vi.mock("@/lib/messaging/takeover", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/messaging/takeover")>();
  return { ...real, startTakeover: h.startTakeover };
});

import { runFlowStepJob, runReplyTimeout, startFlowRun } from "../lib/flows/engine";
import { routeFlowTap } from "../lib/flows/dispatch";
import type { FlowNode } from "../lib/flows/schema";
import { ChannelOffError } from "../lib/channels/status";

const NOW = Date.now();

function setFlow(trigger: Record<string, unknown>, nodes: FlowNode[], over: Record<string, unknown> = {}) {
  h.state.flows.set("f_1", {
    id: "f_1",
    name: "Fluxo teste",
    workspaceId: "ws_1",
    instagramAccountId: "acc_1",
    isActive: true,
    publishedVersion: 1,
    enteredCount: 0,
    completedCount: 0,
    published: { trigger: { keywords: ["OI"], ...trigger }, nodes },
    instagramAccount: { id: "acc_1", instagramId: "ig_1", accessToken: "enc", status: "ACTIVE" },
    ...over,
  });
}
const msg = (id: string, text: string, extra: Record<string, unknown> = {}) =>
  ({ id, type: "message", text, imageUrl: null, buttons: [], next: null, ...extra }) as FlowNode;
const start = (over: Record<string, unknown> = {}) =>
  startFlowRun({
    instagramAccountId: "ig_1",
    flowId: "f_1",
    kind: "DM",
    triggerKey: "dm:mid_1",
    triggerRef: "mid_1",
    igUserId: "u_1",
    inboundAt: NOW,
    ...over,
  } as Parameters<typeof startFlowRun>[0]);
const run = () => [...h.state.runs.values()][0] as Run;
const outcomes = () => h.state.steps.map((s) => `${s.nodeId}:${s.outcome}`);
const lastJob = () => h.add.mock.calls.at(-1) as [string, Record<string, unknown>, Record<string, unknown>];

beforeEach(() => {
  vi.clearAllMocks();
  h.state.flows.clear();
  h.state.runs.clear();
  h.state.steps.length = 0;
  h.state.tags.clear();
  h.state.clicks.length = 0;
  h.state.links.length = 0;
  h.state.events.length = 0;
  h.state.contact = {
    id: "ct_1",
    workspaceId: "ws_1",
    igUserId: "u_1",
    username: "maria",
    name: "Maria Silva",
    lastInboundAt: new Date(NOW),
    humanTakeover: false,
    humanTakeoverUntil: null,
  };
  h.sendFlowMessage.mockResolvedValue({ message_id: "mid_out" });
  h.sendImageMessage.mockResolvedValue({ message_id: "mid_img" });
  h.dmSlot.mockResolvedValue({ allowed: true });
  h.flowSlot.mockResolvedValue({ allowed: true });
  h.reserve.mockResolvedValue({ allowed: true, periodStart: new Date(), limit: 1000 });
  h.release.mockResolvedValue({});
  h.recordEvent.mockResolvedValue(true);
  h.addTag.mockResolvedValue(true);
  h.removeTag.mockResolvedValue(true);
  h.add.mockResolvedValue({});
  h.follows.mockResolvedValue(true);
});

describe("message -> wait -> message -> end (DM trigger)", () => {
  it("sends with {first_name}, origin flow, waits through a delayed job, then finishes", async () => {
    setFlow({ type: "DM", next: "m1" }, [
      msg("m1", "Oi {first_name}!", { next: "w" }),
      { id: "w", type: "wait", mode: "delay", minutes: 10, next: "m2" },
      msg("m2", "Tudo certo, @{username}?", { next: "fim" }),
      { id: "fim", type: "end" },
    ]);
    expect(await start()).toBe("paused");
    expect(h.sendFlowMessage).toHaveBeenCalledWith("token", "ig_1", { id: "u_1" }, "Oi Maria!", [], { metadata: "le:flow:row" });
    expect(h.tracked).toHaveBeenCalledWith(expect.objectContaining({ origin: "flow", refId: run().id, contactIgUserId: "u_1" }));
    expect(h.flowSlot).toHaveBeenCalledWith("ig_1");
    expect(h.dmSlot).not.toHaveBeenCalled();
    expect(run()).toMatchObject({ status: "WAITING_DELAY", currentNodeId: "m2", stepCount: 2 });
    const [name, data, opts] = lastJob();
    expect(name).toBe("flow-step");
    expect(data).toMatchObject({ runId: run().id, nodeId: "m2", seq: 2 });
    expect(opts).toMatchObject({ delay: 600_000, jobId: `flowstep_${run().id}_2`, attempts: 1 });

    expect(await runFlowStepJob(data as never)).toBe("DONE");
    expect(h.sendFlowMessage).toHaveBeenLastCalledWith("token", "ig_1", { id: "u_1" }, "Tudo certo, @maria?", [], expect.anything());
    expect(run()).toMatchObject({ status: "DONE", stopReason: "end" });
    expect(h.state.flows.get("f_1")).toMatchObject({ enteredCount: 1, completedCount: 1 });
    expect(outcomes()).toEqual(["trigger:entered", "m1:sent", "w:waiting", "m2:sent", "fim:done"]);
    // The same delayed job again (duplicate) finds nothing to claim.
    h.sendFlowMessage.mockClear();
    expect(await runFlowStepJob(data as never)).toBe("noop");
    expect(h.sendFlowMessage).not.toHaveBeenCalled();
  });

  it("a mention flow runs once per person (like mention campaigns)", async () => {
    setFlow({ type: "STORY_MENTION", keywords: [], next: "m1" }, [msg("m1", "Valeu pela menção!")]);
    expect(await start({ kind: "STORY_MENTION", triggerKey: "mention:a" })).toBe("DONE");
    expect(await start({ kind: "STORY_MENTION", triggerKey: "mention:b" })).toBe("duplicate");
    expect(h.sendFlowMessage).toHaveBeenCalledTimes(1);
  });

  it("the same event twice never starts two runs", async () => {
    setFlow({ type: "DM", next: "m1" }, [msg("m1", "oi", { buttons: [{ id: "b", kind: "next", label: "Ok", next: "m1" }] })]);
    await start();
    expect(await start()).toBe("duplicate");
    expect(await start({ triggerKey: "dm:mid_2" })).toBe("duplicate"); // already open in this flow
    expect(h.sendFlowMessage).toHaveBeenCalledTimes(1);
  });
});

describe("comment trigger: private reply, then the tap opens the window", () => {
  it("first message answers the comment (Meta bucket), waits for the tap, then sends the tracked link", async () => {
    h.state.contact.lastInboundAt = null;
    setFlow({ type: "COMMENT", matchAnyPost: true, keywords: ["FOTO"], next: "m1" }, [
      msg("m1", "Oi {first_name}! Toca aqui", { buttons: [{ id: "b1", kind: "next", label: "Quero", next: "m2" }] }),
      msg("m2", "Teu link", { buttons: [{ id: "l1", kind: "link", label: "Abrir", url: "https://example.com/a" }] }),
    ]);
    h.state.links.push({ flowId: "f_1", nodeId: "m2", buttonId: "l1", slug: "abc123" });
    expect(await start({ kind: "COMMENT", triggerKey: "comment:c_1", triggerRef: "c_1", inboundAt: null })).toBe("paused");
    const id = run().id;
    expect(h.sendFlowMessage).toHaveBeenCalledWith(
      "token",
      "ig_1",
      { comment_id: "c_1" },
      "Oi Maria! Toca aqui",
      [{ kind: "postback", title: "Quero", payload: `flow:${id}:m2` }],
      expect.anything()
    );
    expect(h.dmSlot).toHaveBeenCalledWith("ig_1", 3);
    expect(run()).toMatchObject({ status: "WAITING_TAP", currentNodeId: "m1", privateReplyUsed: true, triggerCommentId: "c_1" });

    // A tap on the button (webhook postback -> routeFlowTap -> flow-step job).
    expect(await routeFlowTap({ instagramId: "ig_1", igUserId: "u_1", payload: `flow:${id}:m2`, at: new Date(NOW) })).toBe("moved");
    const [, data] = lastJob();
    expect(await runFlowStepJob(data as never)).toBe("DONE");
    const [, , recipient, , buttons] = h.sendFlowMessage.mock.calls[1];
    expect(recipient).toEqual({ id: "u_1" });
    expect(buttons[0]).toMatchObject({ kind: "link", title: "Abrir" });
    expect(buttons[0].url).toMatch(/\/r\/abc123\?c=u_1\./);
    // A second (stale) tap does nothing.
    expect(await routeFlowTap({ instagramId: "ig_1", igUserId: "u_1", payload: `flow:${id}:m2`, at: new Date() })).toBe("ignored");
  });

  it("a second message without a tap stops at the closed window (nothing sent outside it)", async () => {
    h.state.contact.lastInboundAt = null;
    setFlow({ type: "COMMENT", matchAnyPost: true, next: "m1" }, [msg("m1", "um", { next: "m2" }), msg("m2", "dois")]);
    expect(await start({ kind: "COMMENT", triggerKey: "comment:c_1", triggerRef: "c_1", inboundAt: null })).toBe("STOPPED_WINDOW");
    expect(h.sendFlowMessage).toHaveBeenCalledTimes(1);
    expect(run()).toMatchObject({ status: "STOPPED_WINDOW", stopReason: "window_closed", currentNodeId: "m2" });
  });
});

describe("guards", () => {
  beforeEach(() => setFlow({ type: "DM", next: "m1" }, [msg("m1", "oi")]));

  it("closed window: nothing is sent", async () => {
    h.state.contact.lastInboundAt = new Date(NOW - 2 * 86_400_000);
    expect(await start({ inboundAt: null })).toBe("STOPPED_WINDOW");
    expect(h.sendFlowMessage).not.toHaveBeenCalled();
    expect(h.reserve).not.toHaveBeenCalled();
  });

  it("human takeover: nothing is sent", async () => {
    h.state.contact.humanTakeover = true;
    h.state.contact.humanTakeoverUntil = new Date(NOW + 3_600_000);
    expect(await start()).toBe("STOPPED_TAKEOVER");
    expect(h.sendFlowMessage).not.toHaveBeenCalled();
  });

  it("channel off (disconnected): nothing starts", async () => {
    setFlow({ type: "DM", next: "m1" }, [msg("m1", "oi")], {
      instagramAccount: { id: "acc_1", instagramId: "ig_1", accessToken: "enc", status: "DISCONNECTED" },
    });
    expect(await start()).toBe("skipped");
    expect(h.state.runs.size).toBe(0);
  });

  it("channel turned off mid-send (sendTracked refuses): STOPPED_OFF, quota given back", async () => {
    h.sendFlowMessage.mockRejectedValue(new ChannelOffError("channel_disconnected"));
    expect(await start()).toBe("STOPPED_OFF");
    expect(h.release).toHaveBeenCalled();
  });

  it("flow turned off while a run waits: the next step stops it", async () => {
    setFlow({ type: "DM", next: "w" }, [{ id: "w", type: "wait", mode: "delay", minutes: 5, next: "m1" }, msg("m1", "oi")]);
    await start();
    h.state.flows.get("f_1")!.isActive = false;
    const [, data] = lastJob();
    expect(await runFlowStepJob(data as never)).toBe("STOPPED_OFF");
    expect(h.sendFlowMessage).not.toHaveBeenCalled();
  });

  it("hourly ceiling and monthly quota stop the run", async () => {
    h.flowSlot.mockResolvedValue({ allowed: false });
    expect(await start()).toBe("STOPPED_LIMIT");
    h.state.runs.clear();
    h.flowSlot.mockResolvedValue({ allowed: true });
    h.reserve.mockResolvedValue({ allowed: false, limit: 10 });
    expect(await start({ triggerKey: "dm:mid_9" })).toBe("STOPPED_LIMIT");
    expect(h.sendFlowMessage).not.toHaveBeenCalled();
  });

  it("Meta's ambiguous error ends the run as maybe_sent and is never resent", async () => {
    const { MetaApiError } = (await import("@/lib/meta/client")) as unknown as { MetaApiError: new (c: number, m: string) => Error };
    h.sendFlowMessage.mockRejectedValue(new MetaApiError(1, "An unknown error has occurred"));
    expect(await start()).toBe("FAILED");
    expect(run()).toMatchObject({ status: "FAILED", stopReason: "maybe_sent" });
    expect(outcomes()).toContain("m1:maybe_sent");
    expect(h.sendFlowMessage).toHaveBeenCalledTimes(1);
  });

  it("a person mid-way in another flow does not start a second one", async () => {
    h.state.runs.set("other", { id: "other", flowId: "f_other", contactId: "ct_1", status: "WAITING_DELAY", triggerKey: "x", stepCount: 1, currentNodeId: "a", updatedAt: new Date() });
    expect(await start()).toBe("busy");
    expect(h.sendFlowMessage).not.toHaveBeenCalled();
  });

  it("a loop is capped at the step limit", async () => {
    setFlow({ type: "DM", next: "a" }, [
      { id: "a", type: "action", action: { kind: "add_tag", tag: "x" }, next: "b" },
      { id: "b", type: "action", action: { kind: "remove_tag", tag: "x" }, next: "a" },
    ]);
    expect(await start()).toBe("STOPPED_LIMIT");
    expect(run()).toMatchObject({ stopReason: "max_steps", stepCount: 30 });
  });
});

describe("conditions and actions", () => {
  it("has_tag yes/no, add/remove tag, notify the owner, propose a draft (never sent) and hand off", async () => {
    h.state.tags.add("vip");
    h.createDraft.mockResolvedValue({ ok: true, draft: { id: "dr_1" } });
    setFlow({ type: "DM", next: "c" }, [
      { id: "c", type: "condition", check: { kind: "has_tag", tag: "vip" }, yes: "t", no: "fim" },
      { id: "t", type: "action", action: { kind: "add_tag", tag: "fluxo:vip" }, next: "n" },
      { id: "n", type: "action", action: { kind: "notify_owner", note: "VIP chegou" }, next: "d" },
      { id: "d", type: "action", action: { kind: "propose_draft", text: "Oi {first_name}, posso te ajudar?" }, next: "h" },
      { id: "h", type: "action", action: { kind: "handoff", hours: 12 } },
      { id: "fim", type: "end" },
    ]);
    expect(await start()).toBe("paused");
    expect(outcomes()).toEqual(["trigger:entered", "c:yes", "t:tagged", "n:notified", "d:proposed", "h:handed_off"]);
    expect(h.addTag).toHaveBeenCalledWith({ id: "ct_1", workspaceId: "ws_1" }, "fluxo:vip", "auto", expect.any(Date));
    expect(h.state.events[0]).toMatchObject({ source: "SYSTEM", level: "INFO", payload: { kind: "flow_notify", flowId: "f_1", contactId: "ct_1" } });
    expect(h.createDraft).toHaveBeenCalledWith(expect.objectContaining({ origin: "flow", text: "Oi Maria, posso te ajudar?", contactId: "ct_1" }));
    expect(h.startTakeover).toHaveBeenCalledWith(expect.objectContaining({ contactId: "ct_1", reason: "flow", hours: 12 }));
    expect(run()).toMatchObject({ status: "HANDED_OFF" });
    expect(h.state.flows.get("f_1")).toMatchObject({ completedCount: 1 });
    // Nothing went out as a DM: the draft waits for a human.
    expect(h.sendFlowMessage).not.toHaveBeenCalled();
  });

  it("follows? null from Meta counts as no; clicked? looks at this run's clicks", async () => {
    h.follows.mockResolvedValue(null);
    setFlow({ type: "DM", next: "c" }, [
      { id: "c", type: "condition", check: { kind: "follows" }, yes: "fim", no: "k" },
      { id: "k", type: "condition", check: { kind: "clicked", nodeId: null }, yes: "fim", no: "fim" },
      { id: "fim", type: "end" },
    ]);
    expect(await start()).toBe("DONE");
    expect(outcomes()).toEqual(["trigger:entered", "c:no", "k:no", "fim:done"]);
  });
});

describe("waits", () => {
  it("a delay that would end after the window stops the run with a clear reason", async () => {
    h.state.contact.lastInboundAt = new Date(NOW - 23 * 3_600_000);
    setFlow({ type: "DM", next: "w" }, [{ id: "w", type: "wait", mode: "delay", minutes: 120, next: "m" }, msg("m", "oi")]);
    expect(await start({ inboundAt: null })).toBe("STOPPED_WINDOW");
    expect(run()).toMatchObject({ stopReason: "wait_beyond_window" });
  });

  it("wait for reply parks the run and schedules the timeout; the timeout goes to onTimeout or ends", async () => {
    setFlow({ type: "DM", next: "w" }, [
      { id: "w", type: "wait", mode: "reply", timeoutMinutes: 60, next: "m", onTimeout: "lembrete" },
      msg("m", "valeu"),
      msg("lembrete", "Ainda tá aí?"),
    ]);
    expect(await start()).toBe("paused");
    expect(run()).toMatchObject({ status: "WAITING_REPLY", currentNodeId: "w" });
    const [name, data, opts] = lastJob();
    expect(name).toBe("flow-reply-timeout");
    expect(opts).toMatchObject({ delay: 3_600_000 });
    expect(await runReplyTimeout(data as never)).toBe("DONE");
    expect(h.sendFlowMessage).toHaveBeenCalledWith("token", "ig_1", { id: "u_1" }, "Ainda tá aí?", [], expect.anything());
    // A late timeout for the same wait does nothing.
    expect(await runReplyTimeout(data as never)).toBe("noop");
  });
});

// ─── QA (Etapa 3): caminho completo e travas no meio do caminho ─────────────
describe("QA: gatilho -> mensagem -> botão -> condição -> etiqueta -> espera -> fim", () => {
  const fullFlow = () =>
    setFlow({ type: "COMMENT", matchAnyPost: true, keywords: ["FOTO"], next: "m1" }, [
      msg("m1", "Oi {first_name}! Quer o material?", {
        buttons: [
          { id: "sim", kind: "next", label: "Quero", next: "c1" },
          { id: "nao", kind: "next", label: "Agora não", next: "mNao" },
        ],
      }),
      { id: "c1", type: "condition", check: { kind: "has_tag", tag: "cliente" }, yes: "fim", no: "a1" },
      { id: "a1", type: "action", action: { kind: "add_tag", tag: "lead-foto" }, next: "w1" },
      { id: "w1", type: "wait", mode: "delay", minutes: 30, next: "m2" },
      msg("m2", "Chegou o teu material, @{username}", { next: "fim" }),
      msg("mNao", "Beleza!", { next: "fim" }),
      { id: "fim", type: "end" },
    ]);

  it("runs end to end; the tapped button leads to ITS node; the other button becomes stale", async () => {
    h.state.contact.lastInboundAt = null;
    fullFlow();
    expect(await start({ kind: "COMMENT", triggerKey: "comment:c_9", triggerRef: "c_9", inboundAt: null })).toBe("paused");
    const id = run().id;
    // Private reply with the two postback buttons, each pointing at its own node.
    expect(h.sendFlowMessage.mock.calls[0][2]).toEqual({ comment_id: "c_9" });
    expect(h.sendFlowMessage.mock.calls[0][4]).toEqual([
      { kind: "postback", title: "Quero", payload: `flow:${id}:c1` },
      { kind: "postback", title: "Agora não", payload: `flow:${id}:mNao` },
    ]);
    expect(run()).toMatchObject({ status: "WAITING_TAP", currentNodeId: "m1" });

    // A forged payload to a node that is not a button of this step: ignored.
    expect(await routeFlowTap({ instagramId: "ig_1", igUserId: "u_1", payload: `flow:${id}:m2`, at: new Date(NOW) })).toBe("ignored");
    // Someone else tapping (forwarded message): ignored.
    expect(await routeFlowTap({ instagramId: "ig_1", igUserId: "u_2", payload: `flow:${id}:c1`, at: new Date(NOW) })).toBe("ignored");
    // The person taps "Quero" -> c1 (not mNao).
    const tapAt = new Date(NOW);
    expect(await routeFlowTap({ instagramId: "ig_1", igUserId: "u_1", payload: `flow:${id}:c1`, at: tapAt })).toBe("moved");
    expect(run()).toMatchObject({ status: "ACTIVE", currentNodeId: "c1" });
    const [, tapJob] = lastJob();
    expect(tapJob).toMatchObject({ nodeId: "c1", inboundAt: tapAt.getTime() });
    // A second tap on the same message (the other button): stale.
    expect(await routeFlowTap({ instagramId: "ig_1", igUserId: "u_1", payload: `flow:${id}:mNao`, at: new Date(NOW) })).toBe("ignored");

    // Condition (no tag) -> add tag -> 30 min wait (inside the window the tap opened).
    expect(await runFlowStepJob(tapJob as never)).toBe("paused");
    expect(h.addTag).toHaveBeenCalledWith({ id: "ct_1", workspaceId: "ws_1" }, "lead-foto", "auto", expect.any(Date));
    expect(run()).toMatchObject({ status: "WAITING_DELAY", currentNodeId: "m2" });
    const [name, waitJob, opts] = lastJob();
    expect(name).toBe("flow-step");
    expect(opts).toMatchObject({ delay: 30 * 60_000, attempts: 1 });

    // Running the same tap job again (duplicate) does nothing.
    expect(await runFlowStepJob(tapJob as never)).toBe("noop");

    expect(await runFlowStepJob(waitJob as never)).toBe("DONE");
    expect(h.sendFlowMessage).toHaveBeenCalledTimes(2);
    expect(h.sendFlowMessage.mock.calls[1][2]).toEqual({ id: "u_1" });
    expect(h.sendFlowMessage.mock.calls[1][3]).toBe("Chegou o teu material, @maria");
    expect(outcomes()).toEqual([
      "trigger:entered",
      "m1:sent",
      "m1:tapped",
      "c1:no",
      "a1:tagged",
      "w1:waiting",
      "m2:sent",
      "fim:done",
    ]);
    expect(h.state.flows.get("f_1")).toMatchObject({ enteredCount: 1, completedCount: 1 });
    expect(h.createDraft).not.toHaveBeenCalled();
  });

  it("the window closing during a wait stops the run when it wakes up (nothing sent)", async () => {
    setFlow({ type: "DM", next: "w" }, [{ id: "w", type: "wait", mode: "delay", minutes: 60, next: "m" }, msg("m", "oi")]);
    h.state.contact.lastInboundAt = new Date(NOW - 22 * 3_600_000);
    expect(await start({ inboundAt: null })).toBe("paused");
    const [, data] = lastJob();
    // The job is late (worker down): when it runs the window is already closed.
    h.state.contact.lastInboundAt = new Date(NOW - 25 * 3_600_000);
    expect(await runFlowStepJob({ ...(data as object), inboundAt: null } as never)).toBe("STOPPED_WINDOW");
    expect(h.sendFlowMessage).not.toHaveBeenCalled();
    expect(run()).toMatchObject({ status: "STOPPED_WINDOW", stopReason: "window_closed" });
  });

  it("takeover or channel off during a wait stop the run on wake-up (nothing sent)", async () => {
    setFlow({ type: "DM", next: "w" }, [{ id: "w", type: "wait", mode: "delay", minutes: 5, next: "m" }, msg("m", "oi")]);
    await start();
    const [, data] = lastJob();
    h.state.contact.humanTakeover = true;
    h.state.contact.humanTakeoverUntil = new Date(Date.now() + 3_600_000);
    expect(await runFlowStepJob(data as never)).toBe("STOPPED_TAKEOVER");

    h.state.runs.clear();
    h.state.contact.humanTakeover = false;
    h.state.contact.humanTakeoverUntil = null;
    await start({ triggerKey: "dm:mid_2" });
    const [, data2] = lastJob();
    (h.state.flows.get("f_1")!.instagramAccount as Record<string, unknown>).status = "DISCONNECTED";
    expect(await runFlowStepJob(data2 as never)).toBe("STOPPED_OFF");
    expect(run()).toMatchObject({ stopReason: "channel_off" });
    expect(h.sendFlowMessage).not.toHaveBeenCalled();
  });

  it("one event never starts two different flows (same triggerKey, e.g. a DM that also opened an ig.me link)", async () => {
    setFlow({ type: "DM", next: "m1" }, [msg("m1", "oi")]);
    expect(await start()).toBe("DONE");
    h.state.flows.set("f_2", { ...h.state.flows.get("f_1")!, id: "f_2" });
    expect(await start({ flowId: "f_2", kind: "CONVERSATION_LINK" })).toBe("duplicate");
    expect(h.sendFlowMessage).toHaveBeenCalledTimes(1);
  });

  it("each step is one row in the report: a last message without an end step is not counted twice", async () => {
    setFlow({ type: "DM", next: "m1" }, [msg("m1", "oi")]);
    expect(await start()).toBe("DONE");
    expect(outcomes()).toEqual(["trigger:entered", "m1:sent"]);
    expect(run()).toMatchObject({ status: "DONE", stopReason: "end" });
    expect(h.state.flows.get("f_1")).toMatchObject({ completedCount: 1 });
  });

  it("a refused draft proposal (takeover / closed window) never sends anything and the run goes on", async () => {
    h.createDraft.mockResolvedValue({ ok: false, status: 409, code: "takeover" });
    setFlow({ type: "DM", next: "d" }, [
      { id: "d", type: "action", action: { kind: "propose_draft", text: "Oi" }, next: "fim" },
      { id: "fim", type: "end" },
    ]);
    expect(await start()).toBe("DONE");
    expect(outcomes()).toContain("d:skipped");
    expect(h.sendFlowMessage).not.toHaveBeenCalled();
  });
});

// ─── Etapa 5: a flow started by a broadcast button ──────────────────────────

describe("Etapa 5: flow started by a broadcast button (kind BROADCAST)", () => {
  const commentFlow = (nodes: FlowNode[]) => setFlow({ type: "COMMENT", matchAnyPost: true, keywords: ["FOTO"], next: nodes[0].id }, nodes);
  const bc = (over: Record<string, unknown> = {}) =>
    start({ kind: "BROADCAST", triggerKey: "bc:rcp_1:b1", triggerRef: "rcp_1", inboundAt: NOW, ...over });

  it("never private-replies, even when the flow's own trigger is a comment", async () => {
    commentFlow([msg("m1", "Oi {first_name}!", { next: "fim" }), { id: "fim", type: "end" } as FlowNode]);
    expect(await bc()).toBe("DONE");
    expect(run().triggerCommentId).toBeNull();
    expect(h.sendFlowMessage).toHaveBeenCalledWith("token", "ig_1", { id: "u_1" }, "Oi Maria!", [], expect.anything());
    // The DM bucket of the flows, not Meta's private-reply bucket.
    expect(h.flowSlot).toHaveBeenCalledWith("ig_1");
    expect(h.dmSlot).not.toHaveBeenCalled();
  });

  it("a delay wait still has to fit inside the window the tap opened", async () => {
    h.state.contact.lastInboundAt = new Date(NOW - 23 * 3_600_000);
    commentFlow([
      { id: "w", type: "wait", mode: "delay", minutes: 120, next: "m1" } as FlowNode,
      msg("m1", "Depois"),
    ]);
    expect(await bc({ inboundAt: NOW - 23 * 3_600_000 })).toBe("STOPPED_WINDOW");
    expect(run()).toMatchObject({ stopReason: "wait_beyond_window" });
    expect(h.sendFlowMessage).not.toHaveBeenCalled();
  });

  it("with the window closed nothing goes out", async () => {
    h.state.contact.lastInboundAt = new Date(NOW - 25 * 3_600_000);
    commentFlow([msg("m1", "Oi")]);
    expect(await bc({ inboundAt: null })).toBe("STOPPED_WINDOW");
    expect(h.sendFlowMessage).not.toHaveBeenCalled();
  });

  it("the same broadcast button twice starts the flow once", async () => {
    setFlow({ type: "DM", next: "m1" }, [msg("m1", "Oi", { buttons: [{ id: "x", kind: "next", label: "Ok", next: "m2" }] }), msg("m2", "Fim")]);
    expect(await bc()).toBe("paused");
    expect(await bc()).toBe("duplicate");
    expect(h.sendFlowMessage).toHaveBeenCalledTimes(1);
  });
});
