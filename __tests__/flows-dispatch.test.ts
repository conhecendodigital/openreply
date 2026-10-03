/**
 * Etapa 3: quem entra em qual fluxo (dispatch), toque de botão e "aguardar
 * resposta". Nada aqui lança, e com todos os fluxos desligados nada é
 * enfileirado (as campanhas seguem sozinhas).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  prisma: {
    flow: { findMany: vi.fn(), update: vi.fn() },
    flowRun: { findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    flowStep: { create: vi.fn() },
  },
  add: vi.fn(),
}));
vi.mock("@/lib/db/client", () => ({ prisma: h.prisma }));
vi.mock("@/lib/queue/client", () => ({ getDMQueue: () => ({ add: h.add }) }));

import {
  activeFlowKeywordGuards,
  dispatchFlowEvent,
  pickFlow,
  resumeFlowOnReply,
  routeFlowTap,
  type FlowEvent,
  type FlowTriggerRow,
} from "../lib/flows/dispatch";

const row = (over: Partial<FlowTriggerRow>): FlowTriggerRow => ({
  id: "f",
  triggerType: "COMMENT",
  triggerPostId: null,
  triggerMatchAnyPost: false,
  triggerStoryId: null,
  conversationLinkId: null,
  keywords: [],
  matchAnyWord: false,
  wholeWordMatch: true,
  ...over,
});
const event = (over: Partial<FlowEvent>): FlowEvent => ({
  kinds: ["COMMENT"],
  instagramId: "ig_1",
  igUserId: "u_1",
  text: "quero FOTO",
  mediaId: "media_1",
  triggerKey: "comment:c_1",
  triggerRef: "c_1",
  ...over,
});

const published = {
  trigger: { type: "DM", keywords: ["OI"], next: "m1" },
  nodes: [
    { id: "m1", type: "message", text: "oi", buttons: [{ id: "b", kind: "next", label: "Quero", next: "m2" }] },
    { id: "m2", type: "message", text: "link", next: "w" },
    { id: "w", type: "wait", mode: "reply", next: "m3" },
    { id: "m3", type: "message", text: "valeu" },
    { id: "w2", type: "wait", mode: "reply" },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  h.add.mockResolvedValue({});
  h.prisma.flowStep.create.mockResolvedValue({});
  h.prisma.flow.update.mockResolvedValue({});
});

describe("which flow takes an event", () => {
  it("post-specific or any-post, with the words", () => {
    const flows = [
      row({ id: "other_post", triggerPostId: "media_2", keywords: ["FOTO"] }),
      row({ id: "this_post", triggerPostId: "media_1", keywords: ["FOTO"] }),
    ];
    expect(pickFlow(flows, event({}))?.flow.id).toBe("this_post");
    expect(pickFlow([row({ triggerMatchAnyPost: true, keywords: ["FOTO"] })], event({}))?.flow.id).toBe("f");
    expect(pickFlow([row({ triggerMatchAnyPost: true, keywords: ["VIDEO"] })], event({}))).toBeNull();
    // A comment on an ad matches the organic post too.
    expect(pickFlow([row({ triggerPostId: "media_1", keywords: ["FOTO"] })], event({ mediaId: "ad_9", originalMediaId: "media_1" }))).not.toBeNull();
  });

  it("oldest flow first (1 event = 1 flow), the story-bound one before any-story", () => {
    const two = [row({ id: "old", triggerMatchAnyPost: true, matchAnyWord: true }), row({ id: "new", triggerMatchAnyPost: true, matchAnyWord: true })];
    expect(pickFlow(two, event({}))?.flow.id).toBe("old");
    const stories = [
      row({ id: "any", triggerType: "STORY_REPLY", matchAnyWord: true }),
      row({ id: "this", triggerType: "STORY_REPLY", triggerStoryId: "st_1", matchAnyWord: true }),
    ];
    expect(pickFlow(stories, event({ kinds: ["STORY_REPLY", "DM"], storyId: "st_1" }))?.flow.id).toBe("this");
  });

  it("a story reply falls back to DM flows; a link only matches its own flow", () => {
    const dm = [row({ id: "dm", triggerType: "DM", keywords: ["AMEI"] })];
    expect(pickFlow(dm, event({ kinds: ["STORY_REPLY", "DM"], text: "amei" }))).toMatchObject({ kind: "DM" });
    const links = [row({ id: "lk", triggerType: "CONVERSATION_LINK", conversationLinkId: "link_1" })];
    expect(pickFlow(links, event({ kinds: ["CONVERSATION_LINK"], conversationLinkId: "link_2" }))).toBeNull();
    expect(pickFlow(links, event({ kinds: ["CONVERSATION_LINK"], conversationLinkId: "link_1" }))?.flow.id).toBe("lk");
  });
});

describe("dispatchFlowEvent", () => {
  it("with no active flow (every flow is born off) nothing is queued", async () => {
    h.prisma.flow.findMany.mockResolvedValue([]);
    expect(await dispatchFlowEvent(event({}))).toEqual({ queued: false });
    expect(h.add).not.toHaveBeenCalled();
    const where = h.prisma.flow.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ isActive: true, instagramAccount: { instagramId: "ig_1", status: "ACTIVE" } });
  });

  it("queues a flow-start with a deterministic id, attempts 1, and never a commentId field", async () => {
    h.prisma.flow.findMany.mockResolvedValue([row({ id: "f_1", triggerMatchAnyPost: true, keywords: ["FOTO"] })]);
    expect(await dispatchFlowEvent(event({ username: "maria" }))).toEqual({ queued: true, flowId: "f_1" });
    const [name, data, opts] = h.add.mock.calls[0];
    expect(name).toBe("flow-start");
    expect(data).toMatchObject({ flowId: "f_1", kind: "COMMENT", triggerKey: "comment:c_1", triggerRef: "c_1", igUserId: "u_1", username: "maria" });
    expect("commentId" in data).toBe(false);
    expect(opts.jobId).toMatch(/^flowstart_f_1_/);
    expect(opts.jobId).not.toContain(":");
    expect(opts.attempts).toBe(1);
  });

  it("never throws: a database error queues nothing", async () => {
    h.prisma.flow.findMany.mockRejectedValue(new Error("db down"));
    expect(await dispatchFlowEvent(event({}))).toEqual({ queued: false });
    expect(h.add).not.toHaveBeenCalled();
  });

  it("moderation guards only take flows with real words", async () => {
    h.prisma.flow.findMany.mockResolvedValue([
      { keywords: ["FOTO"], wholeWordMatch: true, matchAnyWord: false },
      { keywords: [], wholeWordMatch: true, matchAnyWord: true },
    ]);
    expect(await activeFlowKeywordGuards("ig_1")).toEqual([{ keywords: ["FOTO"], wholeWordMatch: true, matchAnyWord: false }]);
    h.prisma.flow.findMany.mockRejectedValue(new Error("x"));
    expect(await activeFlowKeywordGuards("ig_1")).toEqual([]);
  });
});

describe("button taps", () => {
  const run = (over: Record<string, unknown> = {}) => ({
    id: "r_1",
    flowId: "f_1",
    igUserId: "u_1",
    status: "WAITING_TAP",
    currentNodeId: "m1",
    stepCount: 1,
    flow: { isActive: true, published, instagramAccount: { instagramId: "ig_1" } },
    ...over,
  });
  const tap = (payload = "flow:r_1:m2", igUserId = "u_1") => routeFlowTap({ instagramId: "ig_1", igUserId, payload, at: new Date(5000) });

  it("moves the run to the button's target (claimed) and queues the step with the tap time", async () => {
    h.prisma.flowRun.findUnique.mockResolvedValue(run());
    h.prisma.flowRun.updateMany.mockResolvedValue({ count: 1 });
    expect(await tap()).toBe("moved");
    expect(h.prisma.flowRun.updateMany).toHaveBeenCalledWith({
      where: { id: "r_1", status: "WAITING_TAP", currentNodeId: "m1", stepCount: 1 },
      data: { status: "ACTIVE", currentNodeId: "m2", waitingUntil: null },
    });
    expect(h.add).toHaveBeenCalledWith(
      "flow-step",
      { instagramAccountId: "ig_1", runId: "r_1", nodeId: "m2", seq: 1, inboundAt: 5000 },
      expect.objectContaining({ attempts: 1 })
    );
  });

  it("ignores stale taps, someone else's tap and a button the step does not have", async () => {
    h.prisma.flowRun.findUnique.mockResolvedValue(run({ status: "DONE" }));
    expect(await tap()).toBe("ignored");
    h.prisma.flowRun.findUnique.mockResolvedValue(run());
    expect(await tap("flow:r_1:m2", "intruso")).toBe("ignored");
    expect(await tap("flow:r_1:m3")).toBe("ignored");
    h.prisma.flowRun.updateMany.mockResolvedValue({ count: 0 });
    expect(await tap()).toBe("ignored");
    expect(h.add).not.toHaveBeenCalled();
  });
});

describe("wait for reply", () => {
  it("a reply resumes the waiting run at the next step", async () => {
    h.prisma.flowRun.findFirst.mockResolvedValue({ id: "r_1", flowId: "f_1", currentNodeId: "w", stepCount: 3, flow: { published } });
    h.prisma.flowRun.updateMany.mockResolvedValue({ count: 1 });
    expect(await resumeFlowOnReply({ instagramId: "ig_1", igUserId: "u_1", at: new Date(9000) })).toBe(true);
    expect(h.prisma.flowRun.updateMany.mock.calls[0][0]).toEqual({
      where: { id: "r_1", status: "WAITING_REPLY", currentNodeId: "w", stepCount: 3 },
      data: { status: "ACTIVE", currentNodeId: "m3", waitingUntil: null },
    });
    expect(h.add).toHaveBeenCalledWith("flow-step", expect.objectContaining({ nodeId: "m3", seq: 3, inboundAt: 9000 }), expect.anything());
  });

  it("a reply with nothing after the wait finishes the run", async () => {
    h.prisma.flowRun.findFirst.mockResolvedValue({ id: "r_1", flowId: "f_1", currentNodeId: "w2", stepCount: 3, flow: { published } });
    h.prisma.flowRun.updateMany.mockResolvedValue({ count: 1 });
    expect(await resumeFlowOnReply({ instagramId: "ig_1", igUserId: "u_1", at: new Date() })).toBe(true);
    expect(h.prisma.flowRun.updateMany.mock.calls[0][0].data).toMatchObject({ status: "DONE", stopReason: "replied" });
    expect(h.prisma.flow.update).toHaveBeenCalledWith({ where: { id: "f_1" }, data: { completedCount: { increment: 1 } } });
    expect(h.add).not.toHaveBeenCalled();
  });

  it("nobody waiting (or an error): false, so a new flow may start", async () => {
    h.prisma.flowRun.findFirst.mockResolvedValue(null);
    expect(await resumeFlowOnReply({ instagramId: "ig_1", igUserId: "u_1", at: new Date() })).toBe(false);
    h.prisma.flowRun.findFirst.mockRejectedValue(new Error("x"));
    expect(await resumeFlowOnReply({ instagramId: "ig_1", igUserId: "u_1", at: new Date() })).toBe(false);
  });
});
