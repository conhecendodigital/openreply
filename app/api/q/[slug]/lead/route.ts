import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api-helpers";
import { hitRateLimit } from "@/lib/http-rate-limit";
import { getRequestIp } from "@/lib/tracking/server";
import { FUNNEL_LEAD_LIMIT, MAX_PUBLIC_BODY, parseJsonText, readLimitedText } from "@/lib/funnels/limits";
import { getLiveFunnel } from "@/lib/funnels/public";
import { funnelLeadBodySchema, LeadError, submitFunnelLead } from "@/lib/funnels/tracking";
import type { FunnelLeadBody } from "@/lib/funnels/types";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ slug: string }> };

// Public: data fields of a quiz screen (name, e-mail, WhatsApp) with the
// consent box. Honeypot filled = 200 and nothing saved (bots get no signal).
export async function POST(request: NextRequest, { params }: RouteProps) {
  const { slug } = await params;
  const text = await readLimitedText(request, MAX_PUBLIC_BODY);
  if (text === "too_large") return fail("Too large", 413, { code: "too_large" });

  const ip = getRequestIp(request) ?? "unknown";
  const limited = await hitRateLimit("q-lead", ip, FUNNEL_LEAD_LIMIT.limit, FUNNEL_LEAD_LIMIT.windowSeconds);
  if (!limited.allowed) return fail("Too many requests", 429, { code: "rate_limited" });

  const parsed = funnelLeadBodySchema.safeParse(parseJsonText(text));
  if (!parsed.success) return fail("Invalid data", 400);
  if (parsed.data.website && parsed.data.website.trim() !== "") return ok({ ok: true });

  try {
    const funnel = await getLiveFunnel(slug);
    if (!funnel) return fail("Not found", 404);
    return ok(await submitFunnelLead(funnel, parsed.data as FunnelLeadBody, request));
  } catch (error) {
    if (error instanceof LeadError) return fail(error.message, 400, { code: error.code, ...error.extra });
    console.warn("[Funnel] lead failed:", error instanceof Error ? error.message : "error");
    return fail("Something went wrong", 500);
  }
}
