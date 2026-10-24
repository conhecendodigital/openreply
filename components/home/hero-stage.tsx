import BrandTile from "@/components/home/brand-tile";
import type { TFunction } from "@/lib/i18n";

/**
 * Palco do topo, tudo em CSS: um comentário chega, vira DM no celular e um vídeo
 * fica agendado. Roda uma vez ao carregar. É um exemplo, não uma captura de tela.
 */
export default function HeroStage({ t }: { t: TFunction }) {
  return (
    <div
      role="img"
      aria-label={t("Example of a Direct conversation")}
      className="relative mx-auto h-full w-full min-h-[520px] overflow-hidden rounded-[28px] bg-[#f5f5f7] md:rounded-[36px]"
    >
      <div aria-hidden="true" className="absolute inset-0">
        {/* Comentário que chegou */}
        <div
          className="home-rise absolute left-[6%] top-[26%] hidden w-[250px] rounded-[20px] bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_18px_40px_-20px_rgba(0,0,0,0.25)] md:block"
          style={{ ["--d" as string]: "150ms" }}
        >
          <div className="flex items-center gap-2.5">
            <span className="ig-gradient grid h-8 w-8 place-items-center rounded-full p-[2px]">
              <span className="grid h-full w-full place-items-center rounded-full bg-white text-[11px] font-semibold">M</span>
            </span>
            <div className="leading-tight">
              <p className="text-[13px] font-semibold">maria.flores</p>
              <p className="text-[11px] text-[#6e6e73]">{t("Comment")}</p>
            </div>
          </div>
          <p className="mt-3 text-[15px] font-medium tracking-tight">FLOWERS</p>
        </div>

        {/* Celular */}
        <div className="absolute left-1/2 top-1/2 w-max -translate-x-1/2 -translate-y-1/2">
        <div
          className="home-rise w-[272px] rounded-[42px] bg-[#1d1d1f] p-[7px] shadow-[0_40px_80px_-30px_rgba(0,0,0,0.45)] sm:w-[286px]"
          style={{ ["--d" as string]: "0ms" }}
        >
          <div className="overflow-hidden rounded-[35px] bg-white">
            <div className="flex items-center justify-between px-6 pb-1 pt-3 text-[11px] font-semibold">
              <span>9:41</span>
              <span className="h-[18px] w-[72px] rounded-full bg-[#1d1d1f]" />
              <span className="h-2.5 w-5 rounded-[3px] border border-[#1d1d1f]" />
            </div>
            <div className="flex items-center gap-2.5 border-b border-black/5 px-4 py-2.5">
              <span className="ig-gradient grid h-8 w-8 place-items-center rounded-full p-[2px]">
                <span className="grid h-full w-full place-items-center rounded-full bg-white text-[11px] font-semibold">M</span>
              </span>
              <div className="leading-tight">
                <p className="text-[13px] font-semibold">maria.flores</p>
                <p className="text-[11px] text-[#6e6e73]">{t("Active now")}</p>
              </div>
            </div>
            <div className="space-y-2 px-3 pb-4 pt-3 text-[13px] leading-snug">
              <p className="home-pop text-center text-[11px] text-[#6e6e73]" style={{ ["--d" as string]: "900ms" }}>
                {t("Commented FLOWERS on your reel")}
              </p>
              <div
                className="home-pop ml-auto max-w-[82%] rounded-[18px] bg-accent px-3.5 py-2 text-white"
                style={{ ["--d" as string]: "1400ms", ["--origin" as string]: "100% 100%" }}
              >
                {t("Hi Maria! Here is the price list you asked for. Want me to set one aside?")}
              </div>
              <div
                className="home-pop ml-auto max-w-[82%] rounded-[14px] border border-black/10 px-3.5 py-2 text-center font-semibold text-accent"
                style={{ ["--d" as string]: "1700ms", ["--origin" as string]: "100% 100%" }}
              >
                {t("See price list")}
              </div>
              <div className="home-pop flex items-end gap-2" style={{ ["--d" as string]: "2500ms" }}>
                <span className="h-6 w-6 shrink-0 rounded-full bg-[#e9e9ee]" />
                <div className="rounded-[18px] bg-[#efeff4] px-3.5 py-2">{t("I do! Do you deliver on Saturday?")}</div>
              </div>
              <div className="home-pop flex items-end gap-2" style={{ ["--d" as string]: "3100ms" }}>
                <span className="h-6 w-6 shrink-0" />
                <div className="h-24 w-[60%] rounded-[18px] bg-[linear-gradient(135deg,#ffd1dc_0%,#fbe3c4_45%,#c9e7cf_100%)]" />
              </div>
            </div>
          </div>
        </div>
        </div>

        {/* Vídeo agendado */}
        <div
          className="home-rise absolute right-[6%] top-[52%] hidden w-[250px] rounded-[20px] bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_18px_40px_-20px_rgba(0,0,0,0.25)] md:block"
          style={{ ["--d" as string]: "3500ms" }}
        >
          <div className="flex items-center gap-2">
            <BrandTile brand="TIKTOK" size={28} />
            <BrandTile brand="YOUTUBE" size={28} />
          </div>
          <p className="mt-3 text-[13px] font-semibold">{t("Video scheduled")}</p>
          <p className="mt-0.5 text-[12px] text-[#6e6e73]">{t("Today, 6:30 PM")}</p>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#ececf0]">
            <div className="h-full w-2/5 rounded-full bg-accent" />
          </div>
        </div>
      </div>
    </div>
  );
}
