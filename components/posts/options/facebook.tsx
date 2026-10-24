"use client";

/** Opções do Facebook (Página): título opcional do vídeo. */

import { useT } from "@/components/lang-provider";
import { fieldClass, labelClass } from "@/components/posts/styles";
import { FACEBOOK_TITLE_MAX } from "@/lib/social/limits";
import type { FacebookForm } from "@/lib/social-composer";

export function FacebookTop({ form, onChange }: { form: FacebookForm; onChange: (next: Partial<FacebookForm>) => void }) {
  const t = useT();
  return (
    <label className="flex flex-col gap-2 text-sm">
      <span className={labelClass}>{t("Video title (optional)")}</span>
      <input
        type="text"
        value={form.title}
        maxLength={FACEBOOK_TITLE_MAX}
        onChange={(e) => onChange({ title: e.target.value })}
        placeholder={t("Write a title for the video")}
        className={fieldClass}
      />
    </label>
  );
}
