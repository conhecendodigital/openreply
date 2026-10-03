/**
 * Campaign triggers (Automation.trigger), shared by /api/automations and the
 * MCP so both apply the same rules.
 *
 *  COMMENT        comment on a post (specific / any / next reel). The original
 *                 kind; dmTriggerEnabled also answers the same words by DM.
 *  DM             a DM with the words (no post).
 *  STORY_REPLY    a reply to one of our stories with the words; storyId picks
 *                 one story, null = any story.
 *  STORY_MENTION  someone mentions us in their story (no words).
 *  LIVE_COMMENT   a comment with the words during any of our lives: private
 *                 reply only (no public reply), opening DM allowed.
 */
import { z } from "zod";

export const AUTOMATION_TRIGGERS = [
  "COMMENT",
  "DM",
  "STORY_REPLY",
  "STORY_MENTION",
  "LIVE_COMMENT",
] as const;
export type AutomationTriggerValue = (typeof AUTOMATION_TRIGGERS)[number];

export const triggerSchema = z.enum(AUTOMATION_TRIGGERS);

/** Only post comments are bound to a post. */
export function triggerUsesPost(trigger: AutomationTriggerValue): boolean {
  return trigger === "COMMENT";
}

/** A story mention has no text to match. */
export function triggerUsesKeywords(trigger: AutomationTriggerValue): boolean {
  return trigger !== "STORY_MENTION";
}

/** A public reply is a comment reply: only on a post. */
export function triggerAllowsPublicReply(trigger: AutomationTriggerValue): boolean {
  return trigger === "COMMENT";
}

/**
 * The opening DM (button before the link) is a private-reply trick: only
 * where the first message is a private reply to a comment.
 */
export function triggerAllowsOpeningDm(trigger: AutomationTriggerValue): boolean {
  return trigger === "COMMENT" || trigger === "LIVE_COMMENT";
}

type TriggerFields = {
  postId?: string | null;
  postUrl?: string | null;
  matchAnyPost?: boolean;
  pendingNextReel?: boolean;
  dmTriggerEnabled?: boolean;
  keywords?: string[];
  matchAnyWord?: boolean;
  storyId?: string | null;
  storyUrl?: string | null;
  publicReplyEnabled?: boolean;
  publicReplyMessage?: string | null;
  publicReplyMessages?: string[];
  openingDmEnabled?: boolean;
  openingDmMessage?: string | null;
  openingDmButtonLabel?: string | null;
};

/**
 * Force the fields that do not apply to a trigger, so the worker, the
 * reconciler and moderation never see a story/live/DM campaign as a post one.
 * Mutates and returns `data`.
 */
export function applyTriggerRules<T extends TriggerFields>(data: T, trigger: AutomationTriggerValue): T {
  if (!triggerUsesPost(trigger)) {
    data.postId = null;
    data.postUrl = null;
    data.matchAnyPost = false;
    data.pendingNextReel = false;
  }
  if (trigger === "DM") data.dmTriggerEnabled = true;
  if (trigger === "STORY_REPLY" || trigger === "STORY_MENTION" || trigger === "LIVE_COMMENT") {
    data.dmTriggerEnabled = false;
  }
  if (!triggerUsesKeywords(trigger)) {
    data.keywords = [];
    data.matchAnyWord = true;
  }
  if (trigger !== "STORY_REPLY") {
    data.storyId = null;
    data.storyUrl = null;
  }
  if (!triggerAllowsPublicReply(trigger)) {
    data.publicReplyEnabled = false;
    data.publicReplyMessages = [];
    data.publicReplyMessage = null;
  }
  if (!triggerAllowsOpeningDm(trigger)) {
    data.openingDmEnabled = false;
    data.openingDmMessage = null;
    data.openingDmButtonLabel = null;
  }
  return data;
}

/** Portuguese label (MCP, logs). Screens use t() with their own keys. */
export function triggerLabel(a: {
  trigger?: AutomationTriggerValue | null;
  matchAnyPost?: boolean;
  postUrl?: string | null;
  storyId?: string | null;
}): string {
  switch (a.trigger ?? "COMMENT") {
    case "DM":
      return "mensagem no Direct";
    case "STORY_REPLY":
      return a.storyId ? `resposta do story ${a.storyId}` : "resposta de qualquer story";
    case "STORY_MENTION":
      return "menção no story";
    case "LIVE_COMMENT":
      return "comentário em qualquer live";
    default:
      return a.matchAnyPost ? "comentário em qualquer post" : a.postUrl ? `comentário no post ${a.postUrl}` : "comentário no próximo reel";
  }
}
