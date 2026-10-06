/**
 * Etapa 6: funnel definition (Funnel.draft / Funnel.published), validated
 * with zod. Browser-safe: the editor uses it too.
 *
 * This schema checks SHAPE, size, unique ids and safe URLs (https only,
 * video only from allowed hosts), so a half-written draft still saves.
 * What a funnel needs before it can be published (destinations that exist,
 * no [placeholder], real price...) lives in lib/funnels/validate.ts.
 */
import { z } from "zod";
import {
  BLOCK_TYPES,
  FUNNEL_SCHEMA_VERSION,
  LEAD_FIELDS,
  type FunnelDefinition,
  type FunnelTheme,
} from "@/lib/funnels/types";
import { isAllowedImageUrl, isHttpsUrl, isLocalPath, parseVideoUrl } from "@/lib/funnels/media";

export const MAX_STEPS = 40;
export const MAX_BLOCKS_PER_STEP = 30;
export const MAX_OPTIONS = 12;
export const MAX_TEXT = 2000;
export const MAX_LABEL = 120;
export const MAX_DEFINITION_BYTES = 200_000;
export const MAX_FUNNEL_NAME = 80;
const MAX_LIST = 20;
const MAX_URL = 2048;

export const DEFAULT_THEME: FunnelTheme = {
  mode: "light",
  primary: "#0095f6",
  background: "#ffffff",
  text: "#000000",
  radius: "lg",
};
export const DEFAULT_CONSENT_TEXT =
  "Concordo em receber contato sobre este conteúdo e li a Política de Privacidade.";
export const DEFAULT_PRIVACY_URL = "/privacy";

const ID = /^[A-Za-z0-9_-]{1,40}$/;
const id = z.string().regex(ID, "Use letters, numbers, - or _ (up to 40)");
const label = z.string().trim().max(MAX_LABEL);
const longText = z.string().trim().max(MAX_TEXT);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use #RRGGBB");
const align = z.enum(["left", "center"]);
const imageUrl = z.string().trim().max(MAX_URL).refine(isAllowedImageUrl, "Use an https:// image link");
/** Optional URL: "" means "not set". */
const optionalImageUrl = z
  .string()
  .trim()
  .max(MAX_URL)
  .refine((v) => v === "" || isAllowedImageUrl(v), "Use an https:// image link")
  .optional();
const optionalHttpsUrl = z
  .string()
  .trim()
  .max(MAX_URL)
  .refine((v) => v === "" || isHttpsUrl(v), "Use an https:// link")
  .optional();
const privacyUrl = z
  .string()
  .trim()
  .max(MAX_URL)
  .refine((v) => v === "" || isLocalPath(v) || isHttpsUrl(v), "Use /path or an https:// link")
  .optional();
const cents = z.number().int().min(0).max(100_000_000);

const base = {
  id,
  delaySec: z.number().int().min(0).max(600).optional(),
};

