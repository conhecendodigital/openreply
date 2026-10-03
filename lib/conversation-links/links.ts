/**
 * Conversation links: https://ig.me/m/<username>?ref=<code>. When someone opens
 * the DM through one, the webhook carries the ref and we tag the contact with
 * where they came from ("veio:story") and, optionally, fire a campaign.
 *
 * Meta: ref up to 2,083 chars, only letters, digits and - _ = (no ":" or
 * spaces). Needs the Instagram app (not web, 235+), the app in Live mode, and
 * Ice Breakers set on the account to get the ref of a NEW conversation.
 */
export const CODE_PATTERN = /^[A-Za-z0-9_=-]{1,64}$/;
export const LINK_ORIGINS = ["story", "bio", "pagina", "reels", "anuncio", "outro"] as const;

export function isValidCode(code: string): boolean {
  return CODE_PATTERN.test(code);
}

/** Origin as a short tag-safe word: "story", "bio", "pagina" or free text. */
export function normalizeOrigin(origin: string): string {
  return origin
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
}

export function buildIgMeUrl(username: string, code: string): string {
  const user = username.replace(/^@/, "").trim();
  return `https://ig.me/m/${encodeURIComponent(user)}?ref=${encodeURIComponent(code)}`;
}

/** Our counted redirect (/c/<code> -> 302 ig.me), for a story or bio link. */
export function buildClickUrl(baseUrl: string, code: string): string {
  return `${baseUrl.replace(/\/$/, "")}/c/${encodeURIComponent(code)}`;
}

/** A random code like "s7Kq2xP" when the owner does not pick one. */
export function randomCode(length = 7): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

export function defaultTagFor(origin: string): string {
  return `veio:${normalizeOrigin(origin) || "link"}`;
}
