import { getMetaGraphApiVersion, requireEnv } from "@/lib/env";
import type { RawMessageMediaFields } from "@/lib/meta/message-media";
import { WEBHOOK_SUBSCRIBED_FIELDS } from "@/lib/meta/webhook-fields";
import { isFacebookPageToken } from "@/lib/meta/platform";

function instagramGraphBase() {
  return `https://graph.instagram.com/${getMetaGraphApiVersion()}`;
}

function facebookGraphBase() {
  return `https://graph.facebook.com/${getMetaGraphApiVersion()}`;
}

// 23/10/2026: Page token (EAA...) -> graph.facebook.com (lib/meta/platform.ts).
export { isFacebookPageToken };

function graphBaseFor(accessToken: string) {
  return isFacebookPageToken(accessToken) ? facebookGraphBase() : instagramGraphBase();
}

/** Webhook fields a Facebook Page subscribes to (POST /<PAGE_ID>/subscribed_apps). */
export const FACEBOOK_PAGE_WEBHOOK_FIELDS = [
  "feed",
  "messages",
  "messaging_postbacks",
  "messaging_referrals",
  "message_reads",
  "message_echoes",
];

export class MetaApiError extends Error {
  constructor(
    public code: number,
    public subcode: number | undefined,
    public fbTraceId: string | undefined,
    message: string
  ) {
    super(message);
    this.name = "MetaApiError";
  }
}

export class TokenExpiredError extends MetaApiError {
  constructor(message: string, fbTraceId?: string) {
    super(190, undefined, fbTraceId, message);
    this.name = "TokenExpiredError";
  }
}

export class RateLimitError extends MetaApiError {
  constructor(message: string, fbTraceId?: string) {
    super(368, undefined, fbTraceId, message);
    this.name = "RateLimitError";
  }
}

export class PermissionError extends MetaApiError {
  constructor(message: string, fbTraceId?: string) {
    super(100, undefined, fbTraceId, message);
    this.name = "PermissionError";
  }
}

