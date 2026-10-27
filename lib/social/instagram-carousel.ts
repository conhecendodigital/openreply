/**
 * 27/10/2026: regras puras do carrossel do Instagram (tela e provider leem daqui).
 * Fatos da documentação da Meta (instagram-api-with-instagram-login/content-publishing):
 * até 20 itens, só JPEG, imagens cortadas pela proporção da primeira. O resto (1080x1350,
 * mínimo de 2 itens, 8 MB por imagem) é regra do Lead Engine. Mensagens em inglês: a tela usa t().
 */
import { z } from "zod";
import {
  INSTAGRAM_CAROUSEL_MAX,
  INSTAGRAM_CAROUSEL_MIN,
  INSTAGRAM_SLIDE_HEIGHT,
  INSTAGRAM_SLIDE_WIDTH,
  NETWORK_LIMITS,
} from "@/lib/social/limits";

export const instagramSlideSchema = z
  .object({
    url: z.string().trim().url().max(2000),
    bytes: z.number().int().positive(),
    contentType: z.enum(["image/jpeg", "image/png"]),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
  })
  .strict();
export type InstagramSlide = z.infer<typeof instagramSlideSchema>;

export interface SlideWarning {
  /** Modelo em inglês com {n}, {w}, {h}, {rw}, {rh}: a tela passa por t(text, params). */
  text: string;
  params: Record<string, string | number>;
}

/** Avisos (não bloqueiam): tamanho diferente de 1080x1350 e proporção diferente da primeira imagem. */
export function slideWarnings(slides: readonly InstagramSlide[]): SlideWarning[] {
  const out: SlideWarning[] = [];
  const first = slides[0];
  slides.forEach((slide, index) => {
    if (!slide.width || !slide.height) return;
    const n = index + 1;
    if (slide.width !== INSTAGRAM_SLIDE_WIDTH || slide.height !== INSTAGRAM_SLIDE_HEIGHT) {
      out.push({
        text: "Slide {n} is {w}x{h}. The recommended size is {rw}x{rh} (4:5).",
        params: { n, w: slide.width, h: slide.height, rw: INSTAGRAM_SLIDE_WIDTH, rh: INSTAGRAM_SLIDE_HEIGHT },
      });
    }
    if (index > 0 && first?.width && first.height && Math.abs(slide.width / slide.height - first.width / first.height) > 0.01) {
      out.push({ text: "Slide {n} has a different shape from slide 1. Instagram crops every slide to the shape of the first one.", params: { n } });
    }
  });
  return out;
}

/** Problemas que impedem salvar/agendar. Lista vazia = pode seguir. */
export function slideProblems(slides: readonly InstagramSlide[] | undefined): string[] {
  const list = slides ?? [];
  const out: string[] = [];
  if (list.length < INSTAGRAM_CAROUSEL_MIN) out.push(`Add at least ${INSTAGRAM_CAROUSEL_MIN} images to the carousel.`);
  if (list.length > INSTAGRAM_CAROUSEL_MAX) out.push(`A carousel has up to ${INSTAGRAM_CAROUSEL_MAX} images.`);
  const imageMax = NETWORK_LIMITS.INSTAGRAM.imageMaxBytes ?? 0;
  if (list.some((slide) => slide.bytes > imageMax)) out.push("An image is larger than 8 MB.");
  return out;
}
