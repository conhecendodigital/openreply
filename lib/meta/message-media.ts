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

export function extractMessageMedia(message: RawMessageMediaFields): MessageMedia[] {
  const media: MessageMedia[] = [];

  for (const a of message.attachments?.data ?? []) {
    if (a.image_data?.url) {
      media.push({ type: "image", url: a.image_data.url, previewUrl: a.image_data.preview_url });
    } else if (a.video_data?.url) {
      media.push({ type: "video", url: a.video_data.url, previewUrl: a.video_data.preview_url });
    } else if (a.audio_data?.url) {
      media.push({ type: "audio", url: a.audio_data.url });
    } else if (a.file_url) {
      media.push({ type: typeFromMime(a.mime_type), url: a.file_url });
    } else if (a.payload?.url) {
      const t = a.type === "image" || a.type === "video" || a.type === "audio" ? a.type : "file";
      media.push({ type: t, url: a.payload.url });
    }
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
