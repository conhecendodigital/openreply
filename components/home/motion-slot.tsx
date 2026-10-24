import { existsSync } from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import MotionVideo from "@/components/home/motion-video";
import { MOTION_SLOTS, type MotionSlotName } from "@/lib/home/motion-slots";

/**
 * Mostra public/motions/<name>.mp4 quando o arquivo existe; senão, a ilustração
 * em CSS/SVG que vem como filho. Assim a página nunca fica com buraco.
 */
// No celular a largura é pequena e o aspecto cortaria a ilustração: piso de altura só até md.
const MOBILE_MIN: Record<MotionSlotName, string> = {
  hero: "min-h-[470px] md:min-h-0",
  "comentario-dm": "min-h-[400px] md:min-h-0",
  fluxo: "min-h-[300px] md:min-h-0",
  publicar: "min-h-[330px] md:min-h-0",
};

export default function MotionSlot({
  name,
  className = "",
  children,
}: {
  name: MotionSlotName;
  className?: string;
  children: ReactNode;
}) {
  const file = path.join(process.cwd(), "public", "motions", `${name}.mp4`);
  const hasVideo = existsSync(file);
  return (
    <div
      className={`relative w-full min-w-0 overflow-hidden ${MOBILE_MIN[name]} ${className}`}
      style={{ aspectRatio: MOTION_SLOTS[name].aspect }}
      data-motion-slot={name}
      data-motion-video={hasVideo ? "yes" : "no"}
    >
      {hasVideo ? <MotionVideo src={`/motions/${name}.mp4`} /> : children}
    </div>
  );
}