const headingBlock = z.object({
  ...base,
  type: z.literal("heading"),
  text: longText,
  level: z.union([z.literal(1), z.literal(2)]).optional(),
  align: align.optional(),
});
const textBlock = z.object({
  ...base,
  type: z.literal("text"),
  text: longText,
  align: align.optional(),
  size: z.enum(["sm", "md", "lg"]).optional(),
});
const imageBlock = z.object({
  ...base,
  type: z.literal("image"),
  url: imageUrl,
  alt: label,
  width: z.number().int().min(1).max(4000).optional(),
  height: z.number().int().min(1).max(4000).optional(),
  rounded: z.boolean().optional(),
});
const videoBlock = z.object({
  ...base,
  type: z.literal("video"),
  url: z
    .string()
    .trim()
    .max(MAX_URL)
    .refine((v) => parseVideoUrl(v) !== null, "Use a YouTube, Vimeo or Panda Video link"),
  title: label,
  vertical: z.boolean().optional(),
  autoplay: z.boolean().optional(),
  posterUrl: optionalImageUrl,
});
const buttonAction = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("next") }),
  z.object({ kind: z.literal("goto"), stepId: id }),
  z.object({ kind: z.literal("checkout"), url: optionalHttpsUrl, newTab: z.boolean().optional() }),
]);
const buttonBlock = z.object({
  ...base,
  type: z.literal("button"),
  label,
  action: buttonAction,
  style: z.enum(["primary", "secondary"]).optional(),
  pulse: z.boolean().optional(),
  sticky: z.boolean().optional(),
});
const option = z.object({
  id,
  label,
  emoji: z.string().trim().max(16).optional(),
  imageUrl: optionalImageUrl,
  tag: z.string().trim().max(60).optional(),
  goto: z.union([id, z.literal("")]).optional(),
  score: z.number().int().min(-100).max(100).optional(),
});
const optionsBlock = z.object({
  ...base,
  type: z.literal("options"),
  name: z.string().regex(/^[a-z0-9_-]{1,40}$/, "Use a-z, 0-9, - or _ (up to 40)"),
  question: label.optional(),
  multiple: z.boolean(),
  required: z.boolean().optional(),
  minChoices: z.number().int().min(0).max(MAX_OPTIONS).optional(),
  maxChoices: z.number().int().min(1).max(MAX_OPTIONS).optional(),
  layout: z.enum(["list", "grid"]).optional(),
  imageSize: z.enum(["photo", "icon"]).optional(),
  continueLabel: label.optional(),
  options: z.array(option).max(MAX_OPTIONS),
});
const fieldBlock = z.object({
  ...base,
  type: z.literal("field"),
  field: z.enum(LEAD_FIELDS),
  label,
  placeholder: label.optional(),
  required: z.boolean().optional(),
});
const compareSide = z.object({
  title: label,
  imageUrl: optionalImageUrl,
  items: z.array(label).max(MAX_LIST),
});
const compareBlock = z.object({
  ...base,
  type: z.literal("compare"),
  before: compareSide,
  after: compareSide,
  authorized: z.boolean().optional(),
});
const testimonialBlock = z.object({
  ...base,
  type: z.literal("testimonial"),
  quote: longText,
  author: label,
  role: label.optional(),
  imageUrl: optionalImageUrl,
  authorized: z.boolean(),
});
const checklistBlock = z.object({
  ...base,
  type: z.literal("checklist"),
  title: label.optional(),
  items: z.array(z.string().trim().max(300)).max(MAX_LIST),
});
const countdownBlock = z.object({
  ...base,
  type: z.literal("countdown"),
  deadline: z.iso.datetime({ offset: true }),
  label,
});
const scoreRoute = z.object({
  min: z.number().int().min(-10_000).max(10_000).optional(),
  max: z.number().int().min(-10_000).max(10_000).optional(),
  stepId: id,
});
const loadingBlock = z.object({
  ...base,
  type: z.literal("loading"),
  text: label,
  durationSec: z.number().int().min(1).max(8).optional(),
  routes: z.array(scoreRoute).max(10).optional(),
});
const offerBlock = z.object({
  ...base,
  type: z.literal("offer"),
  title: label.optional(),
  priceCents: cents.nullable(),
  compareAtCents: cents.nullable().optional(),
  installmentsText: label.optional(),
  bonuses: z.array(z.string().trim().max(300)).max(MAX_LIST).optional(),
  guaranteeDays: z.number().int().min(0).max(365).nullable().optional(),
  guaranteeText: z.string().trim().max(500).optional(),
  deadlineText: label.optional(),
});
const galleryBlock = z.object({
  ...base,
  type: z.literal("gallery"),
  images: z.array(z.object({ url: imageUrl, alt: label })).max(MAX_LIST),
});
const faqBlock = z.object({
  ...base,
  type: z.literal("faq"),
  items: z.array(z.object({ q: label.max(300), a: z.string().trim().max(MAX_TEXT) })).max(MAX_LIST),
});
const spacerBlock = z.object({ ...base, type: z.literal("spacer"), size: z.enum(["sm", "md", "lg"]) });

export const funnelBlockSchema = z.discriminatedUnion("type", [
  headingBlock,
  textBlock,
  imageBlock,
  videoBlock,
  buttonBlock,
  optionsBlock,
  fieldBlock,
  compareBlock,
  testimonialBlock,
  checklistBlock,
  countdownBlock,
  loadingBlock,
  offerBlock,
  galleryBlock,
  faqBlock,
  spacerBlock,
]);

const stepSchema = z.object({
  id,
  title: z.string().trim().max(MAX_LABEL),
  header: z
    .object({
      showBack: z.boolean().optional(),
      showProgress: z.boolean().optional(),
      showLogo: z.boolean().optional(),
    })
    .optional(),
  blocks: z.array(funnelBlockSchema).max(MAX_BLOCKS_PER_STEP),
});

const themeSchema = z.object({
  mode: z.enum(["light", "dark"]),
  primary: color,
  background: color,
  text: color,
  radius: z.enum(["sm", "md", "lg"]).optional(),
});