interface GraphApiError {
  error: {
    message: string;
    type: string;
    code: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

export interface InstagramUser {
  id: string;
  // Instagram professional account ID. This — not `id` (the app-scoped ID) —
  // is what appears as entry.id in webhooks and is used by the messaging API.
  user_id?: string;
  username: string;
  name?: string;
  profile_picture_url?: string;
  // Current follower total. Point-in-time only — Instagram exposes no history
  // for this field, so long-run trends come from FollowerSnapshot instead.
  followers_count?: number;
}

export interface InstagramComment {
  id: string;
  text: string;
  from?: {
    id: string;
    username?: string;
  };
  timestamp: string;
  // Present when the comments query asks for replies{from}. Used to tell whether
  // the account owner has already replied to this comment.
  replies?: {
    data?: { id: string; from?: { id: string; username?: string } }[];
  };
  /** Só em resposta a outro comentário (listAllMediaComments). */
  parent_id?: string;
}

/** A comment as the Pages API returns it (message/created_time, from.name). */
interface FacebookComment {
  id: string;
  message?: string;
  created_time?: string;
  from?: { id: string; name?: string };
  comments?: { data?: { id: string; from?: { id: string; name?: string } }[] };
}

/** Same shape as an Instagram comment, so callers stay unchanged. */
function toInstagramComment(c: FacebookComment): InstagramComment {
  return {
    id: c.id,
    text: c.message ?? "",
    timestamp: c.created_time ?? "",
    ...(c.from ? { from: { id: c.from.id, username: c.from.name } } : {}),
    ...(c.comments
      ? {
          replies: {
            data: (c.comments.data ?? []).map((r) => ({
              id: r.id,
              ...(r.from ? { from: { id: r.from.id, username: r.from.name } } : {}),
            })),
          },
        }
      : {}),
  };
}

export interface InstagramMedia {
  id: string;
  caption?: string;
  media_type: string;
  media_product_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  timestamp: string;
  permalink?: string;
  like_count?: number;
  comments_count?: number;
}

export interface InstagramMediaInsights {
  views?: number;
  reach?: number;
  likes?: number;
  comments?: number;
  saved?: number;
  shares?: number;
  total_interactions?: number;
}

interface TokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

async function handleResponse<T>(response: Response): Promise<T> {
  const data = await response.json();

  if (!response.ok || (data as GraphApiError).error) {
    const err = (data as GraphApiError).error;
    const code = err?.code ?? response.status;
    const subcode = err?.error_subcode;
    const traceId = err?.fbtrace_id;
    // Without the path a Meta error is unattributable: a connect runs several
    // calls in a row that fail with the identical message. The query string is
    // dropped on purpose — it carries the access token.
    let path = "";
    try {
      path = ` (${new URL(response.url).pathname})`;
    } catch {}
    const message = `${err?.message ?? "Unknown Meta API error"}${path} [code=${code} sub=${subcode ?? "-"} type=${err?.type ?? "-"} trace=${traceId ?? "-"}]`;

    switch (code) {
      case 190:
        throw new TokenExpiredError(message, traceId);
      case 368:
      case 4:
      case 17:
        throw new RateLimitError(message, traceId);
      case 10:
      case 100:
      case 200:
        throw new PermissionError(message, traceId);
      default:
        throw new MetaApiError(code, subcode, traceId, message);
    }
  }

  return data as T;
}

/**
 * Options for a send. `metadata` is a custom string Meta echoes back on the
 * message_echoes webhook (Messenger documents it; ChatbotX relies on it for
 * Instagram Login too). We use "le:<origin>:<ledgerId>" so an echo of our own
 * send is never mistaken for the owner typing on the phone.
 */
export interface SendOptions {
  metadata?: string;
}

// If Meta ever rejects the metadata field, stop sending it for the life of the
// process (the ledger + text match still classify echoes) instead of breaking
// every DM.
let metadataDisabled = process.env.META_SEND_METADATA === "0";

export function resetSendMetadataForTests() {
  metadataDisabled = process.env.META_SEND_METADATA === "0";
}

function isMetadataRejection(error: unknown): boolean {
  return (
    error instanceof MetaApiError &&
    (error.code === 100 || error.code === 400) &&
    /metadata/i.test(error.message)
  );
}

async function postMessage(
  accessToken: string,
  instagramAccountId: string,
  recipient: { id: string } | { comment_id: string },
  message: Record<string, unknown>,
  options?: SendOptions
): Promise<{ recipient_id: string; message_id: string }> {
  const send = async (withMetadata: boolean) => {
    const response = await fetch(
      `${graphBaseFor(accessToken)}/${instagramAccountId}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          recipient,
          message:
            withMetadata && options?.metadata
              ? { ...message, metadata: options.metadata.slice(0, 1000) }
              : message,
        }),
      }
    );
    return handleResponse<{ recipient_id: string; message_id: string }>(response);
  };

  const withMetadata = Boolean(options?.metadata) && !metadataDisabled;
  try {
    return await send(withMetadata);
  } catch (error) {
    // A rejected parameter means nothing was sent, so one retry is safe.
    if (withMetadata && isMetadataRejection(error)) {
      metadataDisabled = true;
      console.warn("[Meta] metadata rejected on send; continuing without it");
      return send(false);
    }
    throw error;
  }
}

/**
 * "Digitando..." (sender_action typing_on). Confirmado na doc oficial da Meta
 * (Instagram API with Instagram Login > Messaging API > Sender Actions, lida em
 * 28/10/2026): POST /<IG_ID>/messages com só `recipient` e `sender_action`
 * ("typing_on" | "typing_off" | "mark_seen"); só aparece se a pessoa estiver
 * com o app aberto. É um enfeite: qualquer erro é engolido e NUNCA impede a DM.
 * Desliga com META_TYPING_INDICATOR=0.
 */
export async function sendTypingIndicator(
  accessToken: string,
  instagramAccountId: string,
  userId: string,
  action: "typing_on" | "typing_off" = "typing_on"
): Promise<boolean> {
  if (process.env.META_TYPING_INDICATOR === "0") return false;
  try {
    const response = await fetch(`${graphBaseFor(accessToken)}/${instagramAccountId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ recipient: { id: userId }, sender_action: action }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function buttonTemplate(text: string, buttons: unknown[]) {
  return {
    attachment: {
      type: "template",
      payload: {
        template_type: "button",
        // Button template text is capped at 640 chars by Meta.
        text: text.slice(0, 640),
        buttons,
      },
    },
  };
}

export async function sendPrivateReply(
  accessToken: string,
  instagramAccountId: string,
  commentId: string,
  message: string,
  options?: SendOptions
): Promise<{ recipient_id: string; message_id: string }> {
  return postMessage(accessToken, instagramAccountId, { comment_id: commentId }, { text: message }, options);
}

/**
 * Send a private reply to a comment as a button template — an opening message
 * plus a postback button. Tapping the button opens the conversation and fires
 * a `messaging_postbacks` webhook carrying `payload`, which we use to deliver
 * the follow-up ("reveal") message.
 */
export async function sendPrivateReplyWithButton(
  accessToken: string,
  instagramAccountId: string,
  commentId: string,
  text: string,
  buttonTitle: string,
  payload: string,
  options?: SendOptions
): Promise<{ recipient_id: string; message_id: string }> {
  return postMessage(
    accessToken,
    instagramAccountId,
    { comment_id: commentId },
    buttonTemplate(text, [{ type: "postback", title: buttonTitle.slice(0, 20), payload }]),
    options
  );
}

/**
 * Send a direct message (to a user's IGSID) as a button template with a single
 * postback button. Used to re-prompt a user during follow-gating, so tapping
 * the button fires another `messaging_postbacks` webhook carrying `payload`.
 */
export async function sendDirectMessageWithButton(
  accessToken: string,
  instagramAccountId: string,
  userId: string,
  text: string,
  buttonTitle: string,
  payload: string,
  options?: SendOptions
): Promise<{ recipient_id: string; message_id: string }> {
  return postMessage(
    accessToken,
    instagramAccountId,
    { id: userId },
    buttonTemplate(text, [{ type: "postback", title: buttonTitle.slice(0, 20), payload }]),
    options
  );
}

/**
 * Check whether a user (by their IGSID) follows the business account, via the
 * Instagram Messaging profile API. Available for users in an active
 * conversation (e.g. after a private reply or a button tap). Returns true or
 * false, or `null` when Meta does not return the field — so callers can decide
 * how to treat the unverifiable case.
 */
export async function getUserFollowStatus(
  accessToken: string,
  recipientId: string
): Promise<boolean | null> {
  // A Page has no "follows" check in Messenger: unverifiable.
  if (isFacebookPageToken(accessToken)) return null;
  const url = new URL(`${instagramGraphBase()}/${recipientId}`);
  url.searchParams.set("fields", "is_user_follow_business");

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    const data = await response.json();
    return typeof data?.is_user_follow_business === "boolean"
      ? data.is_user_follow_business
      : null;
  } catch {
    return null;
  }
}

export interface InstagramUserProfile {
  username: string | null;
  name: string | null;
  profilePic: string | null;
}

/**
 * Profile of someone who messaged the account (User Profile API:
 * GET /<IGSID>?fields=username,name,profile_pic with the account's token).
 * Meta only answers for people who sent a DM / consented; anyone else comes
 * back as a PermissionError (code 100/10/200) or code 230. Throws the usual
 * TokenExpiredError / RateLimitError / PermissionError / MetaApiError.
 */
export async function getUserProfile(
  accessToken: string,
  igsid: string
): Promise<InstagramUserProfile> {
  const clean = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  if (isFacebookPageToken(accessToken)) {
    // Messenger User Profile API (PSID): no username, first/last name instead.
    const fbUrl = new URL(`${facebookGraphBase()}/${encodeURIComponent(igsid)}`);
    fbUrl.searchParams.set("fields", "first_name,last_name,profile_pic");
    const fb = await handleResponse<{ first_name?: string; last_name?: string; profile_pic?: string }>(
      await fetch(fbUrl.toString(), { headers: { Authorization: `Bearer ${accessToken}` } })
    );
    const name = [clean(fb?.first_name), clean(fb?.last_name)].filter(Boolean).join(" ");
    return { username: null, name: name || null, profilePic: clean(fb?.profile_pic) };
  }
  const url = new URL(`${instagramGraphBase()}/${encodeURIComponent(igsid)}`);
  url.searchParams.set("fields", "username,name,profile_pic");
  const response = await fetch(url.toString(), {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await handleResponse<{ username?: string; name?: string; profile_pic?: string }>(response);
  return {
    username: clean(data?.username),
    name: clean(data?.name),
    profilePic: clean(data?.profile_pic),
  };
}

/**
 * Números oficiais de quem mandou DM (User Profile API, doc da Meta lida em 28/10/2026):
 * GET /<IGSID>?fields=follower_count,is_user_follow_business com instagram_business_basic +
 * instagram_business_manage_messages. Só responde para quem deu consentimento (mandou DM ou tocou
 * num botão). Sem foto, sem mídia. Em token de Página do Facebook devolve nulos (não suportado aqui).
 * Qualquer erro vira nulos: o vendedor segue sem o dado.
 */
export async function getUserProfileMetrics(
  accessToken: string,
  igsid: string
): Promise<{ followerCount: number | null; followsBusiness: boolean | null; ok: boolean }> {
  if (isFacebookPageToken(accessToken)) return { followerCount: null, followsBusiness: null, ok: false };
  try {
    const url = new URL(`${instagramGraphBase()}/${encodeURIComponent(igsid)}`);
    url.searchParams.set("fields", "follower_count,is_user_follow_business");
    const data = await handleResponse<{ follower_count?: number; is_user_follow_business?: boolean }>(
      await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } })
    );
    return {
      followerCount: typeof data?.follower_count === "number" ? data.follower_count : null,
      followsBusiness: typeof data?.is_user_follow_business === "boolean" ? data.is_user_follow_business : null,
      ok: true,
    };
  } catch {
    return { followerCount: null, followsBusiness: null, ok: false };
  }
}

export interface InstagramStory {
  id: string;
  media_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp?: string;
}

/**
 * The account's live stories (GET /<IG_ID>/stories). Meta only returns the
 * ones still up (last 24 hours). Used by the campaign builder to pick the
 * story a "Resposta de story" campaign answers.
 */
export async function getStories(
  accessToken: string,
  instagramAccountId: string
): Promise<InstagramStory[]> {
  // Page stories are not exposed to the Messenger/Pages API.
  if (isFacebookPageToken(accessToken)) return [];
  const url = new URL(`${instagramGraphBase()}/${encodeURIComponent(instagramAccountId)}/stories`);
  url.searchParams.set("fields", "id,media_type,media_url,thumbnail_url,permalink,timestamp");
  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await handleResponse<{ data?: InstagramStory[] }>(response);
  return data.data ?? [];
}

/**
 * A tappable web_url button in a DM button template. Instagram's button
 * template supports up to 3 buttons; titles are capped at 20 chars by Meta.
 */
export interface LinkButton {
  title: string;
  url: string;
}

function toWebUrlButtons(buttons: LinkButton[]) {
  return buttons
    .slice(0, 3)
    .map((b) => ({ type: "web_url", url: b.url, title: b.title.slice(0, 20) }));
}

/**
 * Send a private reply to a comment as a button template with up to 3 web_url
 * buttons — the reveal message plus tappable link buttons (for campaigns with
 * no opening DM, where the reveal is delivered straight to the comment).
 */
export async function sendPrivateReplyWithLinkButton(
  accessToken: string,
  instagramAccountId: string,
  commentId: string,
  text: string,
  buttons: LinkButton[],
  options?: SendOptions
): Promise<{ recipient_id: string; message_id: string }> {
  return postMessage(
    accessToken,
    instagramAccountId,
    { comment_id: commentId },
    buttonTemplate(text, toWebUrlButtons(buttons)),
    options
  );
}

/**
 * Send a plain-text direct message to a user by their Instagram-scoped ID.
 * Used to deliver the reveal message after a button postback.
 */
export async function sendDirectMessage(
  accessToken: string,
  instagramAccountId: string,
  userId: string,
  message: string,
  options?: SendOptions
): Promise<{ recipient_id: string; message_id: string }> {
  return postMessage(accessToken, instagramAccountId, { id: userId }, { text: message }, options);
}

/**
 * Send a direct message as a button template with up to 3 web_url buttons —
 * the reveal message plus tappable link buttons (cleaner than inline URLs).
 */
export async function sendDirectMessageWithLinkButton(
  accessToken: string,
  instagramAccountId: string,
  userId: string,
  text: string,
  buttons: LinkButton[],
  options?: SendOptions
): Promise<{ recipient_id: string; message_id: string }> {
  return postMessage(
    accessToken,
    instagramAccountId,
    { id: userId },
    buttonTemplate(text, toWebUrlButtons(buttons)),
    options
  );
}

/**
 * Etapa 3 (flows): a button that either opens a link (web_url) or comes back
 * to us as a postback (payload). Up to 3 per message, title up to 20 chars.
 */
export type FlowMessageButton =
  | { kind: "link"; title: string; url: string }
  | { kind: "postback"; title: string; payload: string };

/** Who gets it: a person (IGSID) or the one private reply to a comment. */
export type FlowRecipient = { id: string } | { comment_id: string };

/**
 * Send one flow message: plain text, or a button template with mixed buttons
 * (web_url + postback). Text is capped at 640 chars with buttons (Meta) and
 * 1000 without.
 */
export async function sendFlowMessage(
  accessToken: string,
  instagramAccountId: string,
  recipient: FlowRecipient,
  text: string,
  buttons: FlowMessageButton[],
  options?: SendOptions
): Promise<{ recipient_id: string; message_id: string }> {
  if (buttons.length === 0) {
    return postMessage(accessToken, instagramAccountId, recipient, { text: text.slice(0, 1000) }, options);
  }
  return postMessage(
    accessToken,
    instagramAccountId,
    recipient,
    buttonTemplate(
      text,
      buttons.slice(0, 3).map((b) =>
        b.kind === "link"
          ? { type: "web_url", url: b.url, title: b.title.slice(0, 20) }
          : { type: "postback", title: b.title.slice(0, 20), payload: b.payload.slice(0, 1000) }
      )
    ),
    options
  );
}

/** Send an image by public https URL (flows; never as a private reply). */
export async function sendImageMessage(
  accessToken: string,
  instagramAccountId: string,
  userId: string,
  imageUrl: string,
  options?: SendOptions
): Promise<{ recipient_id: string; message_id: string }> {
  return postMessage(
    accessToken,
    instagramAccountId,
    { id: userId },
    { attachment: { type: "image", payload: { url: imageUrl } } },
    options
  );
}

export async function sendCommentReply(
  accessToken: string,
  commentId: string,
  message: string
): Promise<{ id: string }> {
  // Facebook: a reply to a comment is POST /<comment-id>/comments.
  const edge = isFacebookPageToken(accessToken) ? "comments" : "replies";
  const response = await fetch(
    `${graphBaseFor(accessToken)}/${commentId}/${edge}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ message }),
    }
  );

  return handleResponse(response);
}

/**
 * Hide (or unhide) a comment on one of our posts. Instagram API with Instagram
 * Login: POST /{ig-comment-id}?hide=true|false, needs
 * instagram_business_manage_comments (already requested at connect). The media
 * owner's own comments always stay visible, and live comments are not
 * supported; both come back as Meta errors.
 */
export async function hideComment(
  accessToken: string,
  commentId: string,
  hidden: boolean
): Promise<{ success: boolean }> {
  const url = new URL(`${graphBaseFor(accessToken)}/${encodeURIComponent(commentId)}`);
  // Facebook Page comments use is_hidden; Instagram uses hide.
  url.searchParams.set(isFacebookPageToken(accessToken) ? "is_hidden" : "hide", String(hidden));
  const response = await fetch(url.toString(), {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  return handleResponse(response);
}

/** Current state of one comment (used to double-check a hide). */
export async function getComment(
  accessToken: string,
  commentId: string,
  fields = "id,hidden,text,username,timestamp"
): Promise<{ id: string; hidden?: boolean; text?: string; username?: string; timestamp?: string }> {
  if (isFacebookPageToken(accessToken)) {
    const fbUrl = new URL(`${facebookGraphBase()}/${encodeURIComponent(commentId)}`);
    fbUrl.searchParams.set("fields", "id,is_hidden,message,from,created_time");
    const c = await handleResponse<FacebookComment & { is_hidden?: boolean }>(
      await fetch(fbUrl.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(15_000),
      })
    );
    return {
      id: c.id,
      hidden: c.is_hidden,
      text: c.message,
      username: c.from?.name,
      timestamp: c.created_time,
    };
  }
  const url = new URL(`${instagramGraphBase()}/${encodeURIComponent(commentId)}`);
  url.searchParams.set("fields", fields);
  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  return handleResponse(response);
}

export async function getMediaComments(
  accessToken: string,
  mediaId: string
): Promise<InstagramComment[]> {
  if (isFacebookPageToken(accessToken)) {
    const fbUrl = new URL(`${facebookGraphBase()}/${mediaId}/comments`);
    fbUrl.searchParams.set("fields", "id,message,from,created_time");
    fbUrl.searchParams.set("access_token", accessToken);
    const fb = await handleResponse<{ data: FacebookComment[] }>(await fetch(fbUrl.toString()));
    return (fb.data ?? []).map(toInstagramComment);
  }
  const url = new URL(`${instagramGraphBase()}/${mediaId}/comments`);
  url.searchParams.set("fields", "id,text,from,timestamp");
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url.toString());
  const data = await handleResponse<{ data: InstagramComment[] }>(response);
  return data.data;
}

/**
 * Recent comments on a media, newest first, each with its replies so the caller
 * can tell whether the account owner has already responded. Pagination stops as
 * soon as it reaches comments older than `sinceMs` (or the `max` ceiling), so a
 * viral post's entire back-catalogue is never pulled — only what is recent
 * enough to still act on. This is what the polling reconciler reads.
 *
 * Note: comments hidden by Instagram's Hidden Words / spam filter may not be
 * returned by the Graph API at all. Disable that filter on the account to widen
 * results.
 */
export async function getRecentMediaComments(
  accessToken: string,
  mediaId: string,
  sinceMs: number,
  max = 800
): Promise<InstagramComment[]> {
  const results: InstagramComment[] = [];

  const facebook = isFacebookPageToken(accessToken);
  const first = new URL(`${graphBaseFor(accessToken)}/${mediaId}/comments`);
  first.searchParams.set(
    "fields",
    facebook ? "id,message,created_time,from,comments{from}" : "id,text,timestamp,from,replies{from}"
  );
  first.searchParams.set("order", "reverse_chronological");
  first.searchParams.set("limit", "50");
  first.searchParams.set("access_token", accessToken);

  let nextUrl: string | null = first.toString();

  while (nextUrl !== null && results.length < max) {
    const response: Response = await fetch(nextUrl);
    const page = await handleResponse<{
      data: (InstagramComment | FacebookComment)[];
      paging?: { next?: string };
    }>(response);
    const data = (page.data ?? []).map((c) =>
      facebook ? toInstagramComment(c as FacebookComment) : (c as InstagramComment)
    );
    results.push(...data);

    // Newest-first, so once the last item on a page predates the window there
    // is nothing older worth fetching.
    const oldest = data[data.length - 1];
    if (oldest?.timestamp && Date.parse(oldest.timestamp) < sinceMs) break;
    nextUrl = page.paging?.next ?? null;
  }

  return results
    .filter((c) => !c.timestamp || Date.parse(c.timestamp) >= sinceMs)
    .slice(0, max);
}

/**
 * Resgatar comentários (28/10/2026): TODOS os comentários de um post, do mais
 * novo pro mais velho, sem filtro de data e sem pedir as respostas de cada um
 * (payload menor: um reel com milhares de comentários). Só leitura. O corte de
 * 7 dias é de quem chama. `truncated` = parou no teto `max` com mais páginas.
 * Se a Meta falhar no meio, a função lança: quem chama não executa nada com
 * uma leitura incompleta.
 */
export async function listAllMediaComments(
  accessToken: string,
  mediaId: string,
  max = 20_000
): Promise<{ comments: InstagramComment[]; truncated: boolean }> {
  if (isFacebookPageToken(accessToken)) {
    const comments = await getRecentMediaComments(accessToken, mediaId, 0, max);
    return { comments, truncated: comments.length >= max };
  }
  const first = new URL(`${graphBaseFor(accessToken)}/${mediaId}/comments`);
  first.searchParams.set("fields", "id,text,timestamp,from,parent_id");
  first.searchParams.set("limit", "50");
  first.searchParams.set("access_token", accessToken);
  const comments: InstagramComment[] = [];
  let nextUrl: string | null = first.toString();
  while (nextUrl !== null && comments.length < max) {
    const response: Response = await fetch(nextUrl);
    const page = await handleResponse<{
      data: (InstagramComment & { parent_id?: string })[];
      paging?: { next?: string };
    }>(response);
    comments.push(...(page.data ?? []));
    nextUrl = page.paging?.next ?? null;
  }
  return { comments: comments.slice(0, max), truncated: nextUrl !== null };
}

// --- Direct message inbox (Conversations API) ---------------------------

export interface InstagramParticipant {
  id: string;
  username?: string;
}

export interface InstagramMessage extends RawMessageMediaFields {
  id: string;
  created_time?: string;
  message?: string;
  from?: InstagramParticipant;
  to?: { data: InstagramParticipant[] };
}

// Media fields for DMs (photos, videos, audio, shared posts, story replies).
// Requested separately so that, if Meta rejects one of them, the inbox falls
// back to text-only instead of breaking.
const MESSAGE_MEDIA_FIELDS =
  "attachments{image_data,video_data,audio_data,file_url,mime_type},shares{link},story";

async function fetchWithMediaFallback<T>(
  buildUrl: (withMedia: boolean) => URL
): Promise<T> {
  try {
    return await handleResponse<T>(await fetch(buildUrl(true).toString()));
  } catch (err) {
    if (err instanceof TokenExpiredError || err instanceof RateLimitError) throw err;
    console.warn("[Meta] Media fields rejected, retrying text-only:", err);
    return handleResponse<T>(await fetch(buildUrl(false).toString()));
  }
}

export interface InstagramConversation {
  id: string;
  updated_time?: string;
  participants?: { data: InstagramParticipant[] };
  messages?: { data: InstagramMessage[] };
}

/**
 * List the account's DM conversations, newest first, each with its participants
 * and a one-message preview. `igUserId` is the account's professional user_id
 * (the same id used to send messages and as webhook entry.id).
 */
export async function getConversations(
  accessToken: string,
  igUserId: string
): Promise<InstagramConversation[]> {
  const data = await fetchWithMediaFallback<{ data: InstagramConversation[] }>(
    (withMedia) => {
      const url = new URL(`${graphBaseFor(accessToken)}/${igUserId}/conversations`);
      url.searchParams.set("platform", isFacebookPageToken(accessToken) ? "messenger" : "instagram");
      url.searchParams.set(
        "fields",
        `participants,updated_time,messages.limit(1){message,from,created_time${withMedia ? `,${MESSAGE_MEDIA_FIELDS}` : ""}}`
      );
      url.searchParams.set("limit", "50");
      url.searchParams.set("access_token", accessToken);
      return url;
    }
  );
  return data.data ?? [];
}

/**
 * The conversation id of ONE person, even when it is not among the recent
 * ones getConversations returns. Meta Conversations API ("Find a conversation
 * with a specific person"): GET /<IG_ID>/conversations?user_id=<IGSID>.
 * Only for Instagram tokens (the doc does not cover the Page/messenger case).
 */
export async function findConversationIdByUser(
  accessToken: string,
  igUserId: string,
  contactIgUserId: string
): Promise<string | null> {
  if (isFacebookPageToken(accessToken)) return null;
  const url = new URL(`${graphBaseFor(accessToken)}/${igUserId}/conversations`);
  url.searchParams.set("platform", "instagram");
  url.searchParams.set("user_id", contactIgUserId);
  url.searchParams.set("access_token", accessToken);
  const data = await handleResponse<{ data?: { id: string }[] }>(await fetch(url.toString()));
  return data.data?.[0]?.id ?? null;
}

/**
 * The messages in a conversation, with content. Meta only returns full details
 * for the 20 most recent messages, newest first.
 */
export async function getConversationMessages(
  accessToken: string,
  conversationId: string
): Promise<InstagramMessage[]> {
  const data = await fetchWithMediaFallback<{ messages?: { data: InstagramMessage[] } }>(
    (withMedia) => {
      const url = new URL(`${graphBaseFor(accessToken)}/${conversationId}`);
      url.searchParams.set(
        "fields",
        `messages{id,created_time,from,to,message${withMedia ? `,${MESSAGE_MEDIA_FIELDS}` : ""}}`
      );
      url.searchParams.set("access_token", accessToken);
      return url;
    }
  );
  return data.messages?.data ?? [];
}

export async function getUserInfo(accessToken: string): Promise<InstagramUser> {
  if (isFacebookPageToken(accessToken)) {
    // With a Page token, /me is the Page.
    const fbUrl = new URL(`${facebookGraphBase()}/me`);
    fbUrl.searchParams.set("fields", "id,name,username,picture{url},followers_count,fan_count");
    fbUrl.searchParams.set("access_token", accessToken);
    const page = await handleResponse<{
      id: string;
      name?: string;
      username?: string;
      picture?: { data?: { url?: string } };
      followers_count?: number;
      fan_count?: number;
    }>(await fetch(fbUrl.toString()));
    return {
      id: page.id,
      user_id: page.id,
      username: page.username || page.name || page.id,
      name: page.name,
      profile_picture_url: page.picture?.data?.url,
      followers_count: page.followers_count ?? page.fan_count,
    };
  }
  const url = new URL(`${instagramGraphBase()}/me`);
  url.searchParams.set(
    "fields",
    "id,user_id,username,name,profile_picture_url,followers_count"
  );
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url.toString());
  return handleResponse<InstagramUser>(response);
}

const MEDIA_FIELDS =
  "id,caption,media_type,media_product_type,media_url,thumbnail_url,timestamp,permalink,like_count,comments_count";

// Page posts (GET /<PAGE_ID>/posts), mapped to the Instagram media shape so
// the campaign post picker and reports keep working.
const FACEBOOK_POST_FIELDS =
  "id,message,created_time,permalink_url,full_picture,comments.summary(true).limit(0),reactions.summary(true).limit(0)";

interface FacebookPost {
  id: string;
  message?: string;
  created_time: string;
  permalink_url?: string;
  full_picture?: string;
  comments?: { summary?: { total_count?: number } };
  reactions?: { summary?: { total_count?: number } };
}

function fromFacebookPost(p: FacebookPost): InstagramMedia {
  return {
    id: p.id,
    caption: p.message,
    media_type: p.full_picture ? "IMAGE" : "TEXT",
    media_product_type: "FACEBOOK_POST",
    media_url: p.full_picture,
    thumbnail_url: p.full_picture,
    timestamp: p.created_time,
    permalink: p.permalink_url,
    like_count: p.reactions?.summary?.total_count,
    comments_count: p.comments?.summary?.total_count,
  };
}

// Instagram caps a single media page at 100 items.
const MEDIA_PAGE_SIZE = 100;

export async function getUserMedia(
  accessToken: string,
  limit = 25
): Promise<InstagramMedia[]> {
  if (isFacebookPageToken(accessToken)) return getAllUserMedia(accessToken, limit);
  const url = new URL(`${instagramGraphBase()}/me/media`);
  url.searchParams.set("fields", MEDIA_FIELDS);
  url.searchParams.set("limit", limit.toString());
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url.toString());
  const data = await handleResponse<{ data: InstagramMedia[] }>(response);
  return data.data;
}

/**
 * Fetch media by following pagination cursors until `max` items are collected
 * or there are no more pages. Pass a large `max` for an "all time" view; the
 * cap is a safety ceiling so an account with thousands of posts can't spin
 * forever (and so downstream per-media insight calls stay bounded).
 */
export async function getAllUserMedia(
  accessToken: string,
  max = 500
): Promise<InstagramMedia[]> {
  const results: InstagramMedia[] = [];
  const facebook = isFacebookPageToken(accessToken);

  const first = new URL(`${graphBaseFor(accessToken)}/me/${facebook ? "posts" : "media"}`);
  first.searchParams.set("fields", facebook ? FACEBOOK_POST_FIELDS : MEDIA_FIELDS);
  first.searchParams.set("limit", String(Math.min(facebook ? 100 : MEDIA_PAGE_SIZE, max)));
  first.searchParams.set("access_token", accessToken);

  let nextUrl: string | null = first.toString();

  while (nextUrl !== null && results.length < max) {
    const response: Response = await fetch(nextUrl);
    const page = await handleResponse<{
      data: (InstagramMedia | FacebookPost)[];
      paging?: { next?: string };
    }>(response);
    results.push(
      ...(page.data ?? []).map((m) => (facebook ? fromFacebookPost(m as FacebookPost) : (m as InstagramMedia)))
    );
    nextUrl = page.paging?.next ?? null;
  }

  return results.slice(0, max);
}

/**
 * Fetch per-media insight metrics (views, reach, saved, shares, etc.).
 *
 * Requires the `instagram_business_manage_insights` permission — accounts
 * connected before that scope was requested will throw a PermissionError.
 * Metric validity varies by media type, so pass only metrics that apply to
 * the given media (e.g. `views` is not valid for image posts on some accounts).
 */
export async function getMediaInsights(
  accessToken: string,
  mediaId: string,
  metrics: string[]
): Promise<InstagramMediaInsights> {
  // Page post insights use other metric names: not mapped yet.
  if (isFacebookPageToken(accessToken)) return {};
  const url = new URL(`${instagramGraphBase()}/${mediaId}/insights`);
  url.searchParams.set("metric", metrics.join(","));
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url.toString());
  const data = await handleResponse<{
    data: Array<{ name: string; values: Array<{ value: number }> }>;
  }>(response);

  const result: InstagramMediaInsights = {};
  for (const entry of data.data) {
    result[entry.name as keyof InstagramMediaInsights] =
      entry.values?.[0]?.value ?? 0;
  }
  return result;
}

/** One day of net follower change, as reported by account insights. */
export interface FollowerCountPoint {
  /** ISO date (YYYY-MM-DD) the change is attributed to. */
  date: string;
  /** Net followers gained (or lost, if negative) that day. */
  delta: number;
}

// Instagram only retains ~30 days of account insights, and rejects windows
// wider than 30 days outright. Stay just inside the limit.
const FOLLOWER_INSIGHT_MAX_DAYS = 30;

/**
 * Fetch the daily net follower change for an account.
 *
 * Requires `instagram_business_manage_insights`. Note this metric is *not*
 * universally available: Instagram omits it for accounts under 100 followers
 * and it is unsupported on some account types. Callers must treat `null` as
 * "no series available" rather than an error — see the backfill in
 * `lib/reports/follower-history.ts`.
 *
 * Returns daily deltas, not running totals. Reconstruct absolute counts by
 * anchoring on a known `followers_count` and walking backwards.
 */
export async function getFollowerCountSeries(
  accessToken: string,
  instagramAccountId: string,
  days: number = FOLLOWER_INSIGHT_MAX_DAYS
): Promise<FollowerCountPoint[] | null> {
  if (isFacebookPageToken(accessToken)) return null;
  const span = Math.min(Math.max(days, 1), FOLLOWER_INSIGHT_MAX_DAYS);
  const until = Math.floor(Date.now() / 1000);
  const since = until - (span - 1) * 86_400;

  const url = new URL(`${instagramGraphBase()}/${instagramAccountId}/insights`);
  url.searchParams.set("metric", "follower_count");
  url.searchParams.set("period", "day");
  url.searchParams.set("since", String(since));
  url.searchParams.set("until", String(until));
  url.searchParams.set("access_token", accessToken);

  try {
    const response = await fetch(url.toString());
    const data = await handleResponse<{
      data: Array<{
        name: string;
        values: Array<{ value: number; end_time?: string }>;
      }>;
    }>(response);

    const metric = data.data.find((d) => d.name === "follower_count");
    if (!metric?.values?.length) return null;

    return metric.values.map((v) => ({
      date: (v.end_time ?? new Date().toISOString()).slice(0, 10),
      delta: v.value ?? 0,
    }));
  } catch (err) {
    // A missing permission is a real signal the caller may want to surface;
    // anything else here means the metric is simply unavailable for this
    // account, which is not worth failing the whole dashboard over.
    if (err instanceof PermissionError) throw err;
    console.warn(
      "[Instagram] follower_count insights unavailable:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

export async function getLongLivedToken(
  shortLivedToken: string
): Promise<{ accessToken: string; expiresIn: number }> {
  const url = new URL(`${instagramGraphBase()}/access_token`);
  url.searchParams.set("grant_type", "ig_exchange_token");
  url.searchParams.set("client_secret", requireEnv("INSTAGRAM_APP_SECRET"));
  url.searchParams.set("access_token", shortLivedToken);

  const response = await fetch(url.toString());
  const data = await handleResponse<TokenResponse>(response);

  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in ?? 5184000,
  };
}

export async function refreshLongLivedToken(
  longLivedToken: string
): Promise<{ accessToken: string; expiresIn: number }> {
  const url = new URL(`${instagramGraphBase()}/refresh_access_token`);
  url.searchParams.set("grant_type", "ig_refresh_token");
  url.searchParams.set("access_token", longLivedToken);

  const response = await fetch(url.toString());
  const data = await handleResponse<TokenResponse>(response);

  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in ?? 5184000,
  };
}

// The list lives in lib/meta/webhook-fields.ts (2026-10-06: + live_comments).
export { WEBHOOK_SUBSCRIBED_FIELDS };

export async function subscribeInstagramAccountToWebhooks(
  instagramAccountId: string,
  accessToken: string
): Promise<{ success: boolean }> {
  const response = await fetch(
    `${graphBaseFor(accessToken)}/${instagramAccountId}/subscribed_apps`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        subscribed_fields: isFacebookPageToken(accessToken)
          ? FACEBOOK_PAGE_WEBHOOK_FIELDS
          : WEBHOOK_SUBSCRIBED_FIELDS,
      }),
    }
  );

  return handleResponse(response);
}

/**
 * Stop Meta from sending this account's webhooks to the app
 * (DELETE /<IG_ID>/subscribed_apps). Used when a channel is disconnected.
 */
export async function unsubscribeInstagramAccountFromWebhooks(
  instagramAccountId: string,
  accessToken: string
): Promise<{ success: boolean }> {
  const response = await fetch(
    `${graphBaseFor(accessToken)}/${instagramAccountId}/subscribed_apps`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  return handleResponse(response);
}

/**
 * Webhook fields this app is subscribed to for the account
 * (GET /<IG_ID>/subscribed_apps). Empty when not subscribed.
 */
export async function getSubscribedWebhookFields(
  instagramAccountId: string,
  accessToken: string
): Promise<string[]> {
  const url = new URL(`${graphBaseFor(accessToken)}/${instagramAccountId}/subscribed_apps`);
  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await handleResponse<{
    data?: { subscribed_fields?: (string | { name?: string })[] }[];
  }>(response);
  const fields = new Set<string>();
  for (const app of data.data ?? []) {
    for (const field of app.subscribed_fields ?? []) {
      const name = typeof field === "string" ? field : field?.name;
      if (name) fields.add(name);
    }
  }
  return [...fields];
}

export async function debugToken(inputToken: string, accessToken: string) {
  const url = new URL(`${facebookGraphBase()}/debug_token`);
  url.searchParams.set("input_token", inputToken);
  url.searchParams.set("access_token", accessToken);
  const response = await fetch(url.toString());
  return handleResponse(response);
}
