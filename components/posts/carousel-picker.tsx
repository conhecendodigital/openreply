"use client";

/**
 * Slides do carrossel do Instagram: escolher várias imagens, ver a ordem, subir e remover.
 * Cada imagem sobe direto para o nosso armazenamento (mesmo caminho do vídeo). A ordem da lista é a
 * ordem dos slides no Instagram. Avisa (sem bloquear) se o tamanho não é 1080x1350.
 */

import { useState } from "react";
import { useT } from "@/components/lang-provider";
import { callApi, putFile, type UploadTicket } from "@/components/posts/api";
import { btnSecondary } from "@/components/posts/accounts-bar";
import { labelClass } from "@/components/posts/styles";
import { slideWarnings, type InstagramSlide } from "@/lib/social/instagram-carousel";
import { INSTAGRAM_CAROUSEL_MAX, INSTAGRAM_CAROUSEL_MIN, UPLOAD_IMAGE_MAX_BYTES, UPLOAD_IMAGE_TYPES } from "@/lib/social/limits";
import { formatBytes } from "@/lib/tiktok-composer";

/** Largura e altura da imagem escolhida, lidas no navegador. */
function readSize(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve(null);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

export function CarouselPicker({
  slides,
  onChange,
  onBusy,
  disabled,
}: {
  slides: InstagramSlide[];
  onChange: (slides: InstagramSlide[]) => void;
  onBusy: (busy: boolean) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function pick(files: FileList | null) {
    if (!files || files.length === 0) return;
    setProblem(null);
    const chosen = Array.from(files);
    const room = INSTAGRAM_CAROUSEL_MAX - slides.length;
    if (chosen.length > room) {
      setProblem(t("A carousel has up to {max} images.", { max: INSTAGRAM_CAROUSEL_MAX }));
      return;
    }
    for (const file of chosen) {
      if (!(UPLOAD_IMAGE_TYPES as readonly string[]).includes(file.type)) {
        setProblem(t("Use JPEG or PNG images."));
        return;
      }
      if (file.size > UPLOAD_IMAGE_MAX_BYTES) {
        setProblem(t("Each image can have up to {n} MB.", { n: Math.round(UPLOAD_IMAGE_MAX_BYTES / (1024 * 1024)) }));
        return;
      }
    }
    onBusy(true);
    const added: InstagramSlide[] = [];
    setProgress({ done: 0, total: chosen.length });
    // Uma por vez, na ordem em que foram escolhidas: a ordem da lista é a ordem do carrossel.
    for (const [index, file] of chosen.entries()) {
      const size = await readSize(file);
      const ticket = await callApi<UploadTicket>("/api/posts/upload-url", {
        method: "POST",
        body: JSON.stringify({ contentType: file.type, size: file.size, name: file.name }),
      });
      if (!ticket.ok || !ticket.data) {
        setProblem(ticket.code === "not_configured" ? t("Video upload is not set up on the server yet.") : t("Could not start the upload. Try again."));
        break;
      }
      const done = await putFile(ticket.data, file, file.type, () => {});
      if (!done) {
        setProblem(t("The upload failed. Try again."));
        break;
      }
      added.push({ url: ticket.data.publicUrl, bytes: file.size, contentType: file.type as InstagramSlide["contentType"], ...(size ?? {}) });
      setProgress({ done: index + 1, total: chosen.length });
    }
    if (added.length) onChange([...slides, ...added]);
    setProgress(null);
    onBusy(false);
  }

  function move(index: number, by: -1 | 1) {
    const target = index + by;
    if (target < 0 || target >= slides.length) return;
    const next = [...slides];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  const warnings = slideWarnings(slides);
  const busy = progress !== null;
  return (
    <div className="space-y-3" data-testid="carousel-picker">
      <span className={labelClass}>{t("Carousel images")}</span>
      <p className="text-xs text-muted">
        {t("{n} of {max} images. Minimum {min}.", { n: slides.length, max: INSTAGRAM_CAROUSEL_MAX, min: INSTAGRAM_CAROUSEL_MIN })}
      </p>
      {slides.length > 0 && (
        <ol className="space-y-2">
          {slides.map((slide, index) => (
            <li key={`${slide.url}-${index}`} className="flex items-center gap-2 rounded-lg border border-border p-2">
              <span className="w-5 shrink-0 text-center text-xs font-semibold text-muted">{index + 1}</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={slide.url} alt={t("Slide {n}", { n: index + 1 })} className="h-16 w-12 shrink-0 rounded object-cover" />
              <span className="min-w-0 flex-1 text-xs text-muted">
                {slide.width && slide.height ? `${slide.width}x${slide.height} · ` : ""}
                {formatBytes(slide.bytes)}
              </span>
              <span className="flex shrink-0 gap-1">
                <button type="button" aria-label={t("Move up")} disabled={disabled || busy || index === 0} onClick={() => move(index, -1)} className={btnSecondary}>
                  ↑
                </button>
                <button type="button" aria-label={t("Move down")} disabled={disabled || busy || index === slides.length - 1} onClick={() => move(index, 1)} className={btnSecondary}>
                  ↓
                </button>
                <button type="button" aria-label={t("Remove")} disabled={disabled || busy} onClick={() => onChange(slides.filter((_, i) => i !== index))} className={btnSecondary}>
                  ✕
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}
      <label className={`${btnSecondary} w-full cursor-pointer`}>
        {slides.length ? t("Add more images") : t("Choose images")}
        <input
          type="file"
          multiple
          accept={UPLOAD_IMAGE_TYPES.join(",")}
          className="sr-only"
          disabled={disabled || busy || slides.length >= INSTAGRAM_CAROUSEL_MAX}
          onChange={(e) => {
            void pick(e.target.files);
            e.target.value = "";
          }}
        />
      </label>
      {progress && <p className="text-xs text-muted">{t("Uploading image {n} of {total}", { n: Math.min(progress.done + 1, progress.total), total: progress.total })}</p>}
      {problem && <p className="rounded-lg bg-error/10 px-3 py-2 text-xs text-error">{problem}</p>}
      {warnings.length > 0 && (
        <ul className="space-y-1 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
          {warnings.map((w) => (
            <li key={`${w.text}-${w.params.n}`}>{t(w.text, w.params)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
