/**
 * What a quiz shows when its link is shared (07/10/2026): the cover of the
 * quiz, never the Lead Engine card. Used by the public page (/q/<slug>, Open
 * Graph tags) and by the preview of a tracked link that points to a quiz.
 *
 * - title: SEO title, else the quiz name;
 * - description: SEO description, else the first text of the cover;
 * - image: "Sharing image" of the settings, else the first image of the cover
 *   (image, gallery, video poster or option photo). A GIF goes as it is: the
 *   apps show its first frame.
 *
 * Browser-safe (no imports from the server).
 */
import { isPlaceholderUrl } from "@/lib/funnels/media";

type ShareBlock = {
  type: string;
  text?: string;
  url?: string;
  images?: { url: string }[];
  posterUrl?: string;
  options?: { imageUrl?: string }[];
};

export type ShareableFunnel = {
  name: string;
  settings: { seo?: { title?: string; description?: string; imageUrl?: string } };
  steps: { blocks: ShareBlock[] }[];
};

export type ShareMeta = { title: string; description?: string; imageUrl?: string };

/** Markdown and {variables} out, spaces folded. */
function plain(text: string): string {
  return text
    .replace(/\{[^}]*\}/g, "")
    .replace(/[*_`#>]/g, "")
    .replace(/^\s*-\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** https absolute URL (relative ones resolve against `base`), or undefined. */
export function absoluteHttpsUrl(value: string | null | undefined, base?: string): string | undefined {
  const raw = value?.trim();
  if (!raw || isPlaceholderUrl(raw)) return undefined;
  try {
    const url = base ? new URL(raw, base) : new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function firstCoverImage(blocks: ShareBlock[], base?: string): string | undefined {
  for (const b of blocks) {
    const candidates =
      b.type === "image"
        ? [b.url]
        : b.type === "gallery"
          ? (b.images ?? []).map((i) => i.url)
          : b.type === "video"
            ? [b.posterUrl]
            : b.type === "options"
              ? (b.options ?? []).map((o) => o.imageUrl)
              : [];
    for (const c of candidates) {
      const url = absoluteHttpsUrl(c, base);
      if (url) return url;
    }
  }
  return undefined;
}

export function funnelShareMeta(funnel: ShareableFunnel, base?: string): ShareMeta {
  const seo = funnel.settings.seo ?? {};
  const cover = funnel.steps[0]?.blocks ?? [];
  const title = clip(plain(seo.title ?? "") || funnel.name.trim() || "Quiz", 120);
  const firstText = cover.find((b) => (b.type === "text" || b.type === "heading") && plain(b.text ?? "") && plain(b.text ?? "") !== title);
  const description = plain(seo.description ?? "") || (firstText ? plain(firstText.text ?? "") : "");
  const imageUrl = absoluteHttpsUrl(seo.imageUrl, base) ?? firstCoverImage(cover, base);
  return {
    title,
    ...(description ? { description: clip(description, 300) } : {}),
    ...(imageUrl ? { imageUrl } : {}),
  };
}
