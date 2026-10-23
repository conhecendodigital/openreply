"use client";

/** Opções do YouTube: título, visibilidade, "feito para crianças" (sem valor padrão) e conteúdo com IA. */

import { useT } from "@/components/lang-provider";
import { fieldClass, labelClass } from "@/components/posts/styles";
import { YOUTUBE_TITLE_MAX } from "@/lib/social/limits";
import { YOUTUBE_PRIVACY_LABELS, type YouTubeForm, type YouTubePrivacy } from "@/lib/social-composer";

export function YouTubeTop({ form, onChange }: { form: YouTubeForm; onChange: (next: Partial<YouTubeForm>) => void }) {
  const t = useT();
  return (
    <label className="flex flex-col gap-2 text-sm">
      <span className={labelClass}>{t("Video title")}</span>
      <input
        type="text"
        value={form.title}
        maxLength={YOUTUBE_TITLE_MAX}
        onChange={(e) => onChange({ title: e.target.value })}
        placeholder={t("Write the title of the video")}
        className={fieldClass}
      />
      <span className="self-end text-xs text-muted">
        {form.title.length}/{YOUTUBE_TITLE_MAX}
      </span>
    </label>
  );
}

export function YouTubeFields({ form, onChange }: { form: YouTubeForm; onChange: (next: Partial<YouTubeForm>) => void }) {
  const t = useT();
  return (
    <>
      <div className="flex flex-col gap-2 text-sm">
        <label htmlFor="yt-privacy" className={labelClass}>
          {t("Who can see this video")}
        </label>
        <select id="yt-privacy" value={form.privacyStatus} onChange={(e) => onChange({ privacyStatus: e.target.value as YouTubePrivacy })} className={fieldClass}>
          {(Object.keys(YOUTUBE_PRIVACY_LABELS) as YouTubePrivacy[]).map((o) => (
            <option key={o} value={o}>
              {t(YOUTUBE_PRIVACY_LABELS[o])}
            </option>
          ))}
        </select>
        <span className="text-xs text-muted">{t("If the Google app is not verified yet, YouTube keeps every upload as Private.")}</span>
      </div>

      <fieldset className="space-y-2">
        <legend className={labelClass}>{t("Is this video made for kids?")}</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" name="yt-kids" checked={form.madeForKids === true} onChange={() => onChange({ madeForKids: true })} className="h-4 w-4 accent-accent" />
            {t("Yes, it is made for kids")}
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="yt-kids" checked={form.madeForKids === false} onChange={() => onChange({ madeForKids: false })} className="h-4 w-4 accent-accent" />
            {t("No, it is not made for kids")}
          </label>
        </div>
        <p className="text-xs text-muted">{t("YouTube requires this answer for every video. It is your decision.")}</p>
      </fieldset>

      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={form.containsSyntheticMedia}
          onChange={(e) => onChange({ containsSyntheticMedia: e.target.checked })}
          className="mt-0.5 h-4 w-4 accent-accent"
        />
        <span>
          <span className="font-semibold">{t("AI-generated content")}</span>
          <span className="block text-xs text-muted">{t("Turn on if the video has realistic scenes made or changed with AI.")}</span>
        </span>
      </label>
    </>
  );
}
