/**
 * Public reply under the comment that started a flow (same behavior as the
 * campaigns: one text drawn at random per comment, posted before the DM).
 *
 * Where the texts come from:
 *  1. the flow trigger's own `publicReplies`;
 *  2. if it has none and the flow was copied from a campaign ("abrir como
 *     fluxo"), that campaign's public replies, when the campaign had them on.
 *     Flows copied before this existed keep answering in public without a
 *     republish.
 * Live comments never get one (campaigns skip them too).
 */
import { renderFlowText } from "@/lib/flows/render";
import type { FlowTriggerType } from "@/lib/flows/schema";

export type PublicReplySource = {
  publicReplyEnabled: boolean;
  publicReplyMessages: string[];
  publicReplyMessage: string | null;
};

function clean(list: (string | null | undefined)[]): string[] {
  return list.map((t) => (t ?? "").trim()).filter(Boolean);
}

export function campaignPublicReplies(source: PublicReplySource | null | undefined): string[] {
  if (!source?.publicReplyEnabled) return [];
  const pool = clean(source.publicReplyMessages ?? []);
  return pool.length > 0 ? pool : clean([source.publicReplyMessage]);
}

export function publicReplyPool(
  trigger: { type: FlowTriggerType | string; publicReplies?: string[] | null },
  source: PublicReplySource | null | undefined
): string[] {
  if (trigger.type !== "COMMENT") return [];
  const own = clean(trigger.publicReplies ?? []);
  return own.length > 0 ? own : campaignPublicReplies(source);
}

/** The text that goes under the comment: {username} / {first_name}; no {link} in public. */
export function renderPublicReply(text: string, vars: { username?: string | null; name?: string | null }): string {
  return renderFlowText(text.replace(/\s*\{link\}\s*/gi, " "), vars);
}

export function drawPublicReply(pool: string[], random: () => number = Math.random): string | null {
  if (pool.length === 0) return null;
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}
