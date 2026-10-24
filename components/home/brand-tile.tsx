import { SOCIAL_BRAND_COLOR, SOCIAL_BRAND_NAME, SOCIAL_BRAND_SVG, type SocialBrand } from "@/lib/social/brand-icons";

/**
 * Logo oficial da rede dentro de um quadrado de cantos contínuos (proporção 22,37%),
 * como o ícone de app. O desenho do logo não é alterado: só a cor oficial de fundo e o
 * símbolo em branco. Uso só para dizer qual rede se conecta, sem sugerir parceria.
 */
export default function BrandTile({ brand, size = 56 }: { brand: SocialBrand; size?: number }) {
  const color = SOCIAL_BRAND_COLOR[brand];
  const isInstagram = brand === "INSTAGRAM";
  return (
    <span
      role="img"
      aria-label={SOCIAL_BRAND_NAME[brand]}
      className={`inline-grid shrink-0 place-items-center text-white ${isInstagram ? "ig-gradient" : ""}`}
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.2237,
        backgroundColor: isInstagram ? undefined : color,
        boxShadow: `inset 0 0 0 1px rgba(255,255,255,0.14), 0 1px 2px rgba(0,0,0,0.18), 0 10px 22px -12px ${color}`,
      }}
    >
      <span
        style={{ width: Math.round(size * 0.56), height: Math.round(size * 0.56), display: "block" }}
        dangerouslySetInnerHTML={{ __html: SOCIAL_BRAND_SVG[brand] }}
      />
    </span>
  );
}
