/**
 * Etapa 6 (Quiz): labels shared by the screens. English = i18n key; the PT
 * of block names and issue messages lives in lib/i18n/pt-funnels-api.ts
 * (they come from lib/funnels/validate.ts), the rest in lib/i18n/pt-funnels.ts.
 */

import type { TFunction } from "@/lib/i18n";
import { BLOCK_TYPE_NAMES, ISSUE_MESSAGES } from "@/lib/funnels/validate";
import { BLOCK_TYPES, type BlockType, type FunnelIssue, type FunnelStatus } from "@/lib/funnels/types";

export const BLOCK_TYPE_LABEL: Record<BlockType, string> = BLOCK_TYPE_NAMES;

/** Order of the "+ Block" menu, grouped like the Inlead menu. */
export const BLOCK_MENU: { group: string; types: BlockType[] }[] = [
  { group: "Content", types: ["heading", "text", "image", "video", "gallery", "spacer"] },
  { group: "Interaction", types: ["button", "options", "field", "loading"] },
  { group: "Proof and offer", types: ["checklist", "compare", "testimonial", "offer", "faq", "countdown"] },
];

/** Short hint under each block type in the "+ Block" menu. */
export const BLOCK_TYPE_HINT: Record<BlockType, string> = {
  heading: "Big title of the screen",
  text: "Paragraph with bold, italic and lists",
  image: "Photo or GIF by https link",
  video: "YouTube, Vimeo or Panda Video",
  button: "Next screen, another screen or checkout",
  options: "Question with answers (one per screen)",
  field: "Name, email or WhatsApp (asks consent)",
  compare: "Before and after (real result only)",
  testimonial: "Real testimonial, with permission",
  checklist: "List with checks",
  countdown: "Real deadline only",
  loading: "Short wait, then goes on (by points)",
  offer: "Price, bonuses and guarantee",
  gallery: "Several images or prints",
  faq: "Questions and answers",
  spacer: "Empty space",
};

export const STATUS_LABEL: Record<FunnelStatus, string> = {
  DRAFT: "Draft",
  PUBLISHED: "On the air",
  ARCHIVED: "Archived",
};

/** Sentence of a validation issue (same text the MCP gives). */
export function issueText(t: TFunction, issue: Pick<FunnelIssue, "code" | "params">): string {
  const message = ISSUE_MESSAGES[issue.code];
  if (!message) return issue.code;
  return t(message, issue.params ?? {});
}

/** Every English key this file hands to t() (the test checks they all have PT). */
export function funnelLabelKeys(): string[] {
  return [
    ...BLOCK_MENU.map((g) => g.group),
    ...BLOCK_TYPES.map((b) => BLOCK_TYPE_HINT[b]),
    ...Object.values(STATUS_LABEL),
  ];
}
