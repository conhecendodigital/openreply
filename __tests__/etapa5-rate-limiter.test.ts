/**
 * Etapa 5: balde por hora dos disparos (rate:broadcast:<conta>), separado
 * do das campanhas (rate:dm) e do dos fluxos (rate:flow). Quando nega, diz
 * quando libera (pttl) pro lote voltar sem pular ninguém.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockEval, mockPttl } = vi.hoisted(() => ({ mockEval: vi.fn(), mockPttl: vi.fn() }));

vi.mock("ioredis", () => {
  const MockRedis = vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.eval = mockEval;
    this.pttl = mockPttl;
    return this;
  });
  return { default: MockRedis };
});
vi.stubEnv("REDIS_URL", "redis://localhost:6379");

import { BROADCAST_DM_PER_HOUR_DEFAULT, broadcastDmPerHour, reserveBroadcastSlot } from "../lib/utils/rate-limiter";

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllEnvs());

describe("reserveBroadcastSlot", () => {
  it("uses its own key and the default ceiling of 200/h", async () => {
    mockEval.mockResolvedValue([1, 5, 195]);
    expect(await reserveBroadcastSlot("ig_1")).toEqual({ allowed: true, count: 5, retryInMs: 0 });
    expect(mockEval).toHaveBeenCalledWith(expect.any(String), 1, "rate:broadcast:ig_1", BROADCAST_DM_PER_HOUR_DEFAULT, 3600);
    expect(mockPttl).not.toHaveBeenCalled();
  });

  it("when full, answers when the bucket frees (pttl + 1 s), or 15 min if unknown", async () => {
    mockEval.mockResolvedValue([0, 200, 0]);
    mockPttl.mockResolvedValue(600_000);
    expect(await reserveBroadcastSlot("ig_1")).toEqual({ allowed: false, count: 200, retryInMs: 601_000 });
    mockPttl.mockResolvedValue(-1);
    expect((await reserveBroadcastSlot("ig_1")).retryInMs).toBe(15 * 60_000);
  });

  it("BROADCAST_DM_PER_HOUR overrides the ceiling; junk keeps the default", () => {
    vi.stubEnv("BROADCAST_DM_PER_HOUR", "50");
    expect(broadcastDmPerHour()).toBe(50);
    vi.stubEnv("BROADCAST_DM_PER_HOUR", "abc");
    expect(broadcastDmPerHour()).toBe(200);
  });
});
