/**
 * Etapa 6: the funnel the player receives. Pure and browser-safe: the
 * public page (server) and the editor preview (client) use the same thing.
 *
 * - video: provider + embedUrl built by us (a block with a bad URL is dropped);
 * - button: checkoutUrl = action.url || settings.checkoutUrl (no UTM yet:
 *   the player calls buildCheckoutUrl on click, with the visit's params);
 * - testimonial / before-and-after not authorized: dropped;
 * - countdown whose deadline passed: dropped (no fake timers);
 * - privacyUrl and consentText get their defaults.
 */
import type { FunnelDefinition, PublicBlock, PublicFunnel } from "@/lib/funnels/types";
import { parseVideoUrl } from "@/lib/funnels/media";
import { DEFAULT_CONSENT_TEXT, DEFAULT_PRIVACY_URL } from "@/lib/funnels/schema";

export function toPublicFunnel(
  input: { id: string; slug: string; name: string; version: number; definition: FunnelDefinition },
  now: Date = new Date()
): PublicFunnel {
  const settings = input.definition.settings;
  const checkoutDefault = settings.checkoutUrl?.trim() || undefined;
  const steps = input.definition.steps.map((step) => {
    const blocks: PublicBlock[] = [];
    for (const block of step.blocks) {
      switch (block.type) {
        case "video": {
          const parsed = parseVideoUrl(block.url);
          if (parsed) blocks.push({ ...block, provider: parsed.provider, embedUrl: parsed.embedUrl });
          break;
        }
        case "button": {
          if (block.action.kind === "checkout") {
            const url = block.action.url?.trim() || checkoutDefault;
            blocks.push(url ? { ...block, checkoutUrl: url } : { ...block });
          } else {
            blocks.push(block);
          }
          break;
        }
        case "testimonial":
          if (block.authorized === true) blocks.push(block);
          break;
        case "compare":
          if (block.authorized === true || (!block.before.imageUrl && !block.after.imageUrl)) blocks.push(block);
          break;
        case "countdown": {
          const t = Date.parse(block.deadline);
          if (Number.isFinite(t) && t > now.getTime()) blocks.push(block);
          break;
        }
        default:
          blocks.push(block);
      }
    }
    return { ...step, blocks };
  });
  return {
    id: input.id,
    slug: input.slug,
    name: input.name,
    version: input.version,
    settings: {
      ...settings,
      privacyUrl: settings.privacyUrl?.trim() || DEFAULT_PRIVACY_URL,
      consentText: settings.consentText?.trim() || DEFAULT_CONSENT_TEXT,
    },
    steps,
  };
}
