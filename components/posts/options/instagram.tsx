"use client";

/** Opções do Instagram (Reels): compartilhar também no feed. */

import { useT } from "@/components/lang-provider";
import type { InstagramForm } from "@/lib/social-composer";

export function InstagramFields({ form, onChange }: { form: InstagramForm; onChange: (next: Partial<InstagramForm>) => void }) {
  const t = useT();
  return (
    <>
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" checked={form.shareToFeed} onChange={(e) => onChange({ shareToFeed: e.target.checked })} className="mt-0.5 h-4 w-4 accent-accent" />
        <span>
          <span className="font-semibold">{t("Also show on the profile grid")}</span>
          <span className="block text-xs text-muted">{t("The Reel also appears in the feed of your profile, not only in the Reels tab.")}</span>
        </span>
      </label>
      <p className="text-xs text-muted">{t("The video is published as a Reel. Vertical 9:16 videos look best.")}</p>
    </>
  );
}
