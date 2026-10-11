/**
 * Botão na mensagem de depois do link (11/10/2026): o 2º link sai do cartão
 * principal e vai como botão na mensagem de depois; com 1 link vira lembrete;
 * quem já clicou não recebe; sem rótulo, tudo como antes.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  prisma: {
    automation: { findMany: vi.fn(), findFirst: vi.fn() },
    linkClick: { findFirst: vi.fn() },
    dmLog: { findUnique: vi.fn(), findFirst: vi.fn(), upsert: vi.fn(), update: vi.fn(), create: vi.fn() },
    operationalEvent: { create: vi.fn() },
  },
  sendText: vi.fn(),
  sendButtons: vi.fn(),
  check: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: h.prisma }));
vi.mock("@/lib/meta/client", () => ({
  sendDirectMessage: h.sendText,
  sendDirectMessageWithButton: vi.fn(),
  sendDirectMessageWithLinkButton: h.sendButtons,
  sendPrivateReply: vi.fn(),
  sendPrivateReplyWithButton: vi.fn(),
  sendPrivateReplyWithLinkButton: vi.fn(),
  sendCommentReply: vi.fn(),
  getUserFollowStatus: vi.fn(async () => true),
  MetaApiError: class MetaApiError extends Error {
    code = 0;
  },
  TokenExpiredError: class TokenExpiredError extends Error {},
  RateLimitError: class RateLimitError extends Error {},
}));
vi.mock("@/lib/meta/oauth", () => ({ decryptToken: (t: string) => `plain:${t}` }));
vi.mock("@/lib/meta/send", () => ({
  sendTracked: vi.fn(async (_c: unknown, send: (o: unknown) => Promise<unknown>) => send({ metadata: "le:x:y" })),
}));
vi.mock("@/lib/links/urls", () => ({
  linkUrlResolver: vi.fn(async () => (link: { slug: string }) => `https://link.test/r/${link.slug}/abc`),
}));
vi.mock("@/lib/billing/usage", () => ({
  reserveWorkspaceDMSend: vi.fn(async () => ({ allowed: true, periodStart: new Date() })),
  releaseWorkspaceDMReservation: vi.fn(),
}));
vi.mock("@/lib/utils/rate-limiter", () => ({ reserveDMSlot: vi.fn() }));
vi.mock("@/lib/ops/worker-health", () => ({ recordWorkerAlert: vi.fn() }));
vi.mock("@/lib/moderation/moderate", () => ({ moderateComment: vi.fn() }));
vi.mock("@/lib/messaging/guard", () => ({ checkAutomation: h.check }));
vi.mock("@/lib/queue/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/queue/client")>();
  return { ...real, getDMQueue: () => ({ add: vi.fn() }), getRedisConnection: vi.fn() };
});
vi.mock("bullmq", () => {
  function MockWorker(_name: string, processor: unknown) {
    (global as Record<string, unknown>).__followupProcessor = processor;
    return { on: vi.fn(), close: vi.fn() };
  }
  class UnrecoverableError extends Error {}
  return { Worker: MockWorker, UnrecoverableError, Queue: vi.fn() };
});

import { createDMWorker } from "../lib/queue/dm-worker";
import { hasFollowUpButton, splitFollowUpLinks } from "../lib/campaigns/followup-link";
import { campaignToFlowDefinition } from "../lib/flows/convert";

type Proc = (job: { name: string; data: Record<string, unknown>; id: string; attemptsMade: number }) => Promise<void>;
function run(): Promise<void> {
  createDMWorker();
  const p = (global as Record<string, unknown>).__followupProcessor as Proc;
  return p({ name: "process-followup", id: "f1", attemptsMade: 0, data: { instagramAccountId: "ig_owner", userId: "ig_person", automationId: "auto_1", commenterName: "ana" } });
}

const COMANDO = { slug: "cmd", label: "Ver o Comando", destinationUrl: "https://comando.test/diag" };
const VAGA = { slug: "vaga", label: "Quero minha vaga", destinationUrl: "https://quiz.test/workshop" };

function automation(over: Record<string, unknown> = {}) {
  return {
    id: "auto_1",
    workspaceId: "ws",
    instagramAccountId: "acc_row",
    dmFormat: "BUTTON",
    followUpEnabled: true,
    followUpMessage: "Quinta, 15/10, às 19h, aula ao vivo. Garante sua vaga 👇",
    followUpButtonLabel: "Quero minha vaga",
    trackedLinks: [COMANDO, VAGA],
    instagramAccount: { instagramId: "ig_owner", accessToken: "enc", status: "ACTIVE" },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.check.mockResolvedValue({ ok: true, contact: null });
  h.prisma.linkClick.findFirst.mockResolvedValue(null);
});

describe("divisão dos links", () => {
  it("sem rótulo nada muda; com 2 links o 2º vai pra mensagem de depois; com 1 link vira lembrete", () => {
    expect(hasFollowUpButton({ followUpEnabled: true, followUpMessage: "oi", followUpButtonLabel: " " })).toBe(false);
    expect(hasFollowUpButton({ followUpEnabled: false, followUpMessage: "oi", followUpButtonLabel: "Vaga" })).toBe(false);
    expect(splitFollowUpLinks([COMANDO, VAGA], false)).toEqual({ main: [COMANDO, VAGA], followUp: null });
    expect(splitFollowUpLinks([COMANDO, VAGA], true)).toEqual({ main: [COMANDO], followUp: VAGA });
    expect(splitFollowUpLinks([VAGA], true)).toEqual({ main: [VAGA], followUp: VAGA });
    expect(splitFollowUpLinks([], true)).toEqual({ main: [], followUp: null });
  });
});

describe("mensagem de depois", () => {
  it("vai como cartão com o botão do 2º link", async () => {
    h.prisma.automation.findFirst.mockResolvedValue(automation());
    await run();
    expect(h.sendButtons).toHaveBeenCalledTimes(1);
    const [, , to, body, buttons] = h.sendButtons.mock.calls[0];
    expect(to).toBe("ig_person");
    expect(body).toContain("aula ao vivo");
    expect(buttons).toEqual([{ title: "Quero minha vaga", url: "https://link.test/r/vaga/abc" }]);
    expect(h.sendText).not.toHaveBeenCalled();
  });

  it("quem já clicou no link não recebe", async () => {
    h.prisma.automation.findFirst.mockResolvedValue(automation());
    h.prisma.linkClick.findFirst.mockResolvedValue({ id: "click_1" });
    await run();
    expect(h.prisma.linkClick.findFirst.mock.calls[0][0].where).toMatchObject({ automationId: "auto_1", contactIgUserId: "ig_person", trackedLink: { slug: "vaga" } });
    expect(h.sendButtons).not.toHaveBeenCalled();
    expect(h.sendText).not.toHaveBeenCalled();
  });

  it("formato texto: o link vai dentro do texto", async () => {
    h.prisma.automation.findFirst.mockResolvedValue(automation({ dmFormat: "TEXT" }));
    await run();
    expect(h.sendButtons).not.toHaveBeenCalled();
    expect(h.sendText.mock.calls[0][3]).toContain("https://link.test/r/vaga/abc");
  });

  it("sem rótulo continua só texto, sem link", async () => {
    h.prisma.automation.findFirst.mockResolvedValue(automation({ followUpButtonLabel: null }));
    await run();
    expect(h.sendButtons).not.toHaveBeenCalled();
    expect(h.sendText.mock.calls[0][3]).not.toContain("https://");
  });
});

describe("virar fluxo", () => {
  it("o botão da mensagem de depois vai junto e sai do primeiro cartão", () => {
    const { definition } = campaignToFlowDefinition({
      ...automation(),
      name: "x",
      trigger: "COMMENT",
      postId: "p1",
      postUrl: null,
      matchAnyPost: false,
      pendingNextReel: false,
      keywords: ["LIVRO"],
      matchAnyWord: false,
      wholeWordMatch: true,
      dmTriggerEnabled: false,
      storyId: null,
      dmMessage: "Tá aqui o Comando 👇",
      openingDmEnabled: true,
      openingDmMessage: "Vi teu comentário",
      openingDmButtonLabel: "Quero o Comando",
      linkButtonLabel: "Ver o Comando",
      requireFollow: false,
      followPromptMessage: null,
      followPromptButtonLabel: null,
      followUpDelayMinutes: 5,
      publicReplyEnabled: false,
    } as unknown as Parameters<typeof campaignToFlowDefinition>[0]);
    const link = definition.nodes.find((n) => n.id === "link") as { buttons: { url: string }[] };
    const followup = definition.nodes.find((n) => n.id === "followup") as { buttons: { label: string; url: string }[] };
    expect(link.buttons.map((b) => b.url)).toEqual(["https://comando.test/diag"]);
    expect(followup.buttons).toEqual([{ id: "f1", kind: "link", label: "Quero minha vaga", url: "https://quiz.test/workshop" }]);
  });
});
