"use client";

/** Último cartão da grade: "Conectar canal" abre a lista de redes e cada uma leva ao seu fluxo. */

import { useState } from "react";
import { CARD_CLASS } from "@/components/channels/channel-card";
import { useT } from "@/components/lang-provider";
import { BrandIcon } from "@/components/social/brand-icon";
import { GRID_NETWORK_ORDER, type GridNetwork } from "@/lib/channels/grid";
import { SOCIAL_BRAND_NAME } from "@/lib/social/brand-icons";

/** Rota que começa a conexão de cada rede. TikTok e YouTube voltam para esta página. */
export const CONNECT_ROUTE: Record<GridNetwork, string> = {
  INSTAGRAM: "/api/instagram/connect",
  FACEBOOK: "/api/facebook/connect",
  TIKTOK: "/api/tiktok/connect?return=channels",
  YOUTUBE: "/api/youtube/connect?return=channels",
};

export function ConnectCard({ hasAny }: { hasAny: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);

  return (
    <div className={`${CARD_CLASS} border border-dashed border-border bg-surface/40`}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="connect-networks"
        onClick={() => setOpen((v) => !v)}
        className="flex flex-1 flex-col items-center justify-center gap-2 rounded-lg text-center text-sm font-semibold text-accent hover:text-accent-hover"
      >
        <span aria-hidden className="grid h-10 w-10 place-items-center rounded-full bg-accent/10 text-xl leading-none">
          {open ? "−" : "+"}
        </span>
        {hasAny ? t("Connect channel") : t("Connect your first channel")}
      </button>
      {open && (
        <ul id="connect-networks" className="mt-3 grid gap-1.5">
          {GRID_NETWORK_ORDER.map((n) => (
            <li key={n}>
              <a
                href={CONNECT_ROUTE[n]}
                className="flex items-center gap-2.5 rounded-lg bg-surface-hover px-3 py-2 text-sm font-semibold hover:bg-border"
              >
                <BrandIcon brand={n} size={22} />
                {SOCIAL_BRAND_NAME[n]}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
