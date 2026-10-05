import { NextRequest } from "next/server";
import {
  capiJson,
  metaCapiPatchSchema,
  readMetaCapiView,
  requireCapiManager,
  saveMetaCapi,
  validateMetaCapiPatch,
} from "@/lib/meta/capi-settings";

export const dynamic = "force-dynamic";

// Account Pixel + Meta Conversions API. Signed-in owner/admin only; API keys
// get 403 (proxy.ts and here). The token goes in and never comes back out:
// the answer only says whether one is saved and its last 4 characters.

export async function GET() {
  const gate = await requireCapiManager();
  if ("error" in gate) return gate.error;
  return capiJson({ success: true, data: await readMetaCapiView(gate.context.workspaceId) });
}

export async function PATCH(request: NextRequest) {
  const gate = await requireCapiManager();
  if ("error" in gate) return gate.error;
  const parsed = metaCapiPatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return capiJson({ success: false, error: "Invalid data", code: "invalid" }, 400);
  const bad = validateMetaCapiPatch(parsed.data);
  if (bad) return capiJson({ success: false, error: "Invalid data", code: bad }, 400);
  try {
    return capiJson({ success: true, data: await saveMetaCapi(gate.context, parsed.data) });
  } catch {
    // Never echo the error: it could carry what was sent.
    console.warn("[Meta CAPI] could not save the settings");
    return capiJson({ success: false, error: "Could not save", code: "save_failed" }, 500);
  }
}
