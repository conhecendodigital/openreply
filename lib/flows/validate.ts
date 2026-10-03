/**
 * What a flow needs before it can be published (browser-safe, the builder
 * shows the same list). Shape is zod's job (lib/flows/schema.ts); this checks
 * that the flow makes sense and can run inside Instagram's rules:
 *
 *  - one trigger with what it needs (post, words, link) and a first step;
 *  - every link points at a node that exists, no loose nodes;
 *  - no empty text, no button without a destination (or a valid https URL);
 *  - a loop only through a tap or a "wait for reply" (otherwise it spins);
 *  - the waits between two moments the person acts stay under 23 h;
 *  - comment / live triggers: the first message is the one private reply (no
 *    image), and nothing else can go out until the person taps a button or
 *    answers, because the 24 h window is not open yet.
 */
import { MAX_SEQUENCE_TOTAL_MIN } from "@/lib/sequences/validate";
import {
  MAX_BUTTON_TEXT,
  TRIGGER_NODE_ID,
  flowEdges,
  triggerIsComment,
  triggerNeedsKeywords,
  type FlowDefinition,
  type FlowNode,
} from "@/lib/flows/schema";

export type FlowIssueCode =
  | "trigger_missing_next"
  | "trigger_missing_post"
  | "trigger_missing_keywords"
  | "trigger_missing_link"
  | "dangling_link"
  | "loose_node"
  | "empty_text"
  | "text_too_long_for_buttons"
  | "button_no_label"
  | "button_no_target"
  | "button_bad_url"
  | "bad_image_url"
  | "empty_tag"
  | "empty_draft_text"
  | "loop_without_person"
  | "waits_too_long"
  | "private_reply_image"
  | "closed_window_message"
  | "no_nodes"
  // warnings
  | "follows_before_window"
  | "draft_before_window"
  | "message_text_and_buttons";

export type FlowIssue = { code: FlowIssueCode; message: string; nodeId?: string; buttonId?: string };

export type FlowValidation = { ok: boolean; errors: FlowIssue[]; warnings: FlowIssue[] };

export function isHttpsUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname);
  } catch {
    return false;
  }
}

