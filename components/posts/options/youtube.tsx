"use client";

/** Opções do YouTube: título, descrição, tags, visibilidade, "feito para crianças" (sem valor padrão) e conteúdo com IA. */

import { useT } from "@/components/lang-provider";
import { fieldClass, labelClass } from "@/components/posts/styles";
import { ChipsInput } from "@/components/posts/chips-input";
import { NETWORK_LIMITS, YOUTUBE_TITLE_MAX } from "@/lib/social/limits";
import { cleanYouTubeTag, YOUTUBE_TAGS_TOTAL_MAX, youtubeTagsLength } from "@/lib/social/text-fields";
import { YOUTUBE_PRIVACY_LABELS, type YouTubeForm, type YouTubePrivacy } from "@/lib/social-composer";

const YOUTUBE_DESCRIPTION_LIMIT = NETWORK_LIMITS.YOUTUBE.captionMax;

export function YouTubeTop({
  form,
  onChange,
  hasShort,
}: {
  form: YouTubeForm;
  onChange: (next: Partial<YouTubeForm>) => void;
  hasShort: boolean;
}) {
  const t = useT();
  const tagsLength = youtubeTagsLength(form.tags);
  return (
    <>
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

      <label className="flex flex-col gap-2 text-sm">
        <span className={labelClass}>{t("Description")}</span>
        <textarea
          value={form.description}
          maxLength={YOUTUBE_DESCRIPTION_LIMIT}
          rows={4}
          onChange={(e) => onChange({ description: e.target.value })}
          placeholder={t("Write the description of the video")}
          className={fieldClass}
        />
        <span className="flex items-start justify-between gap-3 text-xs text-muted">
          <span>{hasShort ? t("Shorts: vertical video up to 3 minutes. #Shorts in the description is optional.") : ""}</span>
          <span className="shrink-0">
            {form.description.length}/{YOUTUBE_DESCRIPTION_LIMIT}
          </span>
        </span>
      </label>

      <ChipsInput
        label={t("YouTube tags")}
        values={form.tags}
        onChange={(tags) => onChange({ tags })}
        clean={cleanYouTubeTag}
        placeholder={t("Type a tag and press Enter")}
        counter={{ value: tagsLength, max: YOUTUBE_TAGS_TOTAL_MAX }}
        hint={t("Words people search for. No # here: YouTube tags are separate from the description.")}
      />
    </>
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
