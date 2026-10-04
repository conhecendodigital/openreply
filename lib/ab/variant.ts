/**
 * Etapa 5: teste A/B (campanhas e disparos).
 *
 * - Sorteio determinístico: sha256(<id do teste>:<IGSID>) mod 10000 contra os
 *   pesos acumulados (variantes em ordem de chave). A mesma pessoa cai sempre
 *   na mesma letra, e numa campanha a DM de abertura e a mensagem final caem
 *   na mesma letra (mesma semente).
 * - Sem A/B ligado, nada muda: campaignVariantFor devolve null SEM consultar o
 *   banco, e applyVariant(automation, null) devolve o MESMO objeto. Um campo
 *   ausente (mock antigo, linha de antes da migração) conta como desligado.
 * - Uma falha ao buscar as variantes nunca custa a DM: cai no texto da
 *   campanha.
 */
import { createHash } from "node:crypto";
import { prisma } from "@/lib/db/client";
import type { Weighted } from "@/lib/ab/keys";

export { VARIANT_KEYS, MAX_VARIANTS, isVariantKey, validateWeights, ctr, type VariantKey, type Weighted } from "@/lib/ab/keys";

const BUCKETS = 10_000;

/** 0..9999, stable for the same seed. */
export function variantBucket(seed: string): number {
  const hex = createHash("sha256").update(seed).digest("hex").slice(0, 12);
  return Number.parseInt(hex, 16) % BUCKETS;
}

/**
 * The variant this seed falls in. Weights are scaled to their total (so 50/50
 * and 1/1 split the same way); variants with weight <= 0 never win. null when
 * there is nothing to pick from.
 */
export function pickVariant<T extends Weighted>(seed: string, variants: readonly T[]): T | null {
  const usable = [...variants].filter((v) => Number(v.weight) > 0).sort((a, b) => a.key.localeCompare(b.key));
  if (usable.length === 0) return null;
  if (usable.length === 1) return usable[0];
  const total = usable.reduce((sum, v) => sum + Number(v.weight), 0);
  const bucket = variantBucket(seed);
  let acc = 0;
  for (const v of usable) {
    acc += (Number(v.weight) / total) * BUCKETS;
    if (bucket < acc) return v;
  }
  return usable[usable.length - 1];
}

export function campaignSeed(automationId: string, igUserId: string): string {
  return `${automationId}:${igUserId}`;
}

export function broadcastSeed(broadcastId: string, igUserId: string): string {
  return `${broadcastId}:${igUserId}`;
}

export type CampaignVariantRow = {
  key: string;
  weight: number;
  openingDmMessage: string | null;
  dmMessage: string | null;
};

/**
 * The variant of this person in this campaign, or null when the campaign has
 * no A/B on (then nothing is queried).
 */
export async function campaignVariantFor(
  automation: { id: string; abTestEnabled?: boolean | null },
  igUserId: string
): Promise<CampaignVariantRow | null> {
  if (automation.abTestEnabled !== true) return null;
  try {
    const rows = await prisma.campaignVariant.findMany({
      where: { automationId: automation.id, isActive: true },
      select: { key: true, weight: true, openingDmMessage: true, dmMessage: true },
      orderBy: { key: "asc" },
    });
    return pickVariant(campaignSeed(automation.id, igUserId), Array.isArray(rows) ? rows : []);
  } catch (error) {
    console.warn("[A/B] Variants not loaded, sending the campaign text:", error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * A shallow copy with the variant's texts (a null/empty text keeps the
 * campaign's). Without a variant: the same object, untouched.
 */
export function applyVariant<A extends { dmMessage: string; openingDmMessage: string | null }>(
  automation: A,
  variant: Pick<CampaignVariantRow, "dmMessage" | "openingDmMessage"> | null
): A {
  if (!variant) return automation;
  return {
    ...automation,
    dmMessage: variant.dmMessage?.trim() ? variant.dmMessage : automation.dmMessage,
    openingDmMessage: variant.openingDmMessage?.trim() ? variant.openingDmMessage : automation.openingDmMessage,
  };
}

/** Only on a DmLog write when there IS a variant (no new key otherwise). */
export function variantData(variant: { key: string } | null): { variantKey?: string } {
  return variant ? { variantKey: variant.key } : {};
}