export function validateFlow(def: FlowDefinition): FlowValidation {
  const errors: FlowIssue[] = [];
  const warnings: FlowIssue[] = [];
  const byId = new Map<string, FlowNode>(def.nodes.map((n) => [n.id, n]));
  const edges = flowEdges(def);
  const trigger = def.trigger;

  // ── Trigger ────────────────────────────────────────────────────────────────
  if (def.nodes.length === 0) {
    errors.push({ code: "no_nodes", message: "Add at least one step after the trigger" });
  }
  if (!trigger.next) {
    errors.push({ code: "trigger_missing_next", nodeId: TRIGGER_NODE_ID, message: "Connect the trigger to the first step" });
  }
  if (trigger.type === "COMMENT" && !trigger.matchAnyPost && !trigger.postId) {
    errors.push({ code: "trigger_missing_post", nodeId: TRIGGER_NODE_ID, message: "Choose the post (or any post)" });
  }
  if (triggerNeedsKeywords(trigger) && trigger.keywords.filter((k) => k.trim()).length === 0) {
    errors.push({ code: "trigger_missing_keywords", nodeId: TRIGGER_NODE_ID, message: "Add at least one keyword (or any word)" });
  }
  if (trigger.type === "CONVERSATION_LINK" && !trigger.conversationLinkId) {
    errors.push({ code: "trigger_missing_link", nodeId: TRIGGER_NODE_ID, message: "Choose the conversation link (ig.me)" });
  }

  // ── Links point somewhere ──────────────────────────────────────────────────
  for (const e of edges) {
    if (!byId.has(e.target)) {
      errors.push({
        code: "dangling_link",
        nodeId: e.source,
        ...(e.buttonId ? { buttonId: e.buttonId } : {}),
        message: `Step ${e.source} points to a step that does not exist (${e.target})`,
      });
    }
  }

  // ── Loose nodes (BFS from the trigger) ─────────────────────────────────────
  const reachable = new Set<string>();
  const queue = [TRIGGER_NODE_ID];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const e of edges) {
      if (e.source === id && byId.has(e.target) && !reachable.has(e.target)) {
        reachable.add(e.target);
        queue.push(e.target);
      }
    }
  }
  for (const node of def.nodes) {
    if (!reachable.has(node.id)) {
      errors.push({ code: "loose_node", nodeId: node.id, message: `Step ${node.id} is not connected to the flow` });
    }
  }

  // ── Content of each node ───────────────────────────────────────────────────
  for (const node of def.nodes) {
    if (node.type === "message") {
      if (!node.text.trim()) errors.push({ code: "empty_text", nodeId: node.id, message: "Message text is empty" });
      if (node.buttons.length > 0 && node.text.length > MAX_BUTTON_TEXT) {
        errors.push({
          code: "text_too_long_for_buttons",
          nodeId: node.id,
          message: `With buttons the text must have at most ${MAX_BUTTON_TEXT} characters`,
        });
      }
      if (node.imageUrl && !isHttpsUrl(node.imageUrl)) {
        errors.push({ code: "bad_image_url", nodeId: node.id, message: "Image must be an https:// link" });
      }
      for (const b of node.buttons) {
        if (!b.label.trim()) {
          errors.push({ code: "button_no_label", nodeId: node.id, buttonId: b.id, message: "Button without text" });
        }
        if (b.kind === "link" && !isHttpsUrl(b.url)) {
          errors.push({ code: "button_bad_url", nodeId: node.id, buttonId: b.id, message: "Link button needs an https:// URL" });
        }
        if (b.kind === "next" && !b.next) {
          errors.push({ code: "button_no_target", nodeId: node.id, buttonId: b.id, message: "Button does not lead anywhere" });
        }
      }
      if (node.next && node.buttons.some((b) => b.kind === "next")) {
        warnings.push({
          code: "message_text_and_buttons",
          nodeId: node.id,
          message: "This message waits for a button tap; its plain next step is ignored",
        });
      }
    }
    if (node.type === "condition" && node.check.kind === "has_tag" && !node.check.tag.trim()) {
      errors.push({ code: "empty_tag", nodeId: node.id, message: "Choose the tag" });
    }
    if (node.type === "action") {
      if ((node.action.kind === "add_tag" || node.action.kind === "remove_tag") && !node.action.tag.trim()) {
        errors.push({ code: "empty_tag", nodeId: node.id, message: "Choose the tag" });
      }
      if (node.action.kind === "propose_draft" && !node.action.text.trim()) {
        errors.push({ code: "empty_draft_text", nodeId: node.id, message: "Draft text is empty" });
      }
    }
  }

  // Edges that move on by themselves (no tap, no reply).
  const autoEdges = edges.filter((e) => !e.waitsForPerson && byId.has(e.target));
  // A message with a "next" button waits for the tap: its plain next is ignored.
  const waitsForTap = (id: string) => {
    const n = byId.get(id);
    return n?.type === "message" && n.buttons.some((b) => b.kind === "next");
  };
  const autoOut = (id: string) =>
    autoEdges.filter((e) => e.source === id && !(e.kind === "next" && waitsForTap(id)));

  // ── Loops only through a person ────────────────────────────────────────────
  const state = new Map<string, 1 | 2>();
  let loopAt: string | null = null;
  const visit = (id: string): boolean => {
    state.set(id, 1);
    for (const e of autoOut(id)) {
      const s = state.get(e.target);
      if (s === 1) {
        loopAt = e.target;
        return true;
      }
      if (!s && visit(e.target)) return true;
    }
    state.set(id, 2);
    return false;
  };
  for (const id of [TRIGGER_NODE_ID, ...def.nodes.map((n) => n.id)]) {
    if (!state.get(id) && visit(id)) break;
  }
  if (loopAt) {
    errors.push({
      code: "loop_without_person",
      nodeId: loopAt,
      message: "A loop must pass through a button tap or a wait for reply",
    });
  }

  // ── Waits between two moments the person acts < 23 h ───────────────────────
  if (!loopAt) {
    const memo = new Map<string, number>();
    const longest = (id: string): number => {
      if (memo.has(id)) return memo.get(id)!;
      const node = byId.get(id);
      let own = 0;
      if (node?.type === "wait") {
        own = node.mode === "delay" ? node.minutes : 0;
      }
      let best = 0;
      for (const e of autoOut(id)) {
        let add = longest(e.target);
        // Waiting for a reply that never came still eats the window.
        if (node?.type === "wait" && node.mode === "reply" && e.kind === "timeout") {
          add += node.timeoutMinutes ?? 1380;
        }
        best = Math.max(best, add);
      }
      memo.set(id, own + best);
      return own + best;
    };
    // Every point where the window (re)starts: the trigger, each tap target
    // and each reply target.
    const starts = new Set<string>([TRIGGER_NODE_ID]);
    for (const e of edges) if (e.waitsForPerson && byId.has(e.target)) starts.add(e.target);
    for (const s of starts) {
      if (longest(s) >= MAX_SEQUENCE_TOTAL_MIN) {
        errors.push({
          code: "waits_too_long",
          nodeId: s,
          message: "Waits add up to 23 hours or more: Instagram's 24-hour window would close",
        });
        break;
      }
    }
  }

  // ── Comment / live: one private reply, then the window is closed ───────────
  if (triggerIsComment(trigger.type) && !loopAt) {
    const reported = new Set<string>();
    // The automatic edges have no loop (checked above), so a global "seen" per
    // (node, before/after the first message) keeps this linear.
    const seen = new Set<string>();
    const walk = (id: string, messagesSoFar: number) => {
      const key = `${id}:${Math.min(messagesSoFar, 1)}`;
      if (seen.has(key)) return;
      seen.add(key);
      const node = byId.get(id);
      let count = messagesSoFar;
      if (node?.type === "message") {
        if (count === 0 && node.imageUrl) {
          errors.push({
            code: "private_reply_image",
            nodeId: node.id,
            message: "The first message answers the comment (private reply) and cannot carry an image",
          });
        }
        if (count >= 1 && !reported.has(node.id)) {
          reported.add(node.id);
          errors.push({
            code: "closed_window_message",
            nodeId: node.id,
            message:
              "After the reply to a comment, Instagram only allows another message once the person taps a button or answers. Add a button or a wait for reply before this message",
          });
        }
        count += 1;
      }
      if (count === 0 && node?.type === "condition" && node.check.kind === "follows" && !reported.has(`follows:${node.id}`)) {
        reported.add(`follows:${node.id}`);
        warnings.push({
          code: "follows_before_window",
          nodeId: node.id,
          message: "Before the conversation opens Instagram may not tell if the person follows: it counts as no",
        });
      }
      if (node?.type === "action" && node.action.kind === "propose_draft" && !reported.has(`draft:${node.id}`)) {
        reported.add(`draft:${node.id}`);
        warnings.push({
          code: "draft_before_window",
          nodeId: node.id,
          message: "A draft can only be proposed while the conversation is open (after a tap or a reply)",
        });
      }
      for (const e of autoOut(id)) walk(e.target, count);
    };
    walk(TRIGGER_NODE_ID, 0);
  }

  return { ok: errors.length === 0, errors, warnings };
}
