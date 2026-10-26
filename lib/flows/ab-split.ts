/**
 * A/B split inside a flow (condition "ab_split"). Same hash as the campaign
 * A/B (lib/ab/variant): the same person always gets the same side of the same
 * flow, so a second comment never flips them from A to B.
 */
import { variantBucket } from "@/lib/ab/variant";

export function abSplitIsA(flowId: string, igUserId: string, percentA: number): boolean {
  const pct = Math.min(99, Math.max(1, Math.round(Number(percentA) || 50)));
  return variantBucket(`flow-ab:${flowId}:${igUserId}`) < pct * 100;
}
