/**
 * Response headers for a saved DM media file served from our own origin.
 * The file came from outside, so only plain photo/video/audio types are shown
 * inline; anything else (html, svg, unknown) is a download and can never run
 * as a page on the panel's domain.
 */
const INLINE_MIME = /^(image\/(jpeg|png|gif|webp|heic|heif|avif)|video\/[a-z0-9.+-]+|audio\/[a-z0-9.+-]+)$/i;

export function mediaHeaders(mime: string | null | undefined): Record<string, string> {
  const type = (mime ?? "").split(";")[0].trim().toLowerCase();
  const inline = INLINE_MIME.test(type);
  return {
    "Content-Type": inline ? type : "application/octet-stream",
    ...(inline ? {} : { "Content-Disposition": "attachment" }),
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox; default-src 'none'",
    "Cache-Control": "private, max-age=86400",
  };
}
