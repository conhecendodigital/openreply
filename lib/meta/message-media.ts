/**
 * Media inside an Instagram DM (photo, video, audio, file, shared post, story
 * reply or mention), normalized from the Graph API message fields so the inbox
 * can render it. Meta CDN URLs expire, so they are never stored.
 */
export type MessageMediaType = "image" | "video" | "audio" | "file" | "share" | "story";

export interface MessageMedia {
  type: MessageMediaType;
  url: string;
  previewUrl?: string;
}

type MediaData = { url?: string; preview_url?: string } | undefined;

export interface RawMessageMediaFields {
  attachments?: {
    data?: Array<{
      image_data?: MediaData;
      video_data?: MediaData;
      audio_data?: MediaData;
      file_url?: string;
      mime_type?: string;
      // Webhook-style shape, kept for safety.
      type?: string;
      payload?: { url?: string };
    }>;
  };
  shares?: { data?: Array<{ link?: string }> };
  story?: { reply_to?: { link?: string }; mention?: { link?: string } };
}

function typeFromMime(mime: string | undefined): MessageMediaType {
  if (!mime) return "file";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "file";
}

type RawAttachment = NonNullable<NonNullable<RawMessageMediaFields["attachments"]>["data"]>[number];

function asMediaType(value: string | undefined): MessageMediaType | null {
  return value === "image" || value === "video" || value === "audio" ? value : null;
}

/**
 * One attachment, in whichever shape Meta used: Graph API `*_data` objects,
 * `file_url` + mime type, or the webhook `{type, payload: {url}}`. Unknown
 * `<kind>_data.url` keys are accepted too, since the shape differs by media type.
 */
function fromAttachment(a: RawAttachment): MessageMedia | null {
  if (a.image_data?.url) return { type: "image", url: a.image_data.url, previewUrl: a.image_data.preview_url };
  if (a.video_data?.url) return { type: "video", url: a.video_data.url, previewUrl: a.video_data.preview_url };
  if (a.audio_data?.url) return { type: "audio", url: a.audio_data.url };
  if (a.payload?.url) return { type: asMediaType(a.type) ?? "file", url: a.payload.url };
  if (a.file_url) return { type: asMediaType(a.type) ?? typeFromMime(a.mime_type), url: a.file_url };

  for (const [key, value] of Object.entries(a as Record<string, unknown>)) {
    const url = (value as { url?: unknown } | null)?.url;
    if (key.endsWith("_data") && typeof url === "string") {
      return { type: asMediaType(key.replace(/_data$/, "")) ?? "file", url };
    }
  }
  return null;
}

/** Attachments from a stored webhook `message` object (always the `{type, payload}` shape). */
export function extractWebhookMedia(webhookMessage: unknown): MessageMedia[] {
  const attachments = (webhookMessage as { attachments?: RawAttachment[] } | null)?.attachments;
  if (!Array.isArray(attachments)) return [];
  return attachments.map(fromAttachment).filter((m): m is MessageMedia => m !== null);
}

export function extractMessageMedia(message: RawMessageMediaFields): MessageMedia[] {
  const media: MessageMedia[] = [];

  for (const a of message.attachments?.data ?? []) {
    const item = fromAttachment(a);
    if (item) media.push(item);
  }

  for (const s of message.shares?.data ?? []) {
    if (s.link) media.push({ type: "share", url: s.link });
  }

  const storyLink = message.story?.reply_to?.link ?? message.story?.mention?.link;
  if (storyLink) media.push({ type: "story", url: storyLink });

  return media;
}

/** Short label for a media-only message in the conversation list. */
export function mediaLabel(media: MessageMedia[]): string {
  const first = media[0];
  if (!first) return "";
  const labels: Record<MessageMediaType, string> = {
    image: "📷 Photo",
    video: "🎥 Video",
    audio: "🎤 Audio",
    file: "📎 File",
    share: "🔗 Shared post",
    story: "📖 Story",
  };
  return labels[first.type];
}
