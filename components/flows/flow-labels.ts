/**
 * Texts of the flow screens (English key -> t() -> Portuguese in pt.ts).
 * The validator, the converter and the report send stable codes; this file
 * turns each code into a sentence the owner understands.
 */
import type { TFunction } from "@/lib/i18n";
import type { FlowIssue, FlowIssueCode } from "@/lib/flows/validate";
import {
  TRIGGER_NODE_ID,
  type FlowDefinition,
  type FlowNode,
  type FlowNodeType,
  type FlowTrigger,
  type FlowTriggerType,
} from "@/lib/flows/schema";

export const TRIGGER_TYPE_LABEL: Record<FlowTriggerType, string> = {
  COMMENT: "Comment on a post",
  DM: "Message in the Direct",
  STORY_REPLY: "Reply to a story",
  STORY_MENTION: "Story mention",
  LIVE_COMMENT: "Comment on a live",
  CONVERSATION_LINK: "Conversation link (ig.me)",
};

export const NODE_TYPE_LABEL: Record<FlowNodeType | "trigger", string> = {
  trigger: "Trigger",
  message: "Message",
  condition: "Condition",
  action: "Action",
  wait: "Wait",
  end: "End",
};

export const NODE_TYPE_HINT: Record<FlowNodeType, string> = {
  message: "Text, image and up to 3 buttons",
  condition: "Splits into yes / no",
  action: "Tag, notify, draft or human",
  wait: "Minutes, hours or a reply",
  end: "The flow ends here",
};

export const NODE_TONE: Record<FlowNodeType | "trigger", string> = {
  trigger: "bg-fuchsia-500",
  message: "bg-accent",
  condition: "bg-warning",
  action: "bg-success",
  wait: "bg-zinc-500",
  end: "bg-foreground",
};

export function minutesText(t: TFunction, minutes: number): string {
  if (minutes < 60) return t("{n} min", { n: minutes });
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? t("{h} h {m} min", { h, m }) : t("{h} h", { h });
}

export function triggerSummary(t: TFunction, trigger: Pick<FlowTrigger, "type" | "matchAnyPost" | "postId" | "storyId" | "keywords" | "matchAnyWord" | "conversationLinkId">): string {
  let base: string;
  switch (trigger.type) {
    case "COMMENT":
      base = trigger.matchAnyPost ? t("Comment on any post") : trigger.postId ? t("Comment on a post") : t("Comment on a post (choose it)");
      break;
    case "STORY_REPLY":
      base = trigger.storyId ? t("Reply to one story") : t("Reply to any story");
      break;
    case "LIVE_COMMENT":
      base = t("Comment on any live");
      break;
    default:
      base = t(TRIGGER_TYPE_LABEL[trigger.type]);
  }
  if (trigger.type === "STORY_MENTION" || trigger.type === "CONVERSATION_LINK") return base;
  const words = (trigger.keywords ?? []).filter((k) => k.trim());
  if (trigger.matchAnyWord) return `${base} · ${t("any word")}`;
  return words.length ? `${base} · ${words.join(", ")}` : base;
}

function cut(text: string, max = 48): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** One line that says what the step does (lists, selects, canvas). */
export function nodeSummary(t: TFunction, node: FlowNode): string {
  switch (node.type) {
    case "message":
      return node.text.trim() ? cut(node.text) : t("(no text yet)");
    case "condition":
      if (node.check.kind === "follows") return t("Follows the account?");
      if (node.check.kind === "has_tag") return t("Has the tag {tag}?", { tag: node.check.tag || "…" });
      return t("Clicked the link?");
    case "action":
      switch (node.action.kind) {
        case "add_tag":
          return t("Add tag {tag}", { tag: node.action.tag || "…" });
        case "remove_tag":
          return t("Remove tag {tag}", { tag: node.action.tag || "…" });
        case "notify_owner":
          return t("Notify the owner");
        case "propose_draft":
          return t("Propose a draft for approval");
        case "handoff":
          return t("Hand over to a human");
      }
      return "";
    case "wait":
      return node.mode === "delay" ? t("Wait {time}", { time: minutesText(t, node.minutes) }) : t("Wait for a reply");
    case "end":
      return t("End of the flow");
  }
}

export function nodeTitle(t: TFunction, def: FlowDefinition, id: string): string {
  if (id === TRIGGER_NODE_ID) return t("Trigger");
  const node = def.nodes.find((n) => n.id === id);
  if (!node) return t("Missing step ({id})", { id });
  return `${t(NODE_TYPE_LABEL[node.type])}: ${nodeSummary(t, node)}`;
}

