/** Resgatar comentários: dryRun sem envio, execução, ritmo, pausa por limite, opt-out e interruptor. */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const models = new Map<string, Record<string, ReturnType<typeof vi.fn>>>();
  const model = (name: string) => {
    if (!models.has(name)) {
      models.set(
        name,
        new Proxy({} as Record<string, ReturnType<typeof vi.fn>>, {
          get(target, method: string) {
            if (!target[method]) target[method] = vi.fn(async () => (method.startsWith("find") && method !== "findMany" ? null : method === "findMany" ? [] : method === "count" ? 0 : null));
            return target[method];
          },
        })
      );
    }
    return models.get(name)!;
  };
  const prisma = new Proxy({} as Record<string, unknown>, { get: (_t, name: string) => model(name) });
  return {
    prisma: prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>,
    queueAdd: vi.fn(async () => undefined),
    redisSet: vi.fn(async () => "OK"),
    redisDel: vi.fn(async () => 1),
    listComments: vi.fn(),
    startFlowRun: vi.fn(),
    bucket: vi.fn(async () => ({ count: 0, max: 750, ttlMs: 0 })),
  };
});

vi.mock("@/lib/db/client", () => ({ prisma: h.prisma }));
vi.mock("@/lib/queue/client", () => ({
  getDMQueue: () => ({ add: h.queueAdd }),
  getRedisConnection: () => ({ set: h.redisSet, del: h.redisDel }),
}));
vi.mock("@/lib/meta/client", () => ({
  listAllMediaComments: h.listComments,
  getAllUserMedia: vi.fn(async () => []),
  MetaApiError: class MetaApiError extends Error {
    code = 0;
  },
}));
vi.mock("@/lib/meta/oauth", () => ({ decryptToken: () => "TOKEN" }));
vi.mock("@/lib/channels/status", () => ({ noteMetaError: vi.fn(async () => false) }));
vi.mock("@/lib/flows/engine", () => ({ startFlowRun: h.startFlowRun }));
vi.mock("@/lib/utils/rate-limiter", () => ({ dmBucketState: h.bucket }));

import { planResgate, runResgateStep, sweepResgates } from "../lib/resgate/service";

const NOW = new Date("2026-10-28T15:00:00Z");
const hoursAgo = (n: number) => new Date(NOW.getTime() - n * 3_600_000).toISOString();
const m = (name: string) => h.prisma[name];

function flowRow(over: Record<string, unknown> = {}) {
  return {
    id: "f1",
    name: "Gemini",
    triggerType: "COMMENT",
    keywords: ["gemini"],
    matchAnyWord: false,
    wholeWordMatch: true,
    sourceAutomationId: null,
    triggerPostId: "m1",
    triggerMatchAnyPost: false,
    isActive: true,
    published: {},
    instagramAccountId: "acc1",
    instagramAccount: { instagramId: "ig1", status: "ACTIVE", accessToken: "enc" },
    ...over,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  h.redisSet.mockResolvedValue("OK");
  h.bucket.mockResolvedValue({ count: 0, max: 750, ttlMs: 0 });
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  delete process.env.RESGATE_DISABLED;
  delete process.env.MCP_FLUXOS_DISABLED;
  m("flow").findFirst.mockResolvedValue(flowRow());
  h.listComments.mockResolvedValue({
    truncated: false,
    comments: [
      { id: "c1", text: "Gemini", timestamp: hoursAgo(30), from: { id: "p1", username: "ana" } },
      { id: "c2", text: "Gmani", timestamp: hoursAgo(20), from: { id: "p2", username: "bia" } },
      { id: "c3", text: "Gemini", timestamp: hoursAgo(24 * 8), from: { id: "p3", username: "cai" } },
      { id: "c4", text: "Gemini", timestamp: hoursAgo(5), from: { id: "ig1", username: "eu" } },
      { id: "c5", text: "Gemini", timestamp: hoursAgo(3), from: { id: "p5", username: "edu" } },
    ],
  });
  m("flowRun").findMany.mockResolvedValue([{ igUserId: "p5", triggerCommentId: "c5" }]);
});
afterEach(() => vi.useRealTimers());

