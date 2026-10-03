/**
 * ig.me referral events out of an Instagram webhook. Three shapes (official
 * docs, Instagram Messaging > ig.me links), all under entry[].messaging[]:
 *   1. new thread + Ice Breaker tap: postback.referral   (messaging_postbacks)
 *   2. new thread + typed message:   message.referral    (messages)
 *   3. existing thread:              referral at the top (messaging_referral)
 * Same precedence as ChatbotX: messaging.referral ?? postback.referral ??
 * message.referral. The docs say source "SHORTLINK" in prose and "SHORTLINKS"
 * in the JSON examples, so both are accepted (any case). Ads (source "ADS")
 * are not conversation links and are ignored here.
 */
export type ReferralKind = "referral" | "postback" | "message";

export interface ReferralEvent {
  /** Our account's instagramId (entry.id). */
  instagramAccountId: string;
  /** The person (IGSID). */
  igUserId: string;
  ref: string;
  kind: ReferralKind;
  source: string;
  /** mid of the message / postback; absent for shape 3. */
  mid?: string;
  /** Milliseconds. */
  timestamp: number;
}

type Referral = { ref?: string; source?: string; type?: string; ad_id?: string };

type Messaging = {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  referral?: Referral;
  postback?: { mid?: string; payload?: string; referral?: Referral };
  message?: { mid?: string; is_echo?: boolean; referral?: Referral };
};

type Payload = { object?: string; entry?: Array<{ id?: string; time?: number; messaging?: Messaging[] }> };

const LINK_SOURCES = new Set(["SHORTLINK", "SHORTLINKS"]);

export function isConversationLinkSource(source: string | undefined): boolean {
  return LINK_SOURCES.has((source ?? "").trim().toUpperCase());
}

export function parseReferralEvents(payload: unknown): ReferralEvent[] {
  const p = payload as Payload;
  if (!p || p.object !== "instagram") return [];
  const out: ReferralEvent[] = [];

  for (const entry of p.entry ?? []) {
    for (const m of entry.messaging ?? []) {
      // An echo of our own message is never a referral.
      if (m.message?.is_echo) continue;

      let referral: Referral | undefined;
      let kind: ReferralKind;
      let mid: string | undefined;
      if (m.referral) {
        referral = m.referral;
        kind = "referral";
      } else if (m.postback?.referral) {
        referral = m.postback.referral;
        kind = "postback";
        mid = m.postback.mid;
      } else if (m.message?.referral) {
        referral = m.message.referral;
        kind = "message";
        mid = m.message.mid;
      } else {
        continue;
      }

      const ref = referral?.ref?.trim();
      if (!ref || !isConversationLinkSource(referral?.source)) continue;

      const igUserId = m.sender?.id;
      const accountId = entry.id ?? m.recipient?.id;
      if (!igUserId || !accountId || igUserId === accountId) continue;

      const ts = m.timestamp ?? (entry.time ? entry.time * (entry.time < 1e12 ? 1000 : 1) : Date.now());
      out.push({
        instagramAccountId: accountId,
        igUserId,
        ref: ref.slice(0, 2083),
        kind,
        source: (referral?.source ?? "").toUpperCase(),
        ...(mid ? { mid } : {}),
        timestamp: ts,
      });
    }
  }
  return out;
}

/** Stable key for one referral (dedupes webhook retries). */
export function referralEventKey(event: Pick<ReferralEvent, "mid" | "timestamp">): string {
  return event.mid ?? `ref:${event.timestamp}`;
}
