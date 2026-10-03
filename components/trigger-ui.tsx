"use client";

/**
 * Campaign trigger on screen (2026-10-06): the small chip on the campaign
 * list and detail saying what fires it. Same values as Automation.trigger
 * (lib/automations/trigger.ts).
 */

import type { TFunction } from "@/lib/i18n";
import type { PreviewTrigger } from "@/components/campaign-preview";

export interface TriggerFields {
  trigger?: PreviewTrigger | null;
  matchAnyPost?: boolean;
  pendingNextReel?: boolean;
  dmTriggerEnabled?: boolean;
  storyId?: string | null;
}

export function triggerText(t: TFunction, a: TriggerFields): string {
  switch (a.trigger ?? "COMMENT") {
    case "DM":
      return t("Message in the Direct");
    case "STORY_REPLY":
      return a.storyId ? t("Reply to one story") : t("Reply to any story");
    case "STORY_MENTION":
      return t("Story mention");
    case "LIVE_COMMENT":
      return t("Comment on any live");
    default:
      if (a.matchAnyPost) return t("Comment on any post");
      if (a.pendingNextReel) return t("Comment on the next reel");
      return t("Comment on a post");
  }
}

const TONES: Record<PreviewTrigger, string> = {
  COMMENT: "border-border text-muted",
  DM: "border-accent/30 bg-accent/10 text-accent",
  STORY_REPLY: "border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-600",
  STORY_MENTION: "border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-600",
  LIVE_COMMENT: "border-rose-500/30 bg-rose-500/10 text-rose-600",
};

export function TriggerChip({ t, campaign }: { t: TFunction; campaign: TriggerFields }) {
  const trigger = campaign.trigger ?? "COMMENT";
  return (
    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${TONES[trigger]}`}>
      {triggerText(t, campaign)}
      {trigger === "COMMENT" && campaign.dmTriggerEnabled && ` + ${t("DM")}`}
    </span>
  );
}