describe("planResgate", () => {
  it("dryRun (padrão) só conta e mostra amostra: nada é criado nem enfileirado", async () => {
    const r = await planResgate({ workspaceId: "w1", flowId: "f1", post: "17900000000000001", tolerarGrafia: true, now: NOW });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dryRun).toBe(true);
    expect(r.runId).toBeNull();
    expect(r.contagens).toMatchObject({ lidos: 5, vencidos: 1, proprios: 1, elegiveis: 2, elegiveisPorGrafia: 1 });
    expect(r.amostra[0]).toHaveProperty("venceEm");
    expect(m("resgateRun").create).not.toHaveBeenCalled();
    expect(m("resgateItem").createMany).not.toHaveBeenCalled();
    expect(h.queueAdd).not.toHaveBeenCalled();
    expect(h.startFlowRun).not.toHaveBeenCalled();
  });

  it("fluxo desligado é recusado (nada de enviar por trás do dono)", async () => {
    m("flow").findFirst.mockResolvedValue(flowRow({ isActive: false }));
    const r = await planResgate({ workspaceId: "w1", flowId: "f1", post: "17900000000000001", now: NOW });
    expect(r).toMatchObject({ ok: false, status: 409, code: "target_off" });
  });

  it("leitura da Meta falha: erro claro, nada criado", async () => {
    h.listComments.mockRejectedValue(new Error("Meta API Error 4: limit"));
    const r = await planResgate({ workspaceId: "w1", flowId: "f1", post: "17900000000000001", dryRun: false, now: NOW });
    expect(r).toMatchObject({ ok: false, status: 502, code: "meta_read_failed" });
    expect(m("resgateRun").create).not.toHaveBeenCalled();
  });

  it("execução real: cria run e itens (sem os já atendidos) e agenda o primeiro passo", async () => {
    m("resgateRun").create.mockResolvedValue({ id: "run1" });
    const r = await planResgate({ workspaceId: "w1", flowId: "f1", post: "17900000000000001", dryRun: false, createdBy: "mcp:t", now: NOW });
    expect(r.ok).toBe(true);
    const data = m("resgateItem").createMany.mock.calls[0][0].data as { commentId: string }[];
    // c1 (Gemini, ana); c2 só com tolerarGrafia; c3 venceu; c4 própria; c5 já atendida
    expect(data.map((d) => d.commentId)).toEqual(["c1"]);
    expect(m("resgateRun").create.mock.calls[0][0].data).toMatchObject({ flowId: "f1", mediaId: "17900000000000001", intervaloMinMs: 2000, intervaloMaxMs: 4000, tetoHora: 400 });
    expect(h.queueAdd).toHaveBeenCalledWith("resgate-step", expect.objectContaining({ runId: "run1" }), expect.any(Object));
    expect(m("operationalEvent").create).toHaveBeenCalled();
  });

  it("não cria uma segunda execução aberta do mesmo alvo e post", async () => {
    m("resgateRun").findFirst.mockResolvedValue({ id: "aberta" });
    const r = await planResgate({ workspaceId: "w1", flowId: "f1", post: "17900000000000001", dryRun: false, now: NOW });
    expect(r).toMatchObject({ ok: false, status: 409, code: "already_running" });
  });

  it("interruptor desliga o envio mas deixa contar (dryRun)", async () => {
    process.env.RESGATE_DISABLED = "1";
    expect(await planResgate({ workspaceId: "w1", flowId: "f1", post: "17900000000000001", dryRun: false, now: NOW })).toMatchObject({ ok: false, status: 503, code: "resgate_disabled" });
    expect((await planResgate({ workspaceId: "w1", flowId: "f1", post: "17900000000000001", now: NOW })).ok).toBe(true);
    delete process.env.RESGATE_DISABLED;
    process.env.MCP_FLUXOS_DISABLED = "1";
    expect(await planResgate({ workspaceId: "w1", flowId: "f1", post: "17900000000000001", dryRun: false, now: NOW })).toMatchObject({ status: 503 });
  });

  it("exige fluxo OU campanha", async () => {
    expect(await planResgate({ workspaceId: "w1", post: "17900000000000001" })).toMatchObject({ ok: false, status: 400 });
    expect(await planResgate({ workspaceId: "w1", flowId: "f1", automationId: "a1", post: "17900000000000001" })).toMatchObject({ ok: false, status: 400 });
  });
});