const ISSUE_TEXT: Record<FlowIssueCode, string> = {
  trigger_missing_next: "Connect the trigger to the first step",
  trigger_missing_post: "Choose the post (or any post)",
  trigger_missing_keywords: "Add at least one keyword (or any word)",
  trigger_missing_link: "Choose the conversation link (ig.me)",
  dangling_link: "A link points to a step that no longer exists",
  loose_node: "This step is not connected to the flow",
  empty_text: "The message text is empty",
  text_too_long_for_buttons: "With buttons the text must have at most 640 characters",
  button_no_label: "A button has no text",
  button_no_target: "A button does not lead anywhere",
  button_bad_url: "A link button needs an https:// address",
  bad_image_url: "The image must be an https:// link",
  empty_tag: "Choose the tag",
  empty_draft_text: "The draft text is empty",
  loop_without_person: "A loop must pass through a button tap or a wait for reply",
  waits_too_long: "The waits add up to 23 hours or more: Instagram's 24-hour window would close",
  private_reply_image: "The first message answers the comment (private reply) and cannot carry an image",
  closed_window_message:
    "After the reply to a comment, Instagram only allows another message once the person taps a button or answers. Add a button or a wait for reply before this message",
  no_nodes: "Add at least one step after the trigger",
  follows_before_window: "Before the conversation opens, Instagram may not say whether the person follows: it counts as no",
  draft_before_window: "A draft can only be proposed while the conversation is open (after a tap or a reply)",
  message_text_and_buttons: "This message waits for a button tap, so its plain next step is ignored",
};

export function issueText(t: TFunction, issue: Pick<FlowIssue, "code" | "message">): string {
  const key = ISSUE_TEXT[issue.code];
  return key ? t(key) : issue.message;
}

export const CONVERT_WARNING_LABEL: Record<string, string> = {
  public_reply_not_copied: "The public reply to the comment is not part of flows; the campaign keeps doing it",
  dm_trigger_not_copied: "The campaign also answers the words by DM; a flow has one trigger, so that part was not copied",
  next_reel_not_copied: "\"Next reel\" was not copied: choose the post in the trigger",
  link_history_stays: "Link buttons got new tracked links; the click history stays with the campaign",
  sequence_stop_on_reply: "The campaign's sequence stops when the person replies; in the flow the steps are plain waits",
  followup_needs_open_window:
    "After the reply to a comment, a follow-up only goes out once the person taps or answers: add a button or a wait for reply",
  wait_clamped: "A wait was adjusted to fit between 1 minute and 23 hours",
};

export const OUTCOME_LABEL: Record<string, string> = {
  entered: "Entered",
  sent: "Sent",
  private_reply: "Private reply",
  yes: "Yes",
  no: "No",
  tagged: "Tagged",
  notified: "Notified",
  proposed: "Draft proposed",
  skipped: "Skipped",
  waiting: "Waited",
  timeout: "No reply in time",
  tapped: "Tapped",
  clicked: "Clicked",
  replied: "Replied",
  reply: "Replied",
  done: "Finished",
  handed_off: "Handed to a human",
  stopped: "Stopped",
  error: "Error",
  maybe_sent: "Maybe sent (not resent)",
};

export const RUN_STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Running",
  WAITING_DELAY: "Waiting (time)",
  WAITING_REPLY: "Waiting for a reply",
  WAITING_TAP: "Waiting for a tap",
  DONE: "Finished",
  HANDED_OFF: "With a human",
  STOPPED_WINDOW: "Stopped: 24 h window",
  STOPPED_TAKEOVER: "Stopped: human took over",
  STOPPED_OFF: "Stopped: flow or channel off",
  STOPPED_LIMIT: "Stopped: limit reached",
  FAILED: "Failed",
};

export function labelOr(t: TFunction, map: Record<string, string>, key: string): string {
  return map[key] ? t(map[key]) : key;
}

/** Every English key this file can pass to t() (checked by the i18n test). */
export const FLOW_LABEL_KEYS: string[] = [
  ...Object.values(TRIGGER_TYPE_LABEL),
  ...Object.values(NODE_TYPE_LABEL),
  ...Object.values(NODE_TYPE_HINT),
  ...Object.values(ISSUE_TEXT),
  ...Object.values(CONVERT_WARNING_LABEL),
  ...Object.values(OUTCOME_LABEL),
  ...Object.values(RUN_STATUS_LABEL),
  "{n} min",
  "{h} h {m} min",
  "{h} h",
  "Comment on any post",
  "Comment on a post",
  "Comment on a post (choose it)",
  "Reply to one story",
  "Reply to any story",
  "Comment on any live",
  "any word",
  "(no text yet)",
  "Follows the account?",
  "Has the tag {tag}?",
  "Clicked the link?",
  "Add tag {tag}",
  "Remove tag {tag}",
  "Notify the owner",
  "Propose a draft for approval",
  "Hand over to a human",
  "Wait {time}",
  "Wait for a reply",
  "End of the flow",
  "Trigger",
  "Missing step ({id})",
];
