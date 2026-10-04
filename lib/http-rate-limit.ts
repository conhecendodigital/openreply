/**
 * Fixed-window request limits in Redis (the same Redis BullMQ uses).
 *
 * Fails OPEN on purpose: if Redis is slow or down, the request goes through.
 * These limits protect against abuse (e-mail bombing, a runaway script); they
 * must never be the reason the owner cannot log in or the MCP stops working.
 */
import { createHash } from "node:crypto";
import { getRedisConnection } from "@/lib/queue/client";

type CounterStore = {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
};

const REDIS_TIMEOUT_MS = 500;

export type RateLimitCheck = { allowed: boolean; count: number; limit: number };

/** Short stable key part for an e-mail, token or IP (never stored in clear). */
export function rateLimitKeyPart(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex").slice(0, 32);
}

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("rate limit store timeout")), REDIS_TIMEOUT_MS)
    ),
  ]);
}

/**
 * Counts one hit on `bucket` + `id` and says whether it is still within
 * `limit` hits per `windowSeconds`.
 */
export async function hitRateLimit(
  bucket: string,
  id: string,
  limit: number,
  windowSeconds: number,
  store?: CounterStore
): Promise<RateLimitCheck> {
  const key = `rl:${bucket}:${rateLimitKeyPart(id)}`;
  try {
    const redis: CounterStore = store ?? (getRedisConnection() as unknown as CounterStore);
    const count = await withTimeout(redis.incr(key));
    if (count === 1) await withTimeout(redis.expire(key, windowSeconds)).catch(() => 0);
    return { allowed: count <= limit, count, limit };
  } catch {
    return { allowed: true, count: 0, limit };
  }
}

/** Magic links per e-mail address per hour. */
export const MAGIC_LINK_LIMIT = { limit: 5, windowSeconds: 60 * 60 };
/**
 * MCP calls per API key per minute (one call can be a batch). Generous: the
 * owner's agents share one key and must not hit it in normal use.
 */
export const MCP_LIMIT = { limit: 300, windowSeconds: 60 };
