import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok, readJson, requireContext } from "@/lib/api-helpers";
import { getApiCaller } from "@/lib/auth";
import { approveAndSend, MAX_DRAFT_TEXT } from "@/lib/drafts/drafts";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

const bodySchema = z
  .object({
    // Required for an API key: the human who said yes (e.g. "Matheus via Telegram").
    aprovadoPor: z.string().trim().min(2).max(120).optional(),
    approvedBy: z.string().trim().min(2).max(120).optional(),
    confirmar: z.boolean().optional(),
    confirm: z.boolean().optional(),
    // Optional last edit by the approver before sending.
    text: z.string().min(1).max(MAX_DRAFT_TEXT).optional(),
    // The exact text the human saw and said yes to. Required for an API key
    // (the Telegram button sends the text it showed); if the AI edited the
    // draft since, nothing is sent (code "changed").
    textoAprovado: z.string().min(1).max(MAX_DRAFT_TEXT).optional(),
    expectedText: z.string().min(1).max(MAX_DRAFT_TEXT).optional(),
  })
  .nullable();

/**
 * Approve and send one draft. The only path that sends a draft.
 * - Session (the owner in the Lead Engine): approvedBy = userId, via "session".
 * - API key: needs the "drafts:approve" scope (never give it to the key the AI
 *   proposes with) AND { aprovadoPor, confirmar: true, textoAprovado } (or a
 *   final `text`); recorded as "mcp" with the key id.
 * - Either way the text sent is the one the human saw: textoAprovado / the
 *   screen's text must match the stored draft, or nothing goes out.
 * The window is checked at send time: closed -> EXPIRED with a clear message.
 */
export async function POST(request: NextRequest, { params }: RouteProps) {
  const auth = await requireContext();
  if ("response" in auth) return auth.response;
  const { id } = await params;

  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return fail("Invalid request", 400, parsed.error.issues);
  const body = parsed.data ?? {};

  const caller = await getApiCaller();
  let approvedBy: string;
  let approvedVia: "session" | "mcp";
  let tokenId: string | null = null;

  if (caller.kind === "session") {
    approvedBy = auth.context.userId;
    approvedVia = "session";
  } else {
    if (!caller.scopes.includes("drafts:approve")) {
      return fail(
        'This API key cannot approve drafts. Approve in the Lead Engine, or use a key created with the "drafts:approve" scope (only for the Telegram approve button, never for the AI).',
        403,
        { code: "missing_scope" }
      );
    }
    const approver = body.aprovadoPor ?? body.approvedBy;
    if (!approver || (body.confirmar ?? body.confirm) !== true) {
      return fail("Approval through the API needs aprovadoPor and confirmar: true", 400, { code: "approval_required" });
    }
    if ((body.textoAprovado ?? body.expectedText) === undefined && body.text === undefined) {
      return fail("Approval through the API needs textoAprovado: the exact text the human approved", 400, {
        code: "approval_required",
      });
    }
    approvedBy = approver;
    approvedVia = "mcp";
    tokenId = caller.tokenId;
  }

  const result = await approveAndSend({
    workspaceId: auth.context.workspaceId,
    id,
    approvedBy,
    approvedVia,
    tokenId,
    text: body.text,
    expectedText: body.textoAprovado ?? body.expectedText,
  });
  if (!result.ok) return fail(result.error, result.status, { code: result.code, ...result.details });
  return ok({ ...result.draft, sent: true, approvedBy, approvedVia });
}