describe("runResgateStep", () => {
  const run = (over: Record<string, unknown> = {}) => ({
    id: "run1", workspaceId: "w1", instagramAccountId: "acc1", flowId: "f1", automationId: null, mediaId: "m1",
    status: "RUNNING", intervaloMinMs: 2000, intervaloMaxMs: 4000, tetoHora: 400, ...over,
  });
  const item = (over: Record<string, unknown> = {}) => ({
    id: "i1", runId: "run1", commentId: "c1", igUserId: "p1", username: "ana", text: "Gemini",
    commentAt: new Date(NOW.getTime() - 30 * 3_600_000), status: "PENDING", attempts: 0, ...over,
  });
  const step = () => runResgateStep({ instagramAccountId: "ig1", runId: "run1" }, NOW);

  beforeEach(() => {
    m("resgateRun").findUnique.mockResolvedValue(run());
    m("resgateItem").findFirst.mockResolvedValue(item());
    m("resgateItem").updateMany.mockResolvedValue({ count: 1 });
    h.startFlowRun.mockResolvedValue("started");
    m("flowRun").findFirst.mockResolvedValue({ privateReplyUsed: true, status: "DONE", stopReason: null });
  });

  it("envia um comentário pelo caminho do fluxo e agenda o próximo dentro do intervalo", async () => {
    expect(await step()).toBe("sent");
    expect(h.startFlowRun).toHaveBeenCalledWith(
      expect.objectContaining({ flowId: "f1", kind: "COMMENT", triggerRef: "c1", igUserId: "p1", triggerKey: "resgate:c1:1" }),
      NOW
    );
    expect(m("resgateItem").update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "SENT" }) }));
    const [, , opts] = h.queueAdd.mock.calls.at(-1) as unknown as [string, unknown, { delay: number }];
    expect(opts.delay).toBeGreaterThanOrEqual(2000);
    expect(opts.delay).toBeLessThanOrEqual(4000);
    expect(h.redisDel).toHaveBeenCalled();
  });

  it("opt-out no meio do caminho: pula e não envia", async () => {
    m("contact").findFirst.mockResolvedValue({ broadcastOptOutAt: new Date(), humanTakeover: false, humanTakeoverUntil: null });
    expect(await step()).toBe("skipped");
    expect(h.startFlowRun).not.toHaveBeenCalled();
    expect(m("resgateItem").update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "SKIPPED", reason: expect.stringContaining("opt-out") }) }));
  });

  it("comentário que venceu na fila não é enviado", async () => {
    m("resgateItem").findFirst.mockResolvedValue(item({ commentAt: new Date(NOW.getTime() - 7 * 24 * 3_600_000 - 1000) }));
    expect(await step()).toBe("skipped");
    expect(h.startFlowRun).not.toHaveBeenCalled();
  });

  it("rate limit da Meta pausa a execução e devolve o item pra fila (sem perder ninguém)", async () => {
    m("flowRun").findFirst.mockResolvedValue({ privateReplyUsed: false, status: "FAILED", stopReason: "Meta API Error 4: Application request limit reached" });
    expect(await step()).toBe("paused");
    expect(m("resgateItem").update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "PENDING" }) }));
    const upd = m("resgateRun").update.mock.calls.find((c) => (c[0] as { data: { status?: string } }).data.status === "PAUSED");
    expect(upd).toBeTruthy();
    expect((upd![0] as { data: { pausedUntil: Date } }).data.pausedUntil.getTime()).toBeGreaterThan(NOW.getTime());
    expect(h.queueAdd).not.toHaveBeenCalled();
  });

  it("erro 100 (conversa arquivada/inexistente) é falha definitiva: sem retry e a fila segue", async () => {
    m("flowRun").findFirst.mockResolvedValue({ privateReplyUsed: false, status: "FAILED", stopReason: "Meta API Error 100: The comment is invalid for a private reply" });
    expect(await step()).toBe("failed");
    expect(m("resgateItem").update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) }));
    expect(h.queueAdd).toHaveBeenCalled();
  });

  it("fora da janela é falha definitiva", async () => {
    m("flowRun").findFirst.mockResolvedValue({ privateReplyUsed: false, status: "STOPPED_WINDOW", stopReason: "window_closed" });
    expect(await step()).toBe("failed");
  });

  it("teto por hora da execução pausa sem enviar", async () => {
    m("resgateRun").findUnique.mockResolvedValue(run({ tetoHora: 2 }));
    m("resgateItem").findMany.mockResolvedValue([{ processedAt: new Date(NOW.getTime() - 60_000) }, { processedAt: new Date(NOW.getTime() - 30_000) }]);
    expect(await step()).toBe("paused");
    expect(h.startFlowRun).not.toHaveBeenCalled();
  });

  it("balde da Meta quase cheio (750/h) pausa sem enviar", async () => {
    h.bucket.mockResolvedValueOnce({ count: 650, max: 750, ttlMs: 1_200_000 });
    expect(await step()).toBe("paused");
    expect(h.startFlowRun).not.toHaveBeenCalled();
  });

  it("interruptor de emergência pausa a execução", async () => {
    process.env.RESGATE_DISABLED = "1";
    expect(await step()).toBe("off");
    expect(h.startFlowRun).not.toHaveBeenCalled();
    expect(m("resgateRun").update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "PAUSED" }) }));
  });

  it("execução pausada ou cancelada não envia", async () => {
    m("resgateRun").findUnique.mockResolvedValue(run({ status: "PAUSED" }));
    expect(await step()).toBe("idle");
    expect(h.startFlowRun).not.toHaveBeenCalled();
  });

  it("duas correntes ao mesmo tempo: a segunda sai sem enviar", async () => {
    h.redisSet.mockResolvedValueOnce(null as never);
    expect(await step()).toBe("locked");
    expect(h.startFlowRun).not.toHaveBeenCalled();
  });

  it("sem itens pendentes a execução termina", async () => {
    m("resgateItem").findFirst.mockResolvedValue(null);
    expect(await step()).toBe("done");
    expect(m("resgateRun").update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "DONE" }) }));
  });

  it("campanha: entra pelo mesmo process-comment do webhook", async () => {
    m("resgateRun").findUnique.mockResolvedValue(run({ flowId: null, automationId: "a1" }));
    expect(await step()).toBe("sent");
    expect(h.startFlowRun).not.toHaveBeenCalled();
    expect(h.queueAdd).toHaveBeenCalledWith("process-comment", expect.objectContaining({ commentId: "c1", commenterId: "p1", mediaId: "m1" }));
  });
});

describe("sweepResgates", () => {
  it("retoma pausada vencida e não faz nada com o interruptor ligado", async () => {
    m("resgateRun").findMany.mockResolvedValueOnce([{ id: "run1", instagramAccountId: "acc1" }]).mockResolvedValueOnce([]);
    m("instagramAccount").findUnique.mockResolvedValue({ instagramId: "ig1" });
    expect(await sweepResgates(NOW)).toEqual({ resumed: 1 });
    expect(h.queueAdd).toHaveBeenCalledWith("resgate-step", expect.objectContaining({ runId: "run1" }), expect.any(Object));
    process.env.RESGATE_DISABLED = "1";
    h.queueAdd.mockClear();
    expect(await sweepResgates(NOW)).toEqual({ resumed: 0 });
    expect(h.queueAdd).not.toHaveBeenCalled();
  });
});
