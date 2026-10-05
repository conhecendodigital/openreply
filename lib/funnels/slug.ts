/**
 * Etapa 6: public address of a funnel, /q/<slug>. Global (no workspace in
 * the URL). Browser-safe.
 */
export const RESERVED_SLUGS = ["preview", "api", "new", "admin", "q", "r", "c", "login"];
export const MIN_SLUG = 3;
export const MAX_SLUG = 60;

export function slugify(name: string): string {
  let s = String(name ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG)
    .replace(/-+$/g, "");
  if (s.length < MIN_SLUG) s = s ? `${s}-quiz` : "quiz";
  if (RESERVED_SLUGS.includes(s)) s = `${s}-quiz`;
  return s;
}

export function isValidSlug(slug: string): boolean {
  return (
    typeof slug === "string" &&
    slug.length >= MIN_SLUG &&
    slug.length <= MAX_SLUG &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) &&
    !RESERVED_SLUGS.includes(slug)
  );
}

/** "chat" -> "chat-2", "chat-3"... (kept within MAX_SLUG). */
export function slugCandidate(base: string, n: number): string {
  if (n <= 1) return base;
  const suffix = `-${n}`;
  return `${base.slice(0, MAX_SLUG - suffix.length).replace(/-+$/g, "")}${suffix}`;
}
