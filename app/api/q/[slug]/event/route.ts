import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api-helpers";
import { hitRateLimit } from "@/lib/http-rate-limit";
import { getRequestIp } from "@/lib/tracking/server";
import { FUNNEL_EVENT_LIMIT, MAX_PUBLIC_BODY, parseJsonText, readLimitedText } from "@/lib/funnels/limits";
import { getLiveFunnel } from "@/lib/funnels/public";
import { funnelEventBodySchema, recordFunnelEvent } from "@/lib/funnels/tracking";
import type { FunnelEventBody } from "@/lib/funnels/types";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ slug: string }> };

// Public: what the quiz player records (screen view, answer, checkout click).
// No login. Small body, rate limited, only for a PUBLISHED funnel.
export async function POST(request: NextRequest, { params }: RouteProps) {
  const { slug } = await params;
  const text = await readLimitedText(request, MAX_PUBLIC_BODY);
  if (text === "too_large") return fail("Too large", 413, { code: "too_large" });

  const ip = getRequestIp(request) ?? "unknown";
  const limited = await hitRateLimit("q-event", `${ip}:${slug}`, FUNNEL_EVENT_LIMIT.limit, FUNNEL_EVENT_LIMIT.windowSeconds);
  if (!limited.allowed) return fail("Too many requests", 429, { code: "rate_limited" });

  const parsed = funnelEventBodySchema.safeParse(parseJsonText(text));
  if (!parsed.success) return fail("Invalid event", 400);

  try {
    const funnel = await getLiveFunnel(slug);
    if (!funnel) return fail("Not found", 404);
    return ok(await recordFunnelEvent(funnel, parsed.data as FunnelEventBody, request));
  } catch (error) {
    console.warn("[Funnel] event failed:", error instanceof Error ? error.message : "error");
    return fail("Something went wrong", 500);
  }
}
