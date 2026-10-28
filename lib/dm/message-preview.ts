/**
 * One place that turns a stored DM into the text a human reads (approvals
 * screen, inbox list, MCP/API lastMessages). Pure: no database, no Meta call.
 *
 * Why: a campaign card (button template) is stored with an empty `text`, and a
 * photo, audio, sticker or share has no text either, so screens that read only
 * `text` showed blank bubbles.
 */

export const EMPTY_CONVERSATION_PREVIEW = "Sem mensagens ainda";
export const UNKNOWN_MESSAGE_PREVIEW = "Mensagem sem texto (anexo). Abra no Instagram para ver.";
export const PREVIEW_MAX_CHARS = 200;

export type PreviewTemplate = {
  title?: unknown;
  subtitle?: unknown;
  buttons?: { title?: unknown }[] | null;
} | null;

export type PreviewInput = {
  text?: string | null;
  template?: unknown;
  /** Media row types (DirectMedia.type) and/or webhook attachment types. */
  media?: ({ type?: string | null } | string)[] | null;
  attachmentKinds?: string[] | null;
  storyReply?: boolean | null;
  storyKind?: string | null;
  fromMe?: boolean | null;
  deleted?: boolean | null;
  /** Reaction event (message_reactions webhook): the emoji, when known. */
  reaction?: boolean | string | null;
};

const KIND_LABELS: Record<string, string> = {
  image: "📷 Foto",
  sticker: "📷 Foto",
  video: "🎬 Vídeo",
  audio: "🎤 Áudio",
  file: "📎 Arquivo",
  share: "🔗 Compartilhou um post",
  ig_post: "🔗 Compartilhou um post",
  reel: "🔗 Compartilhou um reel",
  ig_reel: "🔗 Compartilhou um reel",
  story: "📖 Story",
  story_mention: "📖 Mencionou você num story",
  unsupported: UNKNOWN_MESSAGE_PREVIEW,
};

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Card text: title (or subtitle) plus "[botões: A | B]". Null when it has nothing. */
export function templatePreview(template: unknown): string | null {
  if (!template || typeof template !== "object") return null;
  const t = template as NonNullable<PreviewTemplate>;
  const head = clean(t.title) || clean(t.subtitle);
  const buttons = (Array.isArray(t.buttons) ? t.buttons : [])
    .map((b) => clean(b?.title))
    .filter(Boolean);
  const tail = buttons.length > 0 ? `[botões: ${buttons.join(" | ")}]` : "";
  const out = [head, tail].filter(Boolean).join(" ");
  return out || null;
}

function kindsOf(input: PreviewInput): string[] {
  const kinds: string[] = [];
  for (const m of input.media ?? []) {
    const type = typeof m === "string" ? m : m?.type;
    if (type) kinds.push(type);
  }
  for (const k of input.attachmentKinds ?? []) if (k) kinds.push(k);
  return kinds;
}

export function truncatePreview(text: string, max = PREVIEW_MAX_CHARS): string {
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : text;
}

/**
 * Display text in Portuguese. Never returns an empty string.
 * Text longer than `max` is cut in the preview only (stored text is untouched).
 */
export function messagePreviewText(input: PreviewInput | null | undefined, max = PREVIEW_MAX_CHARS): string {
  if (!input) return EMPTY_CONVERSATION_PREVIEW;
  if (input.deleted) return "🚫 Mensagem apagada";

  const text = clean(input.text);
  if (text) return truncatePreview(text, max);

  const card = templatePreview(input.template);
  if (card) return truncatePreview(card, max);

  if (input.reaction) return typeof input.reaction === "string" ? `❤️ Reação ${input.reaction}` : "❤️ Reação";

  if (input.storyKind === "mention") return "📖 Mencionou você num story";
  if (input.storyReply || input.storyKind === "reply") {
    return input.fromMe ? "↩️ Você respondeu ao story" : "↩️ Respondeu ao seu story";
  }

  const kinds = kindsOf(input);
  // A story mention/reply attachment wins over the generic label list order.
  for (const kind of kinds) {
    const label = KIND_LABELS[kind];
    if (label && kind !== "story") return label;
  }
  if (kinds.includes("story")) return KIND_LABELS.story;

  return UNKNOWN_MESSAGE_PREVIEW;
}

/** Last-message line of a conversation list: null/undefined -> "Sem mensagens ainda". */
export function conversationPreviewText(last: PreviewInput | null | undefined, max = PREVIEW_MAX_CHARS): string {
  return last ? messagePreviewText(last, max) : EMPTY_CONVERSATION_PREVIEW;
}
