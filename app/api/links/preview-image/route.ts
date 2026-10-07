import { ok, requireContext } from "@/lib/api-helpers";
import { humanOnly } from "@/lib/flows/api";
import { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, mediaPublicBase, type MediaUploadConfig } from "@/lib/funnels/media";
import { readMediaStorageConfig } from "@/lib/media/s3";

export const dynamic = "force-dynamic";

/**
 * Is file upload on for the preview image of a tracked link (07/10/2026)?
 * Same storage as the quiz files (MEDIA_* env). Off = the screen only takes a
 * link. Signed-in person only (API keys get 403 here and in proxy.ts).
 */
export async function GET() {
  const auth = await requireContext();
  if ("response" in auth) return auth.response;
  const blocked = await humanOnly("upload files");
  if (blocked) return blocked;
  const config: MediaUploadConfig = {
    enabled: readMediaStorageConfig() !== null,
    publicBaseUrl: mediaPublicBase(),
    maxImageBytes: MAX_IMAGE_BYTES,
    maxVideoBytes: MAX_VIDEO_BYTES,
  };
  return ok(config);
}
