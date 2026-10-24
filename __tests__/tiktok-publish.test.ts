/**
 * Publicação do TikTok: só um processo pega cada post, post vencido sai no
 * ciclo do cron, travado volta pra fila (ou falha depois de 3 tentativas) e
 * a confirmação do TikTok fecha o post.
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
  const prisma = new Proxy({} as Record<string, unknown>, { get: (_t, name: string) => model(name) });
  return {
    prisma: prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>,
    models,
    mockStatus: vi.fn(),
  };
});

vi.mock("@/lib/db/client", () => ({ prisma: h.prisma }));
vi.mock("@/lib/meta/oauth", () => ({ decryptToken: (t: string) => `plain:${t}`, encryptToken: (t: string) => `enc:${t}` }));
vi.mock("@/lib/tiktok/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/tiktok/client")>();
  return { ...real, fetchPublishStatus: h.mockStatus };
});

import { checkPublishing, claimPost, sweepTikTokPosts } from "../lib/tiktok/publish";

const NOW = new Date("2026-10-23T15:00:00.000Z");
const FUTURE_TOKEN = new Date(NOW.getTime() + 60 * 60 * 1000);

const waiting = (over: Record<string, unknown> = {}) => ({
  id: "p_1",
  status: "PUBLISHING",
  publishId: "pub_1",
  lockedAt: new Date(NOW.getTime() - 5 * 60 * 1000),
  socialAccount: { id: "a_1", accessToken: "tok", refreshToken: "ref", tokenExpiresAt: FUTURE_TOKEN, status: "ACTIVE" },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.models.clear();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

describe("claimPost", () => {
  it("só um processo ganha: a troca de status é atômica", async () => {
    h.prisma.scheduledPost.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    expect(await claimPost("p_1")).toBe(true);
    expect(await claimPost("p_1")).toBe(false);
    const call = h.prisma.scheduledPost.updateMany.mock.calls[0][0];
    expect(call.data).toMatchObject({ status: "PUBLISHING", attempts: { increment: 1 }, lastError: null });
    // Não pega quem já está publicando, publicado ou cancelado.
    const statuses = call.where.OR.map((c: { status: string }) => c.status);
    expect(statuses).not.toContain("PUBLISHED");
    expect(statuses).not.toContain("CANCELED");
  });
});

describe("sweepTikTokPosts", () => {
  it("não faz nada com a fila vazia", async () => {
    h.prisma.scheduledPost.findMany.mockResolvedValue([]);
    expect(await sweepTikTokPosts(NOW)).toEqual({ started: 0, checked: 0, recovered: 0 });
  });

  it("pega só posts agendados já vencidos", async () => {
    h.prisma.scheduledPost.findMany.mockResolvedValue([]);
    await sweepTikTokPosts(NOW);
    const where = h.prisma.scheduledPost.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ status: "SCHEDULED", scheduledAt: { lte: NOW } });
  });

  it("travado sem publishId volta pra fila; depois de 3 tentativas falha", async () => {
    h.prisma.scheduledPost.findMany
      .mockResolvedValueOnce([]) // vencidos
      .mockResolvedValueOnce([
        { id: "p_a", attempts: 1 },
        { id: "p_b", attempts: 3 },
      ]) // travados
      .mockResolvedValueOnce([]); // esperando confirmação
    const result = await sweepTikTokPosts(NOW);
    expect(result.recovered).toBe(2);
    const updates = h.prisma.scheduledPost.update.mock.calls.map((c) => c[0]);
    expect(updates[0]).toMatchObject({ where: { id: "p_a" }, data: { status: "SCHEDULED", lockedAt: null } });
    expect(updates[1]).toMatchObject({ where: { id: "p_b" }, data: { status: "FAILED", lockedAt: null } });
  });
});

describe("checkPublishing", () => {
  it("TikTok confirmou: vira PUBLISHED", async () => {
    h.prisma.scheduledPost.findUnique.mockResolvedValue(waiting());
    h.mockStatus.mockResolvedValue({ state: "PUBLISH_COMPLETE", failReason: null, postId: "7" });
    await checkPublishing("p_1");
    expect(h.prisma.scheduledPost.update.mock.calls[0][0].data).toMatchObject({ status: "PUBLISHED", lockedAt: null });
  });

  it("TikTok recusou: vira FAILED com o motivo", async () => {
    h.prisma.scheduledPost.findUnique.mockResolvedValue(waiting());
    h.mockStatus.mockResolvedValue({ state: "FAILED", failReason: "video_duration_too_short", postId: null });
    await checkPublishing("p_1");
    expect(h.prisma.scheduledPost.update.mock.calls[0][0].data).toMatchObject({
      status: "FAILED",
      lastError: "video_duration_too_short",
    });
  });

  it("ainda processando: não mexe", async () => {
    h.prisma.scheduledPost.findUnique.mockResolvedValue(waiting());
    h.mockStatus.mockResolvedValue({ state: "PROCESSING_UPLOAD", failReason: null, postId: null });
    await checkPublishing("p_1");
    expect(h.prisma.scheduledPost.update).not.toHaveBeenCalled();
  });

  it("sem confirmação em 2 horas: FAILED", async () => {
    h.prisma.scheduledPost.findUnique.mockResolvedValue(waiting({ lockedAt: new Date(NOW.getTime() - 3 * 60 * 60 * 1000) }));
    h.mockStatus.mockResolvedValue({ state: "PROCESSING_UPLOAD", failReason: null, postId: null });
    await checkPublishing("p_1");
    expect(h.prisma.scheduledPost.update.mock.calls[0][0].data.status).toBe("FAILED");
  });

  it("erro de rede ao conferir não derruba o post", async () => {
    h.prisma.scheduledPost.findUnique.mockResolvedValue(waiting());
    h.mockStatus.mockRejectedValue(new Error("rede"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await checkPublishing("p_1");
    expect(h.prisma.scheduledPost.update).not.toHaveBeenCalled();
  });
});
