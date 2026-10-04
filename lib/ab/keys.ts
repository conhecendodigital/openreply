/**
 * A/B bits that are safe in the browser (the screens validate with them).
 * The deterministic draw lives in lib/ab/variant.ts (server only).
 */
export const VARIANT_KEYS = ["A", "B", "C"] as const;
export type VariantKey = (typeof VARIANT_KEYS)[number];
export const MAX_VARIANTS = VARIANT_KEYS.length;

export type Weighted = { key: string; weight: number };

export function isVariantKey(value: unknown): value is VariantKey {
  return typeof value === "string" && (VARIANT_KEYS as readonly string[]).includes(value);
}

/** Weights must be whole percents adding up to 100, keys unique. null = ok. */
export function validateWeights(variants: readonly Weighted[]): string | null {
  if (variants.length < 2) return "An A/B test needs at least 2 variants";
  if (variants.length > MAX_VARIANTS) return `At most ${MAX_VARIANTS} variants`;
  const keys = new Set(variants.map((v) => v.key));
  if (keys.size !== variants.length) return "Variant keys must be unique";
  if (variants.some((v) => !isVariantKey(v.key))) return "Variant keys are A, B and C";
  if (variants.some((v) => !Number.isInteger(v.weight) || v.weight < 1 || v.weight > 99)) {
    return "Each weight is a whole percent between 1 and 99";
  }
  const total = variants.reduce((s, v) => s + v.weight, 0);
  if (total !== 100) return "Weights must add up to 100";
  return null;
}

/** Click-through rate in %, one decimal, capped at 100 (repeat clicks). */
export function ctr(clicks: number, sent: number): number {
  if (sent <= 0) return 0;
  return Math.min(100, Number(((clicks / sent) * 100).toFixed(1)));
}
