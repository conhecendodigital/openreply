/**
 * 24/10/2026: campos de texto por rede no compositor (pedido do Matheus).
 * Instagram, TikTok e Facebook: legenda + hashtags (as hashtags vão no fim da legenda).
 * YouTube: título, descrição e tags (tags sem "#", limite total de 500 caracteres do YouTube).
 * Lógica pura, usada pela tela e pelos providers.
 */

/** Máximo de hashtags que o Instagram aceita numa legenda. */
export const INSTAGRAM_HASHTAG_MAX = 30;
/** O YouTube aceita no máximo 500 caracteres somando todas as tags. */
export const YOUTUBE_TAGS_TOTAL_MAX = 500;
export const YOUTUBE_TAG_MAX = 100;

const HASHTAG_RE = /#[\p{L}\p{N}_]+/gu;

/** Limpa uma hashtag digitada: tira "#", espaços e pontuação. Vazio = descartar. */
export function cleanHashtag(raw: string): string {
  return raw.replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "");
}

/** Limpa uma tag do YouTube: tira "#", sinais < > (o YouTube recusa) e espaços duplos. */
export function cleanYouTubeTag(raw: string): string {
  return raw
    .replace(/^#+/, "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, YOUTUBE_TAG_MAX);
}

/** Separa o que a pessoa digitou (vírgula, quebra de linha ou espaço com "#") e tira repetidas. */
export function splitList(input: string, clean: (s: string) => string): string[] {
  const parts = input.includes(",") || input.includes("\n") ? input.split(/[,\n]/) : input.split(/(?=#)|\s+/);
  const out: string[] = [];
  for (const p of parts) {
    const c = clean(p);
    if (c && !out.some((x) => x.toLowerCase() === c.toLowerCase())) out.push(c);
  }
  return out;
}

/** Junta a legenda com as hashtags no fim, separadas por uma linha em branco. */
export function joinCaptionHashtags(caption: string, hashtags: readonly string[]): string {
  const tags = hashtags.map(cleanHashtag).filter(Boolean);
  const text = caption.trimEnd();
  if (tags.length === 0) return text;
  const block = tags.map((h) => `#${h}`).join(" ");
  return text ? `${text}\n\n${block}` : block;
}

/** Ao editar: se o último parágrafo da legenda é só de hashtags, volta a separar. */
export function splitCaptionHashtags(full: string): { caption: string; hashtags: string[] } {
  const text = full.trimEnd();
  const idx = text.lastIndexOf("\n\n");
  const last = idx >= 0 ? text.slice(idx + 2) : text;
  const tokens = last.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || !tokens.every((tk) => /^#[\p{L}\p{N}_]+$/u.test(tk))) return { caption: full, hashtags: [] };
  return { caption: idx >= 0 ? text.slice(0, idx) : "", hashtags: tokens.map(cleanHashtag) };
}

export function countHashtags(text: string): number {
  return text.match(HASHTAG_RE)?.length ?? 0;
}

/** Tamanho que o YouTube conta: as tags separadas por vírgula, e tag com espaço ganha aspas. */
export function youtubeTagsLength(tags: readonly string[]): number {
  if (tags.length === 0) return 0;
  return tags.reduce((sum, tag) => sum + tag.length + (tag.includes(" ") ? 2 : 0), 0) + (tags.length - 1);
}
