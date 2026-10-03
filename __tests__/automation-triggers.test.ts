/**
 * Gatilhos novos de campanha na API (/api/automations) e no MCP: resposta de
 * story, menção no story, comentário em live e mensagem no Direct. Campos que
 * não valem pro gatilho são forçados (sem post, sem resposta pública fora de
 * post...) e o MCP continua criando tudo DESLIGADO.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  apiToken: false as boolean,
  prisma: {
    workspace: { findUnique: vi.fn(async () => ({ id: "ws" })) },
    instagramAccount: { findFirst: vi.fn(async () => ({ id: "acc_row" })) },
    automation: {
      create: vi.fn(async (a: { data: Record<string, unknown> }) => ({ id: "auto_new", ...a.data })),
      findFirst: vi.fn(),
      update: vi.fn(async (a: { data: Record<string, unknown> }) => ({ id: "auto_1", ...a.data })),
    },
    trackedLink: { findFirst: vi.fn(), findMany: vi.fn(async () => []) },
  },
}));

vi.mock("@/lib/db/client", () => ({ prisma: h.prisma }));
vi.mock("@/lib/auth", () => ({
  getCurrentWorkspaceId: vi.fn(async () => "ws"),
  isApiTokenRequest: vi.fn(async () => h.apiToken ?? false),
}));
vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext: vi.fn(async () => ({ workspaceId: "ws", userId: "u1", role: "OWNER" })),
  canManageWorkspace: () => true,
}));

import { PATCH, POST } from "../app/api/automations/route";
import { applyTriggerRules, triggerLabel } from "../lib/automations/trigger";
import { TOOLS, type InternalCall } from "../lib/mcp/server";

function req(method: string, body: unknown, query = "") {
  return new NextRequest(new URL(`/api/automations${query}`, "http://localhost"), {
    method,
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const created = () => h.prisma.automation.create.mock.calls[0][0].data as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("applyTriggerRules", () => {
  it("a non-post trigger drops the post, the public reply and (except live) the opening DM", () => {
    const data = applyTriggerRules(
      {
        postId: "p1",
        postUrl: "https://instagram.com/p/1",
        matchAnyPost: true,
        pendingNextReel: true,
        publicReplyEnabled: true,
        publicReplyMessages: ["oi"],
        openingDmEnabled: true,
        openingDmMessage: "abre",
        openingDmButtonLabel: "ok",
        dmTriggerEnabled: true,
      },
      "LIVE_COMMENT"
    );
    expect(data).toMatchObject({
      postId: null,
      matchAnyPost: false,
      pendingNextReel: false,
      publicReplyEnabled: false,
      publicReplyMessages: [],
      dmTriggerEnabled: false,
      // A live comment still starts with a private reply: the opening DM stays.
      openingDmEnabled: true,
    });
    expect(applyTriggerRules({ openingDmEnabled: true }, "STORY_REPLY").openingDmEnabled).toBe(false);
  });

  it("DM forces dmTriggerEnabled; a mention has no words; storyId only for story replies", () => {
    expect(applyTriggerRules({ dmTriggerEnabled: false }, "DM").dmTriggerEnabled).toBe(true);
    expect(applyTriggerRules({ keywords: ["x"], matchAnyWord: false }, "STORY_MENTION")).toMatchObject({ keywords: [], matchAnyWord: true });
    expect(applyTriggerRules({ storyId: "s1" }, "STORY_REPLY").storyId).toBe("s1");
    expect(applyTriggerRules({ storyId: "s1", storyUrl: "u" }, "DM")).toMatchObject({ storyId: null, storyUrl: null });
  });

  it("a post comment keeps everything as before", () => {
    const before = { postId: "p1", publicReplyEnabled: true, dmTriggerEnabled: true, openingDmEnabled: true };
    expect(applyTriggerRules({ ...before }, "COMMENT")).toMatchObject(before);
  });

  it("labels", () => {
    expect(triggerLabel({ trigger: "STORY_REPLY", storyId: null })).toBe("resposta de qualquer story");
    expect(triggerLabel({ trigger: "LIVE_COMMENT" })).toBe("comentário em qualquer live");
    expect(triggerLabel({ matchAnyPost: true })).toBe("comentário em qualquer post");
  });
});

describe("POST /api/automations", () => {
  it("a story mention needs no post and no keyword", async () => {
    const res = await POST(req("POST", { name: "Menção", trigger: "STORY_MENTION", dmMessage: "Valeu por marcar!" }));
    expect(res.status).toBe(201);
    expect(created()).toMatchObject({
      trigger: "STORY_MENTION",
      postId: null,
      matchAnyPost: false,
      keywords: [],
      matchAnyWord: true,
      dmTriggerEnabled: false,
      storyId: null,
    });
  });

  it("a story reply can target one story (or any)", async () => {
    await POST(
      req("POST", {
        name: "Story",
        trigger: "STORY_REPLY",
        keywords: ["QUERO"],
        storyId: "story_42",
        storyUrl: "https://instagram.com/stories/x/42",
        dmMessage: "Aqui!",
      })
    );
    expect(created()).toMatchObject({ trigger: "STORY_REPLY", storyId: "story_42", storyUrl: "https://instagram.com/stories/x/42", keywords: ["QUERO"] });
  });

  it("a story reply still needs words (or any word)", async () => {
    const res = await POST(req("POST", { name: "Story", trigger: "STORY_REPLY", dmMessage: "Aqui!" }));
    expect(res.status).toBe(400);
  });

  it("a live comment never gets a public reply, even if asked", async () => {
    await POST(
      req("POST", {
        name: "Live",
        trigger: "LIVE_COMMENT",
        keywords: ["link"],
        dmMessage: "Toma o link",
        publicReplyEnabled: true,
        publicReplyMessages: ["mandei no direct"],
        matchAnyPost: true,
      })
    );
    expect(created()).toMatchObject({ trigger: "LIVE_COMMENT", publicReplyEnabled: false, publicReplyMessages: [], matchAnyPost: false, postId: null });
  });

  it("a DM-only campaign is a DM trigger with dmTriggerEnabled on", async () => {
    await POST(req("POST", { name: "DM", trigger: "DM", keywords: ["oi"], dmMessage: "Olá" }));
    expect(created()).toMatchObject({ trigger: "DM", dmTriggerEnabled: true, postId: null });
  });

  it("a post comment still needs a post, as before (default trigger COMMENT)", async () => {
    const res = await POST(req("POST", { name: "Post", keywords: ["oi"], dmMessage: "Olá" }));
    expect(res.status).toBe(400);
    await POST(req("POST", { name: "Post", keywords: ["oi"], dmMessage: "Olá", matchAnyPost: true }));
    expect(created()).toMatchObject({ trigger: "COMMENT", matchAnyPost: true });
  });

  it("an unknown trigger is rejected", async () => {
    const res = await POST(req("POST", { name: "X", trigger: "REELS", keywords: ["oi"], dmMessage: "Olá" }));
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/automations", () => {
  const existing = {
    id: "auto_1",
    workspaceId: "ws",
    trigger: "COMMENT",
    postId: "p1",
    matchAnyPost: false,
    pendingNextReel: false,
  };

  it("switching a post campaign to a story reply drops the post", async () => {
    h.prisma.automation.findFirst.mockResolvedValue(existing);
    const res = await PATCH(req("PATCH", { trigger: "STORY_REPLY" }, "?id=auto_1"));
    expect(res.status).toBe(200);
    expect(h.prisma.automation.update.mock.calls[0][0].data).toMatchObject({
      trigger: "STORY_REPLY",
      postId: null,
      postUrl: null,
      matchAnyPost: false,
      pendingNextReel: false,
      publicReplyEnabled: false,
    });
  });

  it("switching back to a post comment without a post is refused", async () => {
    h.prisma.automation.findFirst.mockResolvedValue({ ...existing, trigger: "STORY_REPLY", postId: null });
    const res = await PATCH(req("PATCH", { trigger: "COMMENT" }, "?id=auto_1"));
    expect(res.status).toBe(400);
    expect(h.prisma.automation.update).not.toHaveBeenCalled();
  });

  it("editing a live campaign cannot turn the public reply on", async () => {
    h.prisma.automation.findFirst.mockResolvedValue({ ...existing, trigger: "LIVE_COMMENT", postId: null });
    await PATCH(req("PATCH", { publicReplyEnabled: true, publicReplyMessages: ["oi"] }, "?id=auto_1"));
    expect(h.prisma.automation.update.mock.calls[0][0].data).toMatchObject({ publicReplyEnabled: false, publicReplyMessages: [] });
  });

  it("an API key cannot change the trigger of a campaign that is ON (owner can)", async () => {
    h.prisma.automation.findFirst.mockResolvedValue({ ...existing, isActive: true });
    h.apiToken = true;
    try {
      const res = await PATCH(req("PATCH", { trigger: "STORY_MENTION" }, "?id=auto_1"));
      expect(res.status).toBe(409);
      expect(h.prisma.automation.update).not.toHaveBeenCalled();
      // Off, the key may edit it (it stays off until ativar_automacao).
      h.prisma.automation.findFirst.mockResolvedValue({ ...existing, isActive: false });
      const off = await PATCH(req("PATCH", { trigger: "STORY_MENTION" }, "?id=auto_1"));
      expect(off.status).toBe(200);
    } finally {
      h.apiToken = false;
    }
    h.prisma.automation.update.mockClear();
    h.prisma.automation.findFirst.mockResolvedValue({ ...existing, isActive: true });
    const owner = await PATCH(req("PATCH", { trigger: "STORY_MENTION" }, "?id=auto_1"));
    expect(owner.status).toBe(200);
  });

  it("editing a post campaign leaves its fields alone (no trigger sent)", async () => {
    h.prisma.automation.findFirst.mockResolvedValue(existing);
    await PATCH(req("PATCH", { name: "Novo nome" }, "?id=auto_1"));
    expect(h.prisma.automation.update.mock.calls[0][0].data).toEqual({ name: "Novo nome" });
  });
});

describe("MCP", () => {
  const tool = (name: string) => TOOLS.find((t) => t.name === name)!;

  it("criar_automacao accepts the new triggers and still creates it OFF", async () => {
    const call = vi.fn(async () => ({ status: 201, json: { success: true, data: { id: "a1", name: "Live" } } })) as unknown as InternalCall;
    const schema = tool("criar_automacao").inputSchema as { properties: Record<string, { enum?: string[] }> };
    expect(schema.properties.trigger.enum).toEqual(["COMMENT", "DM", "STORY_REPLY", "STORY_MENTION", "LIVE_COMMENT"]);
    expect(schema.properties.storyId).toBeDefined();

    await tool("criar_automacao").run({ name: "Live", trigger: "LIVE_COMMENT", keywords: ["link"], dmMessage: "toma", isActive: true }, call);
    expect(call).toHaveBeenCalledWith(
      "POST",
      "/api/automations",
      expect.objectContaining({ trigger: "LIVE_COMMENT", keywords: ["link"], isActive: false })
    );
  });

  it("editar_automacao passes trigger and storyId but never turns it on", async () => {
    const call = vi.fn(async () => ({ status: 200, json: { success: true, data: {} } })) as unknown as InternalCall;
    await tool("editar_automacao").run({ id: "a1", trigger: "STORY_REPLY", storyId: "s1", isActive: true }, call);
    expect(call).toHaveBeenCalledWith("PATCH", "/api/automations?id=a1", { trigger: "STORY_REPLY", storyId: "s1" });
  });

  it("listar_automacoes shows the trigger in Portuguese", async () => {
    const call = vi.fn(async () => ({
      status: 200,
      json: {
        success: true,
        data: [
          { id: "a1", name: "Menção", isActive: false, keywords: [], matchAnyPost: false, matchAnyWord: true, dmTriggerEnabled: false, postUrl: null, trigger: "STORY_MENTION" },
          { id: "a2", name: "Post", isActive: true, keywords: ["oi"], matchAnyPost: true, matchAnyWord: false, dmTriggerEnabled: true, postUrl: null },
        ],
      },
    })) as unknown as InternalCall;
    const res = await tool("listar_automacoes").run({}, call);
    const rows = JSON.parse(res.content[0].text);
    expect(rows[0]).toMatchObject({ gatilho: "menção no story", palavras: "sem palavra (menção)", tambemPorDm: false });
    expect(rows[1]).toMatchObject({ gatilho: "comentário em qualquer post", palavras: ["oi"], tambemPorDm: true });
  });
});
