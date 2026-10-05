"use client";

/* eslint-disable @next/next/no-img-element -- previews of files of our own storage */

/**
 * Etapa 6 (Quiz): "Send file" of the editor. The browser sends the file
 * straight to our storage (pre-signed PUT, lib/funnels/media.ts), with a
 * progress bar and cancel; at the end the public URL goes into the block.
 * Without storage on the server (MEDIA_* env) there is no uploader and
 * nothing here renders: the fields only take a link, as before.
 */

import { createContext, useContext, useRef, useState } from "react";
import { useT } from "@/components/lang-provider";
import type { TFunction } from "@/lib/i18n";
import {
  MEDIA_ACCEPT,
  MediaUploadError,
  type FunnelMediaItem,
  type MediaKind,
  type MediaUploader,
} from "@/lib/funnels/media";
import { FUNNEL_ERROR_TEXT } from "@/components/funnels/funnel-api";

export type MediaEditorState = {
  uploader: MediaUploader | null;
  files: FunnelMediaItem[];
  addFile: (file: FunnelMediaItem) => void;
};

const MediaContext = createContext<MediaEditorState>({ uploader: null, files: [], addFile: () => undefined });

export const MediaUploadProvider = MediaContext.Provider;

export function useMediaUpload(): MediaEditorState {
  return useContext(MediaContext);
}

/** English key (translated by t) of each upload error, per kind of field. */
export function uploadErrorText(t: TFunction, error: unknown, kind: MediaKind): string {
  const code = error instanceof MediaUploadError ? error.code : "network";
  switch (code) {
    case "media_type":
      return kind === "video"
        ? t("This file type is not accepted. Use an MP4 or WebM video.")
        : t("This file type is not accepted. Use JPG, PNG, WebP or GIF.");
    case "media_too_large":
      return kind === "video" ? t("The file is too big. Videos go up to 500 MB.") : t("The file is too big. Images and GIFs go up to 15 MB.");
    case "canceled":
      return t("Upload canceled.");
    case "network":
      return t("The upload failed because of the connection. Check your internet and try again.");
    default: {
      const server = error instanceof MediaUploadError ? error.serverCode : undefined;
      if (server === "rate_limited") return t(FUNNEL_ERROR_TEXT.rate_limited);
      if (server === "not_configured") return t(FUNNEL_ERROR_TEXT.not_configured);
      return t("The upload failed. Try again in a moment.");
    }
  }
}

type Status = { phase: "idle" } | { phase: "sending"; progress: number } | { phase: "done" } | { phase: "error"; text: string };

export function MediaUploadControl({ kind, onUploaded }: { kind: MediaKind; onUploaded: (url: string) => void }) {
  const t = useT();
  const { uploader, files, addFile } = useMediaUpload();
  const input = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const [status, setStatus] = useState<Status>({ phase: "idle" });
  const [picking, setPicking] = useState(false);
  if (!uploader) return null;

  const sending = status.phase === "sending";
  const mine = files.filter((f) => f.kind === kind);

  const send = async (file: File) => {
    const controller = new AbortController();
    abort.current = controller;
    setStatus({ phase: "sending", progress: 0 });
    try {
      const out = await uploader.upload(file, {
        kind,
        signal: controller.signal,
        onProgress: (p) => setStatus({ phase: "sending", progress: p }),
      });
      setStatus({ phase: "done" });
      onUploaded(out.url);
      if (out.id) {
        addFile({ id: out.id, url: out.url, kind: out.kind, contentType: out.contentType, size: out.size, name: file.name || null, createdAt: new Date().toISOString() });
      }
    } catch (error) {
      setStatus({ phase: "error", text: uploadErrorText(t, error, kind) });
    } finally {
      abort.current = null;
    }
  };

  const percent = status.phase === "sending" ? Math.round(status.progress * 100) : 0;

  return (
    <div className="space-y-2">
      <input
        ref={input}
        type="file"
        accept={MEDIA_ACCEPT[kind]}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void send(file);
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={sending}
          onClick={() => input.current?.click()}
          className="min-h-11 rounded-lg border border-border px-3 text-sm font-semibold hover:bg-surface-hover disabled:opacity-50"
        >
          {kind === "video" ? t("Send video file") : t("Send file")}
        </button>
        {mine.length > 0 && !sending && (
          <button
            type="button"
            onClick={() => setPicking((v) => !v)}
            aria-expanded={picking}
            className="min-h-11 rounded-lg px-2 text-sm font-semibold text-accent hover:bg-surface-hover"
          >
            {picking ? t("Close the list") : t("Pick one already sent")}
          </button>
        )}
      </div>
      <p className="text-xs text-muted">
        {kind === "video"
          ? t("MP4 or WebM up to 500 MB. On the phone you can record or pick from the gallery.")
          : t("JPG, PNG, WebP or GIF up to 15 MB. On the phone you can take a photo or pick from the gallery.")}
      </p>

      {sending && (
        <div className="space-y-1" aria-live="polite">
          <div
            role="progressbar"
            aria-label={t("Sending file")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="h-2 w-full overflow-hidden rounded-full bg-surface-hover"
          >
            <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${percent}%` }} />
          </div>
          <div className="flex items-center justify-between text-xs text-muted">
            <span>{t("Sending... {n}%", { n: percent })}</span>
            <button
              type="button"
              onClick={() => abort.current?.abort()}
              className="min-h-11 rounded-lg px-2 font-semibold text-error hover:bg-error/10"
            >
              {t("Cancel")}
            </button>
          </div>
        </div>
      )}
      {status.phase === "done" && (
        <p className="text-xs font-semibold text-success" aria-live="polite">
          {t("File sent. The link is already in the block.")}
        </p>
      )}
      {status.phase === "error" && (
        <p className="text-xs font-semibold text-error" role="alert">
          {status.text}
        </p>
      )}

      {picking && mine.length > 0 && (
        <ul className="grid grid-cols-3 gap-2" aria-label={t("Files already sent")}>
          {mine.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => {
                  onUploaded(f.url);
                  setPicking(false);
                }}
                title={f.name ?? undefined}
                aria-label={f.name ? t("Use {name}", { name: f.name }) : t("Use this file")}
                className="block aspect-square w-full overflow-hidden rounded-lg border border-border bg-surface-hover hover:border-accent"
              >
                {f.kind === "video" ? (
                  <video src={f.url} preload="metadata" muted playsInline className="h-full w-full object-cover" />
                ) : (
                  <img src={f.url} alt="" loading="lazy" className="h-full w-full object-cover" />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
