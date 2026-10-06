"use client";

import { useT } from "@/components/lang-provider";

/** O que o agente leu da mídia do cliente (vem de getThread em lib/whatsapp/painel.ts). */
export type MediaRead = { kind: string; status: string; text: string | null };

/** O que o agente leu da mídia (transcrição, descrição da foto, trecho do PDF), em texto pequeno. */
export function MediaReadView({ read }: { read: MediaRead }) {
  const t = useT();
  const label =
    read.kind === "audio" ? t("Transcription") : read.kind === "image" ? t("What the agent saw in the photo") : t("What the agent read in the PDF");
  if (read.status === "ok" && read.text) {
    if (read.kind === "pdf") {
      return (
        <details className="mt-1 max-w-[260px] text-[11px] text-muted">
          <summary className="cursor-pointer">{label}</summary>
          <p className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap">{read.text}</p>
        </details>
      );
    }
    return (
      <p className="mt-1 max-w-[260px] whitespace-pre-wrap text-[11px] text-muted">
        <span className="font-semibold">{label}:</span> {read.text}
      </p>
    );
  }
  const reasons: Record<string, string> = {
    too_large: t("the file is too big"),
    no_key: t("there is no AI key in /admin"),
    cap: t("the daily AI spending cap was reached"),
    failed: t("it could not be downloaded or read"),
    no_text: t("there is no text in it"),
    unsupported: t("this format is not supported"),
  };
  return (
    <p className="mt-1 max-w-[260px] text-[11px] italic text-muted">
      {t("The agent did not read this file: {reason}.", { reason: reasons[read.status] ?? reasons.failed })}
    </p>
  );
}
