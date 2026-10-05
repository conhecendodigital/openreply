/**
 * Etapa 6: what a funnel needs before it can be published. Pure and
 * browser-safe: the editor shows the same list live, the server refuses to
 * publish with any error, and the MCP reads it as "oQueFaltaPraPublicar".
 *
 * The draft always saves (the zod in schema.ts only checks shape); this is
 * the content check: destinations that exist, no [placeholder] left, a real
 * price, authorized testimonials, https links, readable colors.
 */
import type {
  BlockType,
  FunnelBlock,
  FunnelDefinition,
  FunnelIssue,
  FunnelIssueCode,
  FunnelValidation,
} from "@/lib/funnels/types";
import { isHttpsUrl, isPlaceholderUrl, parseVideoUrl, PLACEHOLDER_VIDEO_ID } from "@/lib/funnels/media";
import { isKnownCheckoutHost } from "@/lib/funnels/checkout";
import { firstPlaceholder } from "@/lib/funnels/text";

/** English = i18n key; PT in lib/i18n/pt-funnels-api.ts. */
export const ISSUE_MESSAGES: Record<FunnelIssueCode, string> = {
  no_steps: "Add at least one screen",
  duplicate_id: "Two items have the same id ({block}) on screen {step}",
  duplicate_name: "Two questions save the answer with the same name ({block})",
  goto_missing: "A button or option on screen {step} goes to a screen that does not exist",
  route_missing: "The loading on screen {step} sends to a screen that does not exist",
  two_options_blocks: "Screen {step} has more than one question; keep one question per screen",
  dead_end: "Screen {step} has no way forward: add a button, a question or a loading",
  checkout_no_url: "The checkout button on screen {step} has no link: fill it in or set the default checkout in Settings",
  url_not_https: "A link on screen {step} does not start with https://",
  video_not_allowed: "The video on screen {step} must be a YouTube, Vimeo or Panda Video link",
  testimonial_not_authorized: "Confirm the testimonial on screen {step} is real and authorized",
  compare_not_authorized: "Confirm the before and after on screen {step} is a real, authorized result",
  offer_no_price: "Fill in the price of the offer on screen {step}",
  offer_compare_not_higher: "The \"from\" price on screen {step} must be higher than the price",
  guarantee_no_days: "Fill in the number of guarantee days on screen {step}",
  countdown_invalid: "The countdown on screen {step} has an invalid date",
  countdown_past: "The countdown deadline on screen {step} has passed; it will not show",
  placeholder_left: "Replace the text in brackets on screen {step}: {text}",
  fields_without_privacy: "There are data fields but no privacy policy link; /privacy will be used",
  last_step_no_checkout: "No screen has a checkout button",
  low_contrast: "The colors are hard to read (contrast {n}); pick stronger colors",
  pixel_invalid: "The Pixel ID must have only digits (5 to 20)",
  options_empty: "The question on screen {step} needs at least 2 options",
  loading_not_last_block: "The loading on screen {step} should be the last block",
  checkout_unknown_host: "The checkout on screen {step} is not Hotmart, Kiwify or Eduzz; check the link",
};

/** Names of the block types (English = i18n key). */
export const BLOCK_TYPE_NAMES: Record<BlockType, string> = {
  heading: "Heading",
  text: "Text",
  image: "Image or GIF",
  video: "Video",
  button: "Button",
  options: "Answer options",
  field: "Data field",
  compare: "Before and after",
  testimonial: "Testimonial",
  checklist: "Checklist",
  countdown: "Countdown",
  loading: "Loading",
  offer: "Offer",
  gallery: "Image gallery",
  faq: "Questions",
  spacer: "Spacer",
};

/** {step} of an issue that is in Settings, not on a screen. */
export const SETTINGS_STEP = "Configurações";

