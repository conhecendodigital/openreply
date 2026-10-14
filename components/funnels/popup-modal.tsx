"use client";

/**
 * Pop-up of the quiz (pedido do Matheus, 14/10): a modal over the screen.
 * role="dialog" + aria-modal, focus goes to the main button and stays inside
 * (Tab loops), Esc and the dark backdrop close it, focus goes back to where
 * it was. The secondary button ("Quero sair mesmo") can show up after N s,
 * so the visitor reads the story first. Animation off with reduced motion.
 * Text goes through RichText (no HTML, ever).
 */

import { useEffect, useRef, useState } from "react";
import { RichText } from "@/components/funnels/blocks/shared";
import type { FunnelPopup, PopupAction } from "@/lib/funnels/types";

export default function PopupModal({
  popup,
  labels,
  busy,
  onAction,
  onClose,
}: {
  popup: FunnelPopup;
  labels: Record<string, string>;
  busy: boolean;
  onAction: (action: PopupAction) => void;
  onClose: () => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const delayMs = (popup.secondary?.delaySec ?? 0) * 1000;
  const [secondaryReady, setSecondaryReady] = useState(delayMs === 0);

  useEffect(() => {
    if (delayMs === 0) return;
    const timer = window.setTimeout(() => setSecondaryReady(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs]);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    primaryRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !boxRef.current) return;
      const items = [...boxRef.current.querySelectorAll<HTMLElement>("button:not([disabled]),a[href]")];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      before?.focus?.();
    };
  }, [onClose]);

  const titleId = `fq-popup-${popup.id}`;
  return (
    <div
      className="fq-pop-bg fixed inset-0 z-50 flex items-end justify-center p-3 sm:items-center"
      style={{ background: "rgba(0,0,0,.62)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="fq-pop relative max-h-[92dvh] w-full max-w-[26rem] overflow-y-auto px-5 pb-5 pt-6 shadow-2xl"
        style={{ background: "var(--fq-bg)", color: "var(--fq-text)", borderRadius: "calc(var(--fq-radius) + 6px)" }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar"
          className="absolute right-2 top-2 flex h-10 w-10 items-center justify-center rounded-full text-xl leading-none"
          style={{ color: "color-mix(in srgb, var(--fq-text) 60%, transparent)" }}
        >
          ×
        </button>
        {popup.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- same as the image block: any https host
          <img
            src={popup.imageUrl}
            alt=""
            className="mb-4 max-h-56 w-full object-cover"
            style={{ borderRadius: "var(--fq-radius)" }}
            loading="eager"
            decoding="async"
          />
        )}
        <h2 id={titleId} className="pr-8 text-[22px] font-extrabold leading-tight">
          <RichText text={popup.title} labels={labels} />
        </h2>
        {popup.text && <RichText text={popup.text} labels={labels} className="mt-3 block whitespace-pre-line text-[16px] leading-relaxed" />}
        <div className="mt-5 space-y-2">
          <button
            ref={primaryRef}
            type="button"
            disabled={busy}
            onClick={() => onAction(popup.primary.action)}
            className="fq-press fq-pulse min-h-14 w-full px-5 py-3 text-[17px] font-bold leading-snug [touch-action:manipulation] disabled:opacity-60"
            style={{
              borderRadius: "var(--fq-radius)",
              background: "var(--fq-primary)",
              color: "var(--fq-on-primary)",
              border: "2px solid var(--fq-primary)",
            }}
          >
            {popup.primary.label}
          </button>
          {popup.secondary && secondaryReady && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onAction(popup.secondary!.action)}
              className="fq-in min-h-11 w-full px-4 py-2 text-[14px] font-semibold underline underline-offset-2 [touch-action:manipulation] disabled:opacity-60"
              style={{ color: "color-mix(in srgb, var(--fq-text) 70%, transparent)" }}
            >
              {popup.secondary.label}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
