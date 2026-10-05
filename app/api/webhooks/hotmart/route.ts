import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api-helpers";
import { MAX_HOTMART_BODY, parseJsonText, readLimitedText } from "@/lib/funnels/limits";
import { applyHotmartPurchase, hottokMatches, parseHotmartPayload } from "@/lib/funnels/hotmart";

export const dynamic = "force-dynamic";

// Hotmart purchase webhook. HOTMART_HOTTOK missing = 503 (before reading
// anything). Wrong token = 401. A valid call always answers 200 (matched or
// not) so Hotmart does not retry forever; repeats change nothing.
export async function POST(request: NextRequest) {
  const expected = process.env.HOTMART_HOTTOK?.trim();
  if (!expected) return fail("Hotmart webhook not configured", 503, { code: "not_configured" });

  const header = request.headers.get("x-hotmart-hottok");
  if (header !== null && !hottokMatches(header.trim(), expected)) return fail("Unauthorized", 401);

  const text = await readLimitedText(request, MAX_HOTMART_BODY);
  if (text === "too_large") return fail("Too large", 413, { code: "too_large" });
  let payload = parseJsonText(text);
  if (payload === undefined && text.includes("=")) {
    // v1 sends form fields.
    payload = Object.fromEntries(new URLSearchParams(text));
  }

  if (header === null) {
    const bodyToken = (payload as { hottok?: unknown } | undefined)?.hottok;
    if (typeof bodyToken !== "string" || !hottokMatches(bodyToken.trim(), expected)) return fail("Unauthorized", 401);
  }
  if (payload === undefined || payload === null || typeof payload !== "object") return fail("Invalid JSON", 400);

  const parsed = parseHotmartPayload(payload);
  if (!parsed) return ok({ received: true, matched: false });
  try {
    const result = await applyHotmartPurchase(parsed);
    return ok({ received: true, matched: result.matched });
  } catch (error) {
    console.warn("[Hotmart] webhook failed:", error instanceof Error ? error.message : "error");
    return fail("Something went wrong", 500);
  }
}