// ─── Contrast (WCAG) ─────────────────────────────────────────────────────────
function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 0;
  const n = Number.parseInt(m[1], 16);
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Every public text of a block (what a visitor reads). */
export function publicTexts(block: FunnelBlock): (string | undefined)[] {
  switch (block.type) {
    case "heading":
    case "text":
      return [block.text];
    case "image":
      return [block.alt];
    case "video":
      return [block.title];
    case "button":
      return [block.label];
    case "options":
      return [block.question, block.continueLabel, ...block.options.map((o) => o.label)];
    case "field":
      return [block.label, block.placeholder];
    case "compare":
      return [block.before.title, ...block.before.items, block.after.title, ...block.after.items];
    case "testimonial":
      return [block.quote, block.author, block.role];
    case "checklist":
      return [block.title, ...block.items];
    case "countdown":
      return [block.label];
    case "loading":
      return [block.text];
    case "offer":
      return [block.title, block.installmentsText, ...(block.bonuses ?? []), block.guaranteeText, block.deadlineText];
    case "gallery":
      return block.images.map((i) => i.alt);
    case "faq":
      return block.items.flatMap((i) => [i.q, i.a]);
    case "spacer":
      return [];
  }
}

/** Every image URL of a block. */
export function imageUrls(block: FunnelBlock): string[] {
  const list: (string | undefined)[] = [];
  if (block.type === "image") list.push(block.url);
  if (block.type === "options") list.push(...block.options.map((o) => o.imageUrl));
  if (block.type === "compare") list.push(block.before.imageUrl, block.after.imageUrl);
  if (block.type === "testimonial") list.push(block.imageUrl);
  if (block.type === "gallery") list.push(...block.images.map((i) => i.url));
  if (block.type === "video") list.push(block.posterUrl);
  return list.filter((u): u is string => typeof u === "string" && u !== "");
}

function hasExit(blocks: FunnelBlock[]): boolean {
  return blocks.some((b) => b.type === "button" || b.type === "loading" || (b.type === "options" && b.options.length > 0));
}

