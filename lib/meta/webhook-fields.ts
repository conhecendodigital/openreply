/**
 * Fields each connected account subscribes to (POST /<IG_ID>/subscribed_apps).
 * messaging_referral: ig.me?ref= into an existing thread; messaging_postbacks:
 * button and Ice Breaker taps (they carry the ref of a new thread);
 * messaging_seen: the read fallback; live_comments: comments during a live
 * (campaign trigger "Comentário em live"). Echoes of what the account sends
 * arrive on "messages" (is_echo), so no separate field is needed. Story
 * replies and story mentions also arrive on "messages".
 *
 * Accounts connected before a field was added must be subscribed again
 * (reconnect, or scripts/resubscribe-webhooks.ts). live_comments also has to
 * be ticked in the Meta app dashboard (Webhooks > Instagram).
 *
 * Kept apart from lib/meta/client.ts so screens and overviews can compare
 * against it without importing the Graph client.
 */
export const WEBHOOK_SUBSCRIBED_FIELDS = [
  "comments",
  "live_comments",
  "messages",
  "messaging_postbacks",
  "messaging_referral",
  "messaging_seen",
];

/** Fields we expect but the account is not subscribed to (Channels page). */
export function missingWebhookFields(subscribed: readonly string[] | null | undefined): string[] {
  const have = new Set(subscribed ?? []);
  return WEBHOOK_SUBSCRIBED_FIELDS.filter((field) => !have.has(field));
}
