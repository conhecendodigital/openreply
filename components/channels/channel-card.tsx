"use client";

/** Cartão enxuto da grade de canais: rede, foto, nome, estado e no máximo uma linha extra. */

import Link from "next/link";
import { useState } from "react";
import { useT } from "@/components/lang-provider";
import { BrandIcon } from "@/components/social/brand-icon";
import type { GridChannel, GridState } from "@/lib/channels/grid";
import { SOCIAL_BRAND_NAME } from "@/lib/social/brand-icons";

const STATE: Record<GridState, { label: string; tone: string; dot: string }> = {
  connected: { label: "Connected", tone: "bg-success/10 text-success", dot: "bg-success" },
  expiring: { label: "Expiring soon", tone: "bg-warning/10 text-warning", dot: "bg-warning" },
  attention: { label: "Needs attention", tone: "bg-warning/10 text-warning", dot: "bg-warning" },
  reconnect: { label: "Needs reconnect", tone: "bg-error/10 text-error", dot: "bg-error" },
  off: { label: "Disconnected", tone: "bg-surface-hover text-muted", dot: "bg-muted" },
};

export const CARD_CLASS = "flex h-full min-h-[148px] flex-col rounded-xl p-4";

export function ChannelCard({ channel }: { channel: GridChannel }) {
  const t = useT();
  const [broken, setBroken] = useState(false);
  const st = STATE[channel.state];
  const extra = channel.extra
    ? channel.extra.kind === "scheduled"
      ? channel.extra.count === 1
        ? t("1 scheduled post")
        : t("{n} scheduled posts", { n: channel.extra.count })
      : channel.extra.days === 0
        ? t("Token expires today")
        : t("Token expires in {n} days", { n: channel.extra.days })
    : null;

  return (
    <Link
      href={`/channels/${channel.id}`}
      aria-label={`${SOCIAL_BRAND_NAME[channel.network]}: ${channel.name}`}
      className={`panel ${CARD_CLASS} transition-colors hover:border-accent/50 hover:bg-surface-hover/40`}
    >
      <div className="flex items-start gap-3">
        <span className="relative shrink-0">
          <span className="grid h-12 w-12 place-items-center overflow-hidden rounded-full bg-surface-hover">
            {channel.photoUrl && !broken ? (
              // eslint-disable-next-line @next/next/no-img-element -- foto vinda da própria rede, sem otimização
              <img
                src={channel.photoUrl}
                alt=""
                className={`h-full w-full object-cover ${channel.state === "off" ? "grayscale" : ""}`}
                referrerPolicy="no-referrer"
                onError={() => setBroken(true)}
              />
            ) : (
              <span className="text-lg font-semibold uppercase text-muted">{channel.name.replace(/^@/, "").slice(0, 1)}</span>
            )}
          </span>
          <span className="absolute -bottom-1 -right-1 rounded-full ring-2 ring-background">
            <BrandIcon brand={channel.network} size={22} />
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{channel.name}</p>
          <p className="truncate text-xs text-muted">{channel.subtitle ?? SOCIAL_BRAND_NAME[channel.network]}</p>
        </div>
      </div>

      <div className="mt-auto space-y-1.5 pt-4">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${st.tone}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
          {t(st.label)}
        </span>
        <p className="min-h-[1rem] truncate text-xs text-muted">{extra ?? ""}</p>
      </div>
    </Link>
  );
}
