/**
 * Segment filters (zod), browser-safe: the screen builds and validates them
 * with the same schema the API uses. The SQL is in lib/segments/filters.ts.
 */
import { z } from "zod";

const tag = z.string().trim().min(1).max(60);
const id = z.string().trim().min(1).max(64);

export const SEGMENT_SOURCES = ["comment", "dm", "story", "link"] as const;
export type SegmentSource = (typeof SEGMENT_SOURCES)[number];

export const segmentFiltersSchema = z
  .object({
    /** Has ALL of these tags. */
    hasTags: z.array(tag).max(20).default([]),
    /** Has at least one of these tags. */
    anyTags: z.array(tag).max(20).default([]),
    /** Has none of these tags. */
    notTags: z.array(tag).max(20).default([]),
    /** Commented (a real comment, not a DM keyword) on any of these campaigns. */
    commentedCampaignIds: z.array(id).max(20).default([]),
    /** Got the DM of any of these campaigns. */
    receivedCampaignIds: z.array(id).max(20).default([]),
    /** yes = clicked any tracked link; none = never clicked. */
    clicked: z.enum(["any", "yes", "none"]).default("any"),
    /** Clicked the link of any of these campaigns. */
    clickedCampaignIds: z.array(id).max(20).default([]),
    /** From Meta's follow check, when a follow gate asked it (unknown = never asked). */
    follows: z.enum(["any", "yes", "no", "unknown"]).default("any"),
    /** Last interaction (comment, DM, tap, click) within N days. */
    lastInteractionDays: z.number().int().min(1).max(365).nullable().default(null),
    /** Where they came from (any of). */
    sources: z.array(z.enum(SEGMENT_SOURCES)).max(4).default([]),
  })
  .strict();

export type SegmentFilters = z.infer<typeof segmentFiltersSchema>;

export const EMPTY_FILTERS: SegmentFilters = segmentFiltersSchema.parse({});

/** Stored filters (Json) back to a valid object; anything broken = no filter. */
export function parseFilters(value: unknown): SegmentFilters {
  const parsed = segmentFiltersSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : EMPTY_FILTERS;
}

/** Short Portuguese description for lists and the MCP. */
export function describeFilters(f: SegmentFilters): string[] {
  const out: string[] = [];
  if (f.hasTags.length) out.push(`tem todas: ${f.hasTags.join(", ")}`);
  if (f.anyTags.length) out.push(`tem alguma: ${f.anyTags.join(", ")}`);
  if (f.notTags.length) out.push(`não tem: ${f.notTags.join(", ")}`);
  if (f.commentedCampaignIds.length) out.push(`comentou em ${f.commentedCampaignIds.length} campanha(s)`);
  if (f.receivedCampaignIds.length) out.push(`recebeu ${f.receivedCampaignIds.length} campanha(s)`);
  if (f.clicked === "yes") out.push("clicou em link");
  if (f.clicked === "none") out.push("nunca clicou");
  if (f.clickedCampaignIds.length) out.push(`clicou no link de ${f.clickedCampaignIds.length} campanha(s)`);
  if (f.follows === "yes") out.push("segue a conta");
  if (f.follows === "no") out.push("não segue a conta");
  if (f.follows === "unknown") out.push("não sabemos se segue");
  if (f.lastInteractionDays) out.push(`interagiu nos últimos ${f.lastInteractionDays} dias`);
  if (f.sources.length) out.push(`veio de: ${f.sources.join(", ")}`);
  return out.length ? out : ["todos os contatos"];
}
