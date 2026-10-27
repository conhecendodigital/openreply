"use client";

/** Opções do Instagram: formato (Reel ou carrossel), feed e reel de teste. */

import { useT } from "@/components/lang-provider";
import type { InstagramForm, InstagramTrial } from "@/lib/social-composer";
import { INSTAGRAM_CAROUSEL_MAX, INSTAGRAM_SLIDE_HEIGHT, INSTAGRAM_SLIDE_WIDTH } from "@/lib/social/limits";

export function InstagramFields({
  form,
  onChange,
  locked,
}: {
  form: InstagramForm;
  onChange: (next: Partial<InstagramForm>) => void;
  /** Post já criado: o formato não troca no meio (a mídia seria outra). */
  locked?: boolean;
}) {
  const t = useT();
  const carousel = form.format === "CAROUSEL";
  return (
    <>
      <fieldset className="space-y-2" disabled={locked}>
        <legend className="text-xs font-semibold uppercase tracking-wide text-muted">{t("Instagram format")}</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" name="ig-format" checked={!carousel} onChange={() => onChange({ format: "REELS" })} className="h-4 w-4 accent-accent" />
            {t("Reel (video)")}
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="ig-format" checked={carousel} onChange={() => onChange({ format: "CAROUSEL" })} className="h-4 w-4 accent-accent" />
            {t("Carousel (images)")}
          </label>
        </div>
      </fieldset>
      {carousel ? (
        <p className="text-xs text-muted">
          {t("The carousel takes 2 to {max} images, in the order you choose. Best size: {w}x{h} (4:5). Instagram only accepts JPEG: PNG files are converted when the post goes out.", {
            max: INSTAGRAM_CAROUSEL_MAX,
            w: INSTAGRAM_SLIDE_WIDTH,
            h: INSTAGRAM_SLIDE_HEIGHT,
          })}
        </p>
      ) : (
        <>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" checked={form.shareToFeed} onChange={(e) => onChange({ shareToFeed: e.target.checked })} className="mt-0.5 h-4 w-4 accent-accent" />
            <span>
              <span className="font-semibold">{t("Also show on the profile grid")}</span>
              <span className="block text-xs text-muted">{t("The Reel also appears in the feed of your profile, not only in the Reels tab.")}</span>
            </span>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold">{t("Trial reel")}</span>
            <select value={form.trial} onChange={(e) => onChange({ trial: e.target.value as InstagramTrial })} className="w-full max-w-xs rounded-lg border border-border bg-surface px-3 py-2 text-sm">
              <option value="">{t("No, post as a normal Reel")}</option>
              <option value="MANUAL">{t("Yes, I move it to followers myself in the Instagram app")}</option>
              <option value="SS_PERFORMANCE">{t("Yes, Instagram moves it to followers if it does well")}</option>
            </select>
            <span className="text-xs text-muted">{t("A trial reel is shown only to people who do not follow you yet.")}</span>
          </label>
          <p className="text-xs text-muted">{t("The video is published as a Reel. Vertical 9:16 videos look best.")}</p>
        </>
      )}
    </>
  );
}
