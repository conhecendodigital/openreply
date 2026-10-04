/**
 * Broadcast input (zod) shared by the routes and the MCP draft tool.
 * Browser-safe (no server imports): the screen validates with it too.
 */
import { z } from "zod";
import { segmentFiltersSchema } from "@/lib/segments/schema";
import { VARIANT_KEYS } from "@/lib/ab/keys";

export const MAX_BROADCAST_TEXT = 640; // Meta's limit for a button template
export const MAX_BROADCAST_BUTTONS = 3;
export const MAX_BUTTON_LABEL = 20;
export const MAX_BROADCAST_NAME = 80;

export const BATCH_SIZE = { min: 1, max: 50, default: 20 } as const;
export const PAUSE_SECONDS = { min: 10, max: 3_600, default: 60 } as const;

const buttonId = z.string().trim().regex(/^[A-Za-z0-9_-]{1,32}$/);

export const broadcastButtonSchema = z.discriminatedUnion("kind", [
  z.object({
    id: buttonId,
    label: z.string().trim().min(1).max(MAX_BUTTON_LABEL),
    kind: z.literal("link"),
    url: z.string().trim().url().max(2000).refine((u) => /^https?:\/\//i.test(u), "Only http(s) links"),
  }),
  z.object({
    id: buttonId,
    label: z.string().trim().min(1).max(MAX_BUTTON_LABEL),
    kind: z.literal("flow"),
    flowId: z.string().trim().min(1).max(64),
  }),
]);
export type BroadcastButton = z.infer<typeof broadcastButtonSchema>;

export const broadcastVariantSchema = z.object({
  key: z.enum(VARIANT_KEYS),
  weight: z.number().int().min(1).max(99),
  text: z.string().trim().min(1).max(MAX_BROADCAST_TEXT),
});
export type BroadcastVariant = z.infer<typeof broadcastVariantSchema>;

const baseFields = {
  name: z.string().trim().min(1).max(MAX_BROADCAST_NAME),
  instagramAccountId: z.string().min(1).optional().nullable(),
  segmentId: z.string().min(1).optional().nullable(),
  /** Inline filters (used when there is no saved segment). */
  filters: segmentFiltersSchema.optional(),
  text: z.string().trim().min(1).max(MAX_BROADCAST_TEXT),
  buttons: z.array(broadcastButtonSchema).max(MAX_BROADCAST_BUTTONS).default([]),
  /** A/B: 2-3 variants, weights add up to 100. Replaces `text` per person. */
  variants: z.array(broadcastVariantSchema).max(VARIANT_KEYS.length).nullable().optional(),
  skipBusy: z.boolean().default(true),
  batchSize: z.number().int().min(BATCH_SIZE.min).max(BATCH_SIZE.max).default(BATCH_SIZE.default),
  pauseSeconds: z.number().int().min(PAUSE_SECONDS.min).max(PAUSE_SECONDS.max).default(PAUSE_SECONDS.default),
};

function checkButtonsAndVariants(
  value: { buttons?: BroadcastButton[]; variants?: BroadcastVariant[] | null },
  ctx: z.RefinementCtx
) {
  const ids = new Set<string>();
  for (const b of value.buttons ?? []) {
    if (ids.has(b.id)) ctx.addIssue({ code: "custom", message: "Button ids must be unique", path: ["buttons"] });
    ids.add(b.id);
  }
  const v = value.variants;
  if (v && v.length > 0) {
    if (v.length < 2) ctx.addIssue({ code: "custom", message: "An A/B test needs at least 2 variants", path: ["variants"] });
    if (new Set(v.map((x) => x.key)).size !== v.length) {
      ctx.addIssue({ code: "custom", message: "Variant keys must be unique", path: ["variants"] });
    }
    if (v.reduce((s, x) => s + x.weight, 0) !== 100) {
      ctx.addIssue({ code: "custom", message: "Weights must add up to 100", path: ["variants"] });
    }
  }
}

export const createBroadcastSchema = z.object(baseFields).superRefine(checkButtonsAndVariants);
export type CreateBroadcastInput = z.infer<typeof createBroadcastSchema>;

export const updateBroadcastSchema = z
  .object({
    name: baseFields.name.optional(),
    segmentId: baseFields.segmentId,
    filters: baseFields.filters,
    text: baseFields.text.optional(),
    buttons: z.array(broadcastButtonSchema).max(MAX_BROADCAST_BUTTONS).optional(),
    variants: baseFields.variants,
    skipBusy: z.boolean().optional(),
    batchSize: z.number().int().min(BATCH_SIZE.min).max(BATCH_SIZE.max).optional(),
    pauseSeconds: z.number().int().min(PAUSE_SECONDS.min).max(PAUSE_SECONDS.max).optional(),
  })
  .superRefine(checkButtonsAndVariants);
export type UpdateBroadcastInput = z.infer<typeof updateBroadcastSchema>;

export const sendBroadcastSchema = z.object({
  /** ISO date; missing or in the past = now. Up to 30 days ahead. */
  scheduledAt: z.string().datetime({ offset: true }).optional().nullable(),
  /**
   * The draft's updatedAt as the person saw it. If the draft changed since
   * (an API key edited it meanwhile), the send is refused with 409 changed.
   */
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional().nullable(),
});

export function parseButtons(value: unknown): BroadcastButton[] {
  const parsed = z.array(broadcastButtonSchema).max(MAX_BROADCAST_BUTTONS).safeParse(value ?? []);
  return parsed.success ? parsed.data : [];
}

export function parseVariants(value: unknown): BroadcastVariant[] {
  if (!value) return [];
  const parsed = z.array(broadcastVariantSchema).max(VARIANT_KEYS.length).safeParse(value);
  return parsed.success && parsed.data.length >= 2 ? parsed.data : [];
}
