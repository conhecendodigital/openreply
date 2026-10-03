/**
 * "Abrir como fluxo": a campaign copied into a NEW flow definition (the flow
 * is created off; the campaign is only READ and keeps running untouched).
 *
 *   trigger + words        -> trigger
 *   opening DM             -> message with a "next" button
 *   follow gate            -> condition "follows?": yes -> link message,
 *                             no -> follow prompt whose button checks again
 *   link message + links   -> message with link buttons (new tracked slugs:
 *                             the campaign's click history stays with it)
 *   follow-up              -> wait (delay) + message
 *   sequence steps         -> wait + message, one pair per step
 *   end
 *
 * What a flow cannot copy comes back as warnings for the screen.
 */
import {
  FLOW_SCHEMA_VERSION,
  MAX_BUTTON_LABEL,
  MAX_WAIT_MIN,
  MIN_WAIT_MIN,
  type FlowDefinition,
  type FlowNode,
  type FlowTriggerType,
} from "@/lib/flows/schema";

export type ConvertibleCampaign = {
  id: string;
  name: string;
  trigger: string;
  postId: string | null;
  postUrl: string | null;
  matchAnyPost: boolean;
  pendingNextReel: boolean;
  storyId: string | null;
  keywords: string[];
  matchAnyWord: boolean;
  wholeWordMatch: boolean;
  dmTriggerEnabled: boolean;
  dmMessage: string;
  openingDmEnabled: boolean;
  openingDmMessage: string | null;
  openingDmButtonLabel: string | null;
  linkButtonLabel: string | null;
  requireFollow: boolean;
  followPromptMessage: string | null;
  followPromptButtonLabel: string | null;
  followUpEnabled: boolean;
  followUpMessage: string | null;
  followUpDelayMinutes: number;
  publicReplyEnabled: boolean;
  trackedLinks: { label: string | null; destinationUrl: string }[];
  sequenceSteps?: { order: number; message: string; delayMinutes: number }[];
};

export type ConvertWarning =
  | "public_reply_not_copied"
  | "dm_trigger_not_copied"
  | "next_reel_not_copied"
  | "link_history_stays"
  | "sequence_stop_on_reply"
  | "followup_needs_open_window"
  | "wait_clamped";

export const CONVERT_WARNING_TEXT: Record<ConvertWarning, string> = {
  public_reply_not_copied: "The public reply to the comment is not part of flows; the campaign keeps doing it",
  dm_trigger_not_copied: "The campaign also answers the words by DM; a flow has one trigger, so that part was not copied",
  next_reel_not_copied: "\"Next reel\" was not copied: choose the post in the trigger",
  link_history_stays: "Link buttons got new tracked links; the click history stays with the campaign",
  sequence_stop_on_reply: "The campaign's sequence stops when the person replies; in the flow the steps are plain waits",
  followup_needs_open_window: "After the reply to a comment, a follow-up only goes out once the person taps or answers: add a button or a wait for reply",
  wait_clamped: "A wait was adjusted to fit between 1 minute and 23 hours",
};

const DEFAULT_FOLLOW_PROMPT = "Antes de te mandar o link: me segue e toca no botão aqui embaixo 😉";
const DEFAULT_FOLLOW_BUTTON = "Já sigo";
const DEFAULT_LINK_LABEL = "Abrir link";

function label(value: string | null | undefined, fallback: string) {
  return (value?.trim() || fallback).slice(0, MAX_BUTTON_LABEL);
}

/** Campaign texts use {link} for the inline URL; flow links are buttons. */
function withoutLinkToken(text: string) {
  return text.replace(/\s*\{link\}\s*/gi, " ").replace(/[ \t]{2,}/g, " ").trim();
}

const TRIGGERS: FlowTriggerType[] = ["COMMENT", "DM", "STORY_REPLY", "STORY_MENTION", "LIVE_COMMENT"];

