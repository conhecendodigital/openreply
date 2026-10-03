/**
 * QA dos Canais (libs reais): com o canal desligado ou precisando reconectar,
 * a moderação não esconde nada, ninguém entra em sequência e rascunho não sai.
 * Nada é apagado.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
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
      return model(name);
    },
  });
  return {
    prisma: prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>,
    models,
    mockHide: vi.fn(),
    mockSend: vi.fn(),
  };
});

vi.mock("@/lib/db/client", () => ({ prisma: h.prisma }));
vi.mock("@/lib/meta/oauth", () => ({ decryptToken: (t: string) => `plain:${t}` }));
vi.mock("@/lib/meta/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/meta/client")>();
  return { ...real, hideComment: h.mockHide, sendDirectMessage: h.mockSend };
});
vi.mock("@/lib/queue/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/queue/client")>();
  return { ...real, getDMQueue: () => ({ add: vi.fn() }), getRedisConnection: vi.fn() };
});

import { moderateComment, setModerationHidden } from "../lib/moderation/moderate";
import { enrollInSequence } from "../lib/sequences/engine";
import { approveAndSend } from "../lib/drafts/drafts";

function writes() {
  const calls: string[] = [];
  for (const [name, methods] of h.models) {
    for (const method of ["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"]) {
      if (methods[method]?.mock.calls.length) calls.push(`${name}.${method}`);
    }
  }
  return calls;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.models.clear();
});

describe.each(["DISCONNECTED", "NEEDS_RECONNECT"] as const)("channel %s", (status) => {
  it("moderation of a new comment: OFF, nothing hidden, nothing written", async () => {
    h.prisma.instagramAccount.findUnique.mockResolvedValue({
      id: "acc_A",
      workspaceId: "ws_A",
      instagramId: "ig_owner",
      accessToken: "",
      status,
      moderationSettings: { mode: "HIDE" },
    });
    const outcome = await moderateComment({
      instagramAccountId: "ig_owner",
      commentId: "c1",
      commentText: "golpe! chama no zap",
      commenterId: "ig_x",
      mediaId: "m1",
    } as Parameters<typeof moderateComment>[0]);
    expect(outcome.action).toBe("OFF");
    expect(h.mockHide).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
  });

  it("hide/unhide by hand: 409, Meta not called, the record stays", async () => {
    h.prisma.commentModeration.findFirst.mockResolvedValue({
      id: "mod_1",
      action: "WOULD_HIDE",
      commentId: "c1",
      instagramAccount: { id: "acc_A", workspaceId: "ws_A", instagramId: "ig_owner", accessToken: "", status },
    });
    const result = await setModerationHidden({ workspaceId: "ws_A", moderationId: "mod_1", hidden: true } as Parameters<
      typeof setModerationHidden
    >[0]);
    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(h.mockHide).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
  });

  it("nobody new is enrolled in a sequence", async () => {
    const result = await enrollInSequence({
      automation: { id: "auto_1", workspaceId: "ws_A", instagramAccountId: "acc_A", instagramAccount: { instagramId: "ig_owner", status } },
      igUserId: "ig_p",
    } as Parameters<typeof enrollInSequence>[0]);
    expect(result).toBeNull();
    expect(writes()).toEqual([]);
  });

  it("approving a draft: 409, it stays PENDING, nothing sent", async () => {
    h.prisma.draftReply.findFirst.mockResolvedValue({
      id: "d_1",
      workspaceId: "ws_A",
      instagramAccountId: "acc_A",
      text: "Oi",
      status: "PENDING",
      contact: { id: "ct_1", workspaceId: "ws_A", igUserId: "ig_p", lastInboundAt: new Date() },
      instagramAccount: { id: "acc_A", instagramId: "ig_owner", accessToken: "", status },
    });
    const result = await approveAndSend({ workspaceId: "ws_A", id: "d_1", approvedBy: "u", approvedVia: "session" });
    expect(result).toMatchObject({
      ok: false,
      status: 409,
      code: status === "NEEDS_RECONNECT" ? "needs_reconnect" : "channel_disconnected",
    });
    expect(h.mockSend).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
  });
});
