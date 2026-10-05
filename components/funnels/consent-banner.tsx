"use client";

/**
 * Etapa 6 (Quiz): cookie notice of the public page. Only exists when the
 * funnel has a Pixel id. "banner" (default): the Pixel loads only after
 * Accept. "notice": the Pixel already loaded; this only informs.
 * It sits in the bottom stack of the player, above a sticky button, never over it.
 */

import { useT } from "@/components/lang-provider";
import type { PixelConsent } from "@/lib/funnels/types";

export default function ConsentBanner({
  kind,
  privacyUrl,
  onAccept,
  onDecline,
}: {
  kind: PixelConsent;
  privacyUrl: string;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const t = useT();
  return (
    <section
      role="region"
      aria-label={t("Cookie notice")}
      className="mx-auto w-full max-w-[28rem] p-3 text-[14px] shadow-lg"
      style={{
        background: "var(--fq-bg)",
        color: "var(--fq-text)",
        border: "1px solid color-mix(in srgb, var(--fq-text) 18%, transparent)",
        borderRadius: "var(--fq-radius)",
      }}
    >
      <p>
        {t("We use measurement cookies (Meta) to understand what works.")}{" "}
        <a href={privacyUrl} target="_blank" rel="noopener" className="font-semibold underline underline-offset-2">
          {t("Privacy Policy")}
        </a>
      </p>
      <div className="mt-2 flex justify-end gap-2">
        {kind === "banner" ? (
          <>
            <button type="button" onClick={onDecline} className="min-h-11 rounded-full px-4 font-semibold [touch-action:manipulation]">
              {t("Not now")}
            </button>
            <button
              type="button"
              onClick={onAccept}
              className="min-h-11 rounded-full px-5 font-bold [touch-action:manipulation]"
              style={{ background: "var(--fq-primary)", color: "var(--fq-on-primary)" }}
            >
              {t("Accept")}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={onAccept}
            className="min-h-11 rounded-full px-5 font-bold [touch-action:manipulation]"
            style={{ background: "var(--fq-primary)", color: "var(--fq-on-primary)" }}
          >
            {t("Got it")}
          </button>
        )}
      </div>
    </section>
  );
}
