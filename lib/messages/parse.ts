/**
 * Turn Instagram messaging webhooks into inbox messages we can store, so the
 * inbox keeps the full history (the Conversations API only returns the latest
 * 20) and media survives Meta's expiring CDN links.
 */

export type DirectMediaType = "image" | "video" | "audio" | "file" | "story" | "reel" | "share";

export interface ParsedDirectMedia {
  type: DirectMediaType;
  url: string;
  /** Downloadable now (Meta CDN); "share" links are just opened. */
  download: boolean;
}

export interface ParsedTemplate {
  title: string;
  subtitle?: string;
  buttons: { title: string; url?: string }[];
}

export interface ParsedDirectMessage {
  /** Our connected Instagram account id. */
  accountId: string;
  /** The other person in the conversation (IGSID). */
  contactId: string;
  fromMe: boolean;
  mid: string;
  text: string | null;
  sentAt: Date;
  media: ParsedDirectMedia[];
  template: ParsedTemplate | null;
  /** The person replied to (or mentioned us in) a story. */
  storyReply: boolean;
  /** Which story event: reply (to our story) or mention (of us in theirs). */
  storyKind: "reply" | "mention" | null;
  /** Our story's id (reply only). */
  storyId: string | null;
  deleted: boolean;
  /** Echo only: the custom string we sent as message.metadata ("le:..."). */
  metadata: string | null;
  /** Echo only, when Meta includes it: the app that sent the message. */
  appId: string | null;
}

type Attachment = {
  type?: string;
  payload?: {
    url?: string;
    title?: string;
    generic?: { elements?: Array<{ title?: string; subtitle?: string; buttons?: Array<{ title?: string; url?: string }> }> };
    elements?: Array<{ title?: string; subtitle?: string; buttons?: Array<{ title?: string; url?: string }> }>;
  };
};

type Messaging = {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    is_deleted?: boolean;
    is_unsupported?: boolean;
    metadata?: string;
    app_id?: string | number;
    attachments?: Attachment[];
    reply_to?: { story?: { url?: string; id?: string }; mid?: string };
  };
};

type Payload = { object?: string; entry?: Array<{ id?: string; time?: number; messaging?: Messaging[] }> };

const MEDIA_TYPES: Record<string, DirectMediaType> = {
  image: "image",
  video: "video",
  audio: "audio",
  file: "file",
  story_mention: "story",
  ig_reel: "reel",
  reel: "reel",
  share: "share",
  ig_post: "share",
};

function template(a: Attachment): ParsedTemplate | null {
  const el = a.payload?.generic?.elements?.[0] ?? a.payload?.elements?.[0];
  if (!el) return null;
  return {
    title: (el.title ?? "").trim(),
    subtitle: el.subtitle?.trim() || undefined,
    buttons: (el.buttons ?? []).map((b) => ({ title: (b.title ?? "").trim(), url: b.url })).filter((b) => b.title),
  };
}

export function parseDirectMessages(payload: unknown): ParsedDirectMessage[] {
  const p = payload as Payload;
  if (!p || p.object !== "instagram") return [];
  const out: ParsedDirectMessage[] = [];

  for (const entry of p.entry ?? []) {
    for (const m of entry.messaging ?? []) {
      const msg = m.message;
      if (!msg?.mid) continue;
      const sender = m.sender?.id;
      const recipient = m.recipient?.id;
      if (!sender || !recipient) continue;

      const fromMe = Boolean(msg.is_echo);
      const accountId = entry.id ?? (fromMe ? sender : recipient);
      const contactId = fromMe ? recipient : sender;
      if (!accountId || contactId === accountId) continue;

      const media: ParsedDirectMedia[] = [];
      let tpl: ParsedTemplate | null = null;
      for (const a of msg.attachments ?? []) {
        if (a.type === "template") {
          tpl = template(a) ?? tpl;
          continue;
        }
        const type = MEDIA_TYPES[a.type ?? ""] ?? (a.payload?.url ? "file" : null);
        if (type && a.payload?.url) {
          media.push({ type, url: a.payload.url, download: type !== "share" });
        }
      }
      const storyUrl = msg.reply_to?.story?.url;
      if (storyUrl) media.push({ type: "story", url: storyUrl, download: true });
      const storyKind: ParsedDirectMessage["storyKind"] = msg.reply_to?.story
        ? "reply"
        : (msg.attachments ?? []).some((a) => a.type === "story_mention")
          ? "mention"
          : null;
      const storyId = storyKind === "reply" && msg.reply_to?.story?.id ? String(msg.reply_to.story.id) : null;

      out.push({
        accountId,
        contactId,
        fromMe,
        mid: msg.mid,
        text: msg.text?.trim() || null,
        sentAt: new Date(m.timestamp ?? (entry.time ? entry.time * (entry.time < 1e12 ? 1000 : 1) : Date.now())),
        media,
        template: tpl,
        storyReply: Boolean(storyUrl) || media.some((x) => x.type === "story"),
        storyKind,
        storyId,
        deleted: Boolean(msg.is_deleted),
        metadata: typeof msg.metadata === "string" && msg.metadata ? msg.metadata : null,
        appId: msg.app_id !== undefined && msg.app_id !== null ? String(msg.app_id) : null,
      });
    }
  }
  return out;
}
