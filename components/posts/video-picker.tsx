"use client";

/** Prévia, botão de escolher vídeo e barra de envio. A lógica do envio fica no compositor. */

import { useT } from "@/components/lang-provider";
import { btnSecondary } from "@/components/posts/accounts-bar";
import { labelClass } from "@/components/posts/styles";
import { formatBytes } from "@/lib/tiktok-composer";

export interface MediaState {
  url: string;
  bytes: number;
  type: string;
  name: string;
  preview: string;
}

export type UploadState = { pct: number; error: string | null } | null;

export function VideoPicker({
  media,
  upload,
  accept,
  onPick,
  onDuration,
  onDimensions,
  extraSources,
}: {
  media: MediaState;
  upload: UploadState;
  accept: string;
  onPick: (file: File | undefined) => void;
  onDuration: (seconds: number) => void;
  /** Largura e altura do vídeo, para conferir as regras do YouTube Shorts. */
  onDimensions?: (width: number, height: number) => void;
  /** Outras origens do vídeo (ex.: Google Drive, no próximo PR), ao lado de enviar do computador. */
  extraSources?: React.ReactNode;
}) {
  const t = useT();
  const uploading = Boolean(upload && !upload.error);
  return (
    <div className="space-y-3">
      <span className={labelClass}>{t("Video")}</span>
      <div className="mx-auto w-full max-w-[180px] overflow-hidden sm:max-w-[220px] lg:max-w-[260px] rounded-xl border border-border bg-surface-hover">
        {media.preview ? (
          <video
            key={media.preview}
            src={media.preview}
            controls
            playsInline
            preload="metadata"
            onLoadedMetadata={(e) => {
              onDuration(e.currentTarget.duration);
              onDimensions?.(e.currentTarget.videoWidth, e.currentTarget.videoHeight);
            }}
            className="aspect-[9/16] w-full bg-black object-contain"
          />
        ) : (
          <div className="flex aspect-[9/16] w-full items-center justify-center p-4 text-center text-sm text-muted">{t("Your video preview shows here.")}</div>
        )}
      </div>
      <label className={`${btnSecondary} w-full cursor-pointer`}>
        {media.preview ? t("Change video") : t("Choose video")}
        <input
          type="file"
          accept={accept}
          className="sr-only"
          disabled={uploading}
          onChange={(e) => {
            onPick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </label>
      {extraSources}
      {media.name && (
        <p className="break-all text-xs text-muted">
          {media.name} · {formatBytes(media.bytes)}
        </p>
      )}
      {upload && !upload.error && (
        <div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-hover" role="progressbar" aria-valuenow={upload.pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-accent transition-all" style={{ width: `${upload.pct}%` }} />
          </div>
          <p className="mt-1 text-xs text-muted">{t("Uploading {n}%", { n: upload.pct })}</p>
        </div>
      )}
      {upload?.error && <p className="rounded-lg bg-error/10 px-3 py-2 text-xs text-error">{upload.error}</p>}
      {media.url && !upload && <p className="text-xs text-success">{t("Video uploaded")}</p>}
    </div>
  );
}
