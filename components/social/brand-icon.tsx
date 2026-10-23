import { SOCIAL_BRAND_COLOR, SOCIAL_BRAND_NAME, SOCIAL_BRAND_SVG, type SocialBrand } from "@/lib/social/brand-icons";

/** Selo redondo com o logo da rede. O SVG é texto fixo do repositório (sem script), por isso o innerHTML é seguro. */
export function BrandIcon({ brand, size = 40, className = "" }: { brand: SocialBrand; size?: number; className?: string }) {
  const inner = Math.round(size * 0.55);
  return (
    <span
      role="img"
      aria-label={SOCIAL_BRAND_NAME[brand]}
      className={`inline-flex shrink-0 items-center justify-center rounded-full text-white ${className}`}
      style={{ width: size, height: size, backgroundColor: SOCIAL_BRAND_COLOR[brand] }}
    >
      <span style={{ width: inner, height: inner, display: "block" }} dangerouslySetInnerHTML={{ __html: SOCIAL_BRAND_SVG[brand] }} />
    </span>
  );
}