const settingsSchema = z.object({
  theme: themeSchema,
  logoUrl: optionalImageUrl,
  checkoutUrl: optionalHttpsUrl,
  pixelId: z
    .string()
    .trim()
    .regex(/^(\d{5,20})?$/, "Pixel ID: only digits (5 to 20)")
    .optional(),
  pixelConsent: z.enum(["banner", "notice"]).optional(),
  pixelStepEvents: z.boolean().optional(),
  seo: z
    .object({
      title: label.optional(),
      description: z.string().trim().max(300).optional(),
      imageUrl: optionalImageUrl,
      indexable: z.boolean().optional(),
    })
    .optional(),
  privacyUrl,
  consentText: z.string().trim().max(500).optional(),
  footerText: z.string().trim().max(500).optional(),
});

export const funnelDefinitionSchema = z
  .object({
    schemaVersion: z.literal(FUNNEL_SCHEMA_VERSION),
    settings: settingsSchema,
    steps: z.array(stepSchema).max(MAX_STEPS),
  })
  .superRefine((def, ctx) => {
    const stepIds = new Set<string>();
    const blockIds = new Set<string>();
    const names = new Set<string>();
    def.steps.forEach((step, si) => {
      if (stepIds.has(step.id)) {
        ctx.addIssue({ code: "custom", message: `Duplicate step id ${step.id}`, path: ["steps", si, "id"] });
      }
      stepIds.add(step.id);
      step.blocks.forEach((block, bi) => {
        if (blockIds.has(block.id)) {
          ctx.addIssue({ code: "custom", message: `Duplicate block id ${block.id}`, path: ["steps", si, "blocks", bi, "id"] });
        }
        blockIds.add(block.id);
        if (block.type === "options") {
          if (names.has(block.name)) {
            ctx.addIssue({ code: "custom", message: `Duplicate answer name ${block.name}`, path: ["steps", si, "blocks", bi, "name"] });
          }
          names.add(block.name);
          const optionIds = new Set<string>();
          block.options.forEach((o, oi) => {
            if (optionIds.has(o.id)) {
              ctx.addIssue({
                code: "custom",
                message: `Duplicate option id ${o.id}`,
                path: ["steps", si, "blocks", bi, "options", oi, "id"],
              });
            }
            optionIds.add(o.id);
          });
        }
      });
    });
  });

// tsc breaks here if the zod schema drifts from the shared contract.
// (Both directions assignable + the same keys on every block type: the
// contract's BlockBase & {...} intersections are not "identical" to zod's
// flattened objects for a strict Equals, but they are the same shape.)
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;
type ZBlock = z.infer<typeof funnelBlockSchema>;
type ContractBlock = FunnelDefinition["steps"][number]["blocks"][number];
type BlockType = (typeof BLOCK_TYPES)[number];
type BlockKeysMatch = {
  [T in BlockType]: Equals<keyof Extract<ZBlock, { type: T }>, keyof Extract<ContractBlock, { type: T }>>;
}[BlockType];
export type _FunnelSchemaMatchesContract = Assert<Same<z.infer<typeof funnelDefinitionSchema>, FunnelDefinition>>;
export type _BlockKeysMatchContract = Assert<BlockKeysMatch>;
export type _BlockTypesMatch = Assert<Equals<ZBlock["type"], BlockType>>;
export type _SettingsKeysMatch = Assert<
  Equals<keyof z.infer<typeof settingsSchema>, keyof FunnelDefinition["settings"]>
>;

export type FunnelParseResult =
  | { ok: true; definition: FunnelDefinition }
  | { ok: false; issues: z.core.$ZodIssue[] | { code: string; message: string; path: (string | number)[] }[] };

export function definitionBytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value) ?? "").length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function parseFunnelDefinition(json: unknown): FunnelParseResult {
  if (definitionBytes(json) > MAX_DEFINITION_BYTES) {
    return { ok: false, issues: [{ code: "too_big", message: `Definition over ${MAX_DEFINITION_BYTES} bytes`, path: [] }] };
  }
  const parsed = funnelDefinitionSchema.safeParse(json);
  return parsed.success ? { ok: true, definition: parsed.data } : { ok: false, issues: parsed.error.issues };
}

/** Parsed definition or null (bad JSON in the database never breaks a page). */
export function definitionOrNull(json: unknown): FunnelDefinition | null {
  const parsed = parseFunnelDefinition(json);
  return parsed.ok ? parsed.definition : null;
}

/** A new funnel: one cover screen with a title and a "Começar" button. */
export function emptyFunnelDefinition(): FunnelDefinition {
  return {
    schemaVersion: FUNNEL_SCHEMA_VERSION,
    settings: { theme: { ...DEFAULT_THEME }, pixelConsent: "banner" },
    steps: [
      {
        id: "s_capa",
        title: "Capa",
        blocks: [
          { id: "b_capa_titulo", type: "heading", text: "[Seu título aqui]", level: 1, align: "center" },
          { id: "b_capa_botao", type: "button", label: "Começar", action: { kind: "next" } },
        ],
      },
    ],
  };
}
