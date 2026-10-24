import BrandTile from "@/components/home/brand-tile";
import type { TFunction } from "@/lib/i18n";

const card = "rounded-[18px] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06),0_16px_36px_-20px_rgba(0,0,0,0.28)]";

/** Comentário que vira DM. Ilustração própria, no lugar do vídeo de movimento. */
export function CommentDmVisual({ t }: { t: TFunction }) {
  return (
    <div aria-hidden="true" className="absolute inset-0 grid place-items-center bg-[#f5f5f7] p-6">
      <div className="w-full max-w-[340px]">
        <div className={`${card} p-4`}>
          <div className="flex items-center gap-2.5">
            <BrandTile brand="INSTAGRAM" size={30} />
            <div className="leading-tight">
              <p className="text-[13px] font-semibold">maria.flores</p>
              <p className="text-[11px] text-[#6e6e73]">{t("Comment")}</p>
            </div>
          </div>
          <p className="mt-3 text-[15px] font-medium tracking-tight">QUERO</p>
        </div>
        <svg viewBox="0 0 24 40" className="mx-auto my-1 h-9 w-6 text-accent" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3v30" />
          <path d="m6 27 6 7 6-7" />
        </svg>
        <div className={`${card} p-4`}>
          <p className="text-[11px] text-[#6e6e73]">{t("DM sent")}</p>
          <div className="mt-2 rounded-[16px] bg-accent px-3.5 py-2 text-[13px] leading-snug text-white">
            {t("Hi Maria! Here is the price list you asked for. Want me to set one aside?")}
          </div>
        </div>
      </div>
    </div>
  );
}

const blocks = [
  { x: 24, y: 24, w: 136, label: "Comment", tone: "bg" },
  { x: 24, y: 104, w: 136, label: "Message", tone: "bg" },
  { x: 24, y: 184, w: 136, label: "Wait", tone: "bg" },
  { x: 220, y: 144, w: 136, label: "Condition", tone: "bg" },
] as const;

/** Blocos ligados, como no construtor de fluxos. */
export function FlowVisual({ t }: { t: TFunction }) {
  return (
    <div aria-hidden="true" className="absolute inset-0 grid place-items-center bg-[#f5f5f7] p-4">
      <svg viewBox="0 0 380 260" className="h-full w-full max-w-[420px]" fill="none">
        <g stroke="#0095f6" strokeWidth="2" strokeLinecap="round">
          <path className="home-draw" style={{ ["--len" as string]: 40, ["--d" as string]: "100ms" }} d="M92 58v46" />
          <path className="home-draw" style={{ ["--len" as string]: 40, ["--d" as string]: "300ms" }} d="M92 138v46" />
          <path className="home-draw" style={{ ["--len" as string]: 160, ["--d" as string]: "500ms" }} d="M160 202h30a30 30 0 0 0 30-30v-2" />
          <path className="home-draw" style={{ ["--len" as string]: 80, ["--d" as string]: "800ms" }} d="M294 178v22" />
        </g>
        {blocks.map((b) => (
          <g key={b.label}>
            <rect x={b.x} y={b.y} width={b.w} height="34" rx="11" fill="#fff" stroke="rgba(0,0,0,0.08)" />
            <circle cx={b.x + 18} cy={b.y + 17} r="5" fill="#0095f6" />
            <text x={b.x + 32} y={b.y + 21.5} fontSize="12.5" fontWeight="600" fill="#1d1d1f" fontFamily="system-ui, sans-serif">
              {t(b.label)}
            </text>
          </g>
        ))}
        <rect x="232" y="204" width="124" height="34" rx="11" fill="#fff" stroke="rgba(0,0,0,0.08)" />
        <circle cx="250" cy="221" r="5" fill="#58c322" />
        <text x="264" y="225.5" fontSize="12.5" fontWeight="600" fill="#1d1d1f" fontFamily="system-ui, sans-serif">
          {t("Message")}
        </text>
      </svg>
    </div>
  );
}

/** Tela de publicação: vídeo, privacidade e horário. */
export function PublishVisual({ t }: { t: TFunction }) {
  return (
    <div aria-hidden="true" className="absolute inset-0 grid place-items-center bg-[#2a2a2d] p-5 text-[#1d1d1f]">
      <div className={`${card} flex w-full max-w-[460px] gap-4 p-4`}>
        <div className="grid w-[96px] shrink-0 place-items-center rounded-[14px] bg-[linear-gradient(160deg,#222_0%,#444_100%)] text-white" style={{ aspectRatio: "9 / 16" }}>
          <svg viewBox="0 0 24 24" className="h-7 w-7" fill="currentColor"><path d="M8 5.5v13l10.5-6.5z" /></svg>
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="space-y-1.5">
            <div className="h-2.5 w-11/12 rounded-full bg-[#e6e6eb]" />
            <div className="h-2.5 w-7/12 rounded-full bg-[#e6e6eb]" />
          </div>
          <div className="flex items-center justify-between rounded-[12px] bg-[#f5f5f7] px-3 py-2 text-[12px]">
            <span className="text-[#6e6e73]">{t("Privacy")}</span>
            <span className="font-semibold">{t("Only me")}</span>
          </div>
          <div className="flex items-center justify-between rounded-[12px] bg-[#f5f5f7] px-3 py-2 text-[12px]">
            <span className="text-[#6e6e73]">{t("Schedule")}</span>
            <span className="font-semibold">{t("Today, 6:30 PM")}</span>
          </div>
          <div className="flex items-center gap-2">
            <BrandTile brand="TIKTOK" size={26} />
            <BrandTile brand="YOUTUBE" size={26} />
            <span className="ml-auto rounded-full bg-accent px-3.5 py-1.5 text-[12px] font-semibold text-white">{t("Schedule")}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
