export interface MessageTrackedLink {
  slug: string;
  destinationUrl: string;
}

const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/i;

function trimTrailingPunctuation(url: string) {
  return url.replace(/[.,!?;:]+$/, "");
}

export function extractFirstUrl(message: string): string | null {
  const match = message.match(URL_PATTERN);
  if (!match) return null;

  try {
    const url = trimTrailingPunctuation(match[0]);
    return new URL(url).toString();
  } catch {
    return null;
  }
}

export function replaceUrlWithTrackedPlaceholder(
  message: string,
  destinationUrl: string | null | undefined
) {
  if (!destinationUrl) return message;
  if (message.includes(destinationUrl)) {
    return message.replace(destinationUrl, "{link}");
  }

  const withoutTrailingSlash = destinationUrl.replace(/\/$/, "");
  return message.replace(withoutTrailingSlash, "{link}");
}

/**
 * Personalize {username} and strip the {link} token — used when the link is
 * delivered as a separate button rather than inline in the message text.
 */
export function renderMessageWithoutLink({
  message,
  commenterName,
}: {
  message: string;
  commenterName?: string | null;
}) {
  return message
    .replace(/\{username\}/gi, commenterName ?? "there")
    .replace(/\s*\{link\}\s*/gi, " ")
    .trim();
}

/**
 * Public /r/<slug> URL. `query` (without "?") is appended when given, e.g. the
 * signed recipient from lib/tracking/recipient.ts so a click is credited to
 * the person who got the DM.
 */
export function buildTrackedUrl(slug: string, baseUrl?: string, query?: string) {
  const resolvedBaseUrl =
    baseUrl ??
    (typeof window !== "undefined"
      ? window.location.origin
      : process.env.NEXTAUTH_URL ?? "http://localhost:3000");

  const url = `${resolvedBaseUrl.replace(/\/$/, "")}/r/${slug}`;
  return query ? `${url}?${query}` : url;
}

export function renderMessageWithTracking({
  message,
  commenterName,
  trackedLinks,
  baseUrl,
  linkQuery,
}: {
  message: string;
  commenterName?: string | null;
  trackedLinks?: MessageTrackedLink[];
  baseUrl?: string;
  /** Extra query per link slug (recipient attribution in private DMs). */
  linkQuery?: (slug: string) => string;
}) {
  let rendered = message.replace(/\{username\}/gi, commenterName ?? "there");
  const primaryLink = trackedLinks?.[0];

  if (!primaryLink) return rendered;

  const trackedUrl = buildTrackedUrl(
    primaryLink.slug,
    baseUrl,
    linkQuery?.(primaryLink.slug)
  );

  if (/\{link\}/i.test(rendered)) {
    return rendered.replace(/\{link\}/gi, trackedUrl);
  }

  if (rendered.includes(primaryLink.destinationUrl)) {
    rendered = rendered.replaceAll(primaryLink.destinationUrl, trackedUrl);
  } else {
    const withoutTrailingSlash = primaryLink.destinationUrl.replace(/\/$/, "");
    rendered = rendered.replaceAll(withoutTrailingSlash, trackedUrl);
  }

  return rendered;
}

/**
 * How a campaign delivers its link (Automation.dmFormat, 2026-10-06):
 * - BUTTON: Meta "button template", a card with the text and up to 3 link
 *   buttons. Looks nicer, but some Instagram versions (the web, older apps,
 *   the Requests folder) do not show the card at all: the person sees no
 *   message, and the API returns the message with empty text.
 * - TEXT: one plain text message with the tracked link inside. Shows for
 *   everyone, everywhere.
 */
export const DM_FORMATS = ["BUTTON", "TEXT"] as const;
export type DmFormatValue = (typeof DM_FORMATS)[number];

/** Meta's cap for a plain text DM (a button template caps at 640). */
export const DM_TEXT_LIMIT = 1000;

/** "button" / "TEXT" / " Text " -> "BUTTON" | "TEXT"; anything else -> undefined. */
export function parseDmFormat(value: unknown): DmFormatValue | undefined {
  if (typeof value !== "string") return undefined;
  const upper = value.trim().toUpperCase();
  return (DM_FORMATS as readonly string[]).includes(upper) ? (upper as DmFormatValue) : undefined;
}

// Labels the app stores by default for a link nobody named. In a text DM they
// would read as "Open link: https://...", so the URL goes alone.
const DEFAULT_LINK_LABELS = new Set(["open link", "primary campaign link"]);

export interface TextLink {
  url: string;
  label?: string | null;
}

/**
 * The text-format DM: the campaign message with the link inside it.
 * - `{link}` in the message becomes the primary URL (every occurrence);
 * - no `{link}`: the raw destination URL typed in the message is swapped for
 *   the tracked one, and if it is not there either, the URL goes at the end on
 *   its own line;
 * - each extra link (second button) goes on its own line, "Label: URL";
 * - over `limit`, the message text is cut (with "…") and never the links.
 *
 * Browser-safe on purpose: the worker passes the tracked URLs (with ?c=), the
 * campaign screen passes sample URLs for the preview.
 */
export function composeLinkText({
  message,
  commenterName,
  primary,
  destinationUrl,
  extraLinks = [],
  limit = DM_TEXT_LIMIT,
}: {
  message: string;
  commenterName?: string | null;
  /** The primary URL to put in the text. None: the message goes as it is. */
  primary?: string | null;
  /** The primary link's real destination, in case the owner typed it in the text. */
  destinationUrl?: string | null;
  extraLinks?: TextLink[];
  limit?: number;
}): string {
  const named = message.replace(/\{username\}/gi, commenterName ?? "there");
  if (!primary) return named.trim().slice(0, limit);

  const extraLines = extraLinks
    .filter((l) => l.url)
    .map((l) => {
      const label = l.label?.trim();
      return label && !DEFAULT_LINK_LABELS.has(label.toLowerCase()) ? `${label}: ${l.url}` : l.url;
    });

  const typed = [destinationUrl, destinationUrl?.replace(/\/$/, "")].filter(
    (u): u is string => Boolean(u)
  );
  let body: string;
  if (/\{link\}/i.test(named)) {
    body = named.replace(/\{link\}/gi, primary);
  } else if (typed.some((u) => named.includes(u))) {
    const found = typed.find((u) => named.includes(u)) as string;
    body = named.replaceAll(found, primary);
  } else {
    body = named.trim() ? `${named.trim()}\n${primary}` : primary;
  }

  const full = [body.trim(), ...extraLines].join("\n");
  if (full.length <= limit) return full;

  // Too long: keep every link whole, cut only the words.
  const tail = [primary, ...extraLines].join("\n");
  let words = named.replace(/\s*\{link\}\s*/gi, " ");
  for (const u of typed) words = words.replaceAll(u, "");
  words = words.replace(/[ \t]+/g, " ").trim();
  const room = limit - tail.length - 2; // "…" + "\n"
  if (room <= 0) return tail.slice(0, limit);
  return `${words.slice(0, room).trimEnd()}…\n${tail}`;
}