export function validateFunnel(def: FunnelDefinition, now: Date = new Date()): FunnelValidation {
  const issues: FunnelIssue[] = [];
  const add = (
    code: FunnelIssueCode,
    level: "error" | "warning",
    where: { stepId?: string; blockId?: string } = {},
    params?: Record<string, string | number>
  ) => issues.push({ code, level, ...where, ...(params ? { params } : {}) });

  const steps = Array.isArray(def?.steps) ? def.steps : [];
  const settings = def?.settings ?? ({} as FunnelDefinition["settings"]);
  if (steps.length === 0) add("no_steps", "error");

  const stepIds = new Set(steps.map((s) => s.id));
  const seenSteps = new Set<string>();
  const seenBlocks = new Set<string>();
  const seenNames = new Set<string>();
  let anyCheckout = false;
  let anyField = false;

  steps.forEach((step, index) => {
    const label = { step: step.title?.trim() || String(index + 1) };
    const at = (blockId?: string) => ({ stepId: step.id, ...(blockId ? { blockId } : {}) });
    if (seenSteps.has(step.id)) add("duplicate_id", "error", at(), { ...label, block: step.id });
    seenSteps.add(step.id);

    const blocks = step.blocks ?? [];
    const optionBlocks = blocks.filter((b) => b.type === "options");
    if (optionBlocks.length > 1) add("two_options_blocks", "error", at(optionBlocks[1].id), label);
    if (index < steps.length - 1 && !hasExit(blocks)) add("dead_end", "error", at(), label);

    blocks.forEach((block, bi) => {
      const where = at(block.id);
      if (seenBlocks.has(block.id)) add("duplicate_id", "error", where, { ...label, block: block.id });
      seenBlocks.add(block.id);

      // Placeholders: one issue per block (the first one found).
      let placeholder: string | null = null;
      for (const t of publicTexts(block)) {
        placeholder = firstPlaceholder(t);
        if (placeholder) break;
      }
      if (!placeholder) {
        const fake = imageUrls(block).find((u) => isPlaceholderUrl(u));
        if (fake) placeholder = fake;
      }
      if (!placeholder && block.type === "video" && parseVideoUrl(block.url)?.id === PLACEHOLDER_VIDEO_ID) {
        placeholder = block.url;
      }
      if (placeholder) add("placeholder_left", "error", where, { ...label, text: placeholder });

      for (const url of imageUrls(block)) {
        if (!isHttpsUrl(url)) {
          add("url_not_https", "error", where, label);
          break;
        }
      }

      switch (block.type) {
        case "video":
          if (!parseVideoUrl(block.url)) add("video_not_allowed", "error", where, label);
          break;
        case "button": {
          const action = block.action;
          if (action.kind === "goto" && !stepIds.has(action.stepId)) add("goto_missing", "error", where, label);
          if (action.kind === "checkout") {
            anyCheckout = true;
            const url = action.url?.trim() || settings.checkoutUrl?.trim() || "";
            if (!url) add("checkout_no_url", "error", where, label);
            else if (!isHttpsUrl(url)) add("url_not_https", "error", where, label);
            else if (isPlaceholderUrl(url)) add("placeholder_left", "error", where, { ...label, text: url });
            else if (!isKnownCheckoutHost(new URL(url).hostname)) add("checkout_unknown_host", "warning", where, label);
          }
          break;
        }
        case "options": {
          if (seenNames.has(block.name)) add("duplicate_name", "error", where, { ...label, block: block.name });
          seenNames.add(block.name);
          if (block.options.length < 2) add("options_empty", "error", where, label);
          const optionIds = new Set<string>();
          for (const o of block.options) {
            if (optionIds.has(o.id)) add("duplicate_id", "error", where, { ...label, block: o.id });
            optionIds.add(o.id);
            if (o.goto && !stepIds.has(o.goto)) add("goto_missing", "error", where, label);
          }
          break;
        }
        case "loading":
          if (bi !== blocks.length - 1) add("loading_not_last_block", "warning", where, label);
          if ((block.routes ?? []).some((r) => !stepIds.has(r.stepId))) add("route_missing", "error", where, label);
          break;
        case "field":
          anyField = true;
          break;
        case "testimonial":
          if (block.authorized !== true) add("testimonial_not_authorized", "error", where, label);
          break;
        case "compare":
          if ((block.before.imageUrl || block.after.imageUrl) && block.authorized !== true) {
            add("compare_not_authorized", "error", where, label);
          }
          break;
        case "offer":
          if (block.priceCents === null || block.priceCents === undefined) add("offer_no_price", "error", where, label);
          if (
            block.compareAtCents !== null &&
            block.compareAtCents !== undefined &&
            block.priceCents !== null &&
            block.priceCents !== undefined &&
            block.compareAtCents <= block.priceCents
          ) {
            add("offer_compare_not_higher", "error", where, label);
          }
          if (block.guaranteeText?.trim() && (block.guaranteeDays === null || block.guaranteeDays === undefined)) {
            add("guarantee_no_days", "error", where, label);
          }
          break;
        case "countdown": {
          const t = Date.parse(block.deadline);
          if (!Number.isFinite(t)) add("countdown_invalid", "error", where, label);
          else if (t <= now.getTime()) add("countdown_past", "warning", where, label);
          break;
        }
        default:
          break;
      }
    });
  });

  // Settings.
  const settingsUrls = [settings.logoUrl, settings.seo?.imageUrl].filter((u): u is string => Boolean(u));
  for (const url of settingsUrls) {
    if (!isHttpsUrl(url)) add("url_not_https", "error", {}, { step: SETTINGS_STEP });
    else if (isPlaceholderUrl(url)) add("placeholder_left", "error", {}, { step: SETTINGS_STEP, text: url });
  }
  if (settings.checkoutUrl && !isHttpsUrl(settings.checkoutUrl)) add("url_not_https", "error", {}, { step: SETTINGS_STEP });
  for (const t of [settings.seo?.title, settings.seo?.description, settings.consentText, settings.footerText]) {
    const p = firstPlaceholder(t);
    if (p) {
      add("placeholder_left", "error", {}, { step: SETTINGS_STEP, text: p });
      break;
    }
  }
  if (settings.pixelId && !/^\d{5,20}$/.test(settings.pixelId)) add("pixel_invalid", "error");
  if (anyField && !settings.privacyUrl?.trim()) add("fields_without_privacy", "warning");
  if (steps.length > 0 && !anyCheckout) add("last_step_no_checkout", "warning");

  const theme = settings.theme;
  if (theme) {
    const textRatio = contrastRatio(theme.text, theme.background);
    const buttonRatio = contrastRatio("#ffffff", theme.primary);
    if (textRatio < 4.5 || buttonRatio < 3) {
      add("low_contrast", "warning", {}, { n: Number(Math.min(textRatio, buttonRatio).toFixed(1)) });
    }
  }

  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");
  return { ok: errors.length === 0, errors, warnings };
}