export function campaignToFlowDefinition(campaign: ConvertibleCampaign): {
  definition: FlowDefinition;
  warnings: ConvertWarning[];
} {
  const warnings: ConvertWarning[] = [];
  const type: FlowTriggerType = TRIGGERS.includes(campaign.trigger as FlowTriggerType)
    ? (campaign.trigger as FlowTriggerType)
    : "COMMENT";
  const isComment = type === "COMMENT" || type === "LIVE_COMMENT";

  if (campaign.publicReplyEnabled && type === "COMMENT") warnings.push("public_reply_not_copied");
  if (campaign.dmTriggerEnabled && type === "COMMENT") warnings.push("dm_trigger_not_copied");
  if (campaign.pendingNextReel && type === "COMMENT" && !campaign.postId && !campaign.matchAnyPost) {
    warnings.push("next_reel_not_copied");
  }

  const nodes: FlowNode[] = [];
  let y = 0;
  const pos = (x = 0) => {
    y += 160;
    return { x, y };
  };

  const useOpening =
    isComment &&
    campaign.openingDmEnabled &&
    Boolean(campaign.openingDmMessage?.trim()) &&
    Boolean(campaign.openingDmButtonLabel?.trim());
  const firstId = useOpening ? "abertura" : campaign.requireFollow ? "segue" : "link";

  if (useOpening) {
    nodes.push({
      id: "abertura",
      type: "message",
      position: pos(),
      text: (campaign.openingDmMessage as string).trim(),
      imageUrl: null,
      buttons: [
        { id: "b1", kind: "next", label: label(campaign.openingDmButtonLabel, "Quero"), next: campaign.requireFollow ? "segue" : "link" },
      ],
      next: null,
    });
  }

  if (campaign.requireFollow) {
    nodes.push({ id: "segue", type: "condition", position: pos(), check: { kind: "follows" }, yes: "link", no: "pedir_follow" });
    nodes.push({
      id: "pedir_follow",
      type: "message",
      position: { x: 360, y },
      text: campaign.followPromptMessage?.trim() || DEFAULT_FOLLOW_PROMPT,
      imageUrl: null,
      buttons: [{ id: "b1", kind: "next", label: label(campaign.followPromptButtonLabel, DEFAULT_FOLLOW_BUTTON), next: "segue" }],
      next: null,
    });
  }

  const links = campaign.trackedLinks.slice(0, 3);
  if (links.length > 0) warnings.push("link_history_stays");
  const linkNode: FlowNode = {
    id: "link",
    type: "message",
    position: pos(),
    text: links.length > 0 ? withoutLinkToken(campaign.dmMessage) : campaign.dmMessage.trim(),
    imageUrl: null,
    buttons: links.map((l, i) => ({
      id: `l${i + 1}`,
      kind: "link" as const,
      label: label(i === 0 ? campaign.linkButtonLabel || l.label : l.label, DEFAULT_LINK_LABEL),
      url: l.destinationUrl,
    })),
    next: null,
  };
  nodes.push(linkNode);

  // Chain after the link: follow-up, then the sequence, then the end.
  let tail: { next?: string | null } = linkNode;
  const chain = (node: FlowNode) => {
    tail.next = node.id;
    nodes.push(node);
    tail = node as { next?: string | null };
  };
  const clampWait = (minutes: number) => {
    const m = Math.round(Number(minutes) || 0);
    const clamped = Math.min(MAX_WAIT_MIN, Math.max(MIN_WAIT_MIN, m));
    if (clamped !== m && m !== 0) warnings.push("wait_clamped");
    return clamped;
  };

  // A comment answered straight with the link (no button before it) leaves
  // the window closed: a later message needs a tap or a reply first.
  const linkIsPrivateReply = isComment && !useOpening && !campaign.requireFollow;
  const hasAfterLink = (campaign.followUpEnabled && Boolean(campaign.followUpMessage?.trim())) || (campaign.sequenceSteps?.length ?? 0) > 0;
  if (linkIsPrivateReply && hasAfterLink) warnings.push("followup_needs_open_window");

  if (campaign.followUpEnabled && campaign.followUpMessage?.trim()) {
    if ((campaign.followUpDelayMinutes ?? 0) > 0) {
      chain({ id: "espera_followup", type: "wait", mode: "delay", position: pos(), minutes: clampWait(campaign.followUpDelayMinutes), next: null });
    }
    chain({ id: "followup", type: "message", position: pos(), text: campaign.followUpMessage.trim(), imageUrl: null, buttons: [], next: null });
  }

  const steps = [...(campaign.sequenceSteps ?? [])].sort((a, b) => a.order - b.order);
  if (steps.length > 0) warnings.push("sequence_stop_on_reply");
  steps.forEach((s, i) => {
    chain({ id: `espera_seq_${i + 1}`, type: "wait", mode: "delay", position: pos(), minutes: clampWait(s.delayMinutes), next: null });
    chain({ id: `seq_${i + 1}`, type: "message", position: pos(), text: s.message.trim(), imageUrl: null, buttons: [], next: null });
  });

  chain({ id: "fim", type: "end", position: pos() });

  return {
    definition: {
      schemaVersion: FLOW_SCHEMA_VERSION,
      trigger: {
        type,
        postId: type === "COMMENT" ? campaign.postId : null,
        postUrl: type === "COMMENT" ? campaign.postUrl : null,
        matchAnyPost: type === "COMMENT" ? campaign.matchAnyPost : false,
        storyId: type === "STORY_REPLY" ? campaign.storyId : null,
        conversationLinkId: null,
        keywords: type === "STORY_MENTION" ? [] : campaign.keywords.slice(0, 10),
        matchAnyWord: type === "STORY_MENTION" ? false : campaign.matchAnyWord,
        wholeWordMatch: campaign.wholeWordMatch,
        next: firstId,
        position: { x: 0, y: 0 },
      },
      nodes,
    },
    warnings: [...new Set(warnings)],
  };
}
