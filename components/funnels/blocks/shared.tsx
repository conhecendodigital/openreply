"use client";

/**
 * Etapa 6 (Quiz): pieces every block of the player uses. The player builds a
 * PlayerCtx per screen and hands it to each block; blocks never talk to the
 * API themselves. Funnel text is rendered from parseRichText (no HTML ever).
 */

import { useT } from "@/components/lang-provider";
import { parseRichText } from "@/lib/funnels/text";
import type { FunnelOption, FunnelSettings, LeadField, OptionsBlock, PublicBlock } from "@/lib/funnels/types";

export type PlayerMode = "live" | "preview" | "editor";
export type PublicButtonBlock = Extract<PublicBlock, { type: "button" }>;

export type PlayerCtx = {
  mode: PlayerMode;
  settings: FunnelSettings;
  /** options.name -> chosen labels, for {resposta.<name>}. */
  labels: Record<string, string>;
  /** options.name -> chosen option ids. */
  answers: Record<string, string[]>;
  /** Date.now() of the last tick (countdown). */
  now: number;
  /** Block that gets fetchPriority="high" (first image of the first screen). */
  priorityImageId: string | null;
  /** Option tapped on a single choice question, waiting the short advance. */
  pendingOptionId: string | null;
  optionsError: string | null;
  busy: boolean;
  selectOption: (block: OptionsBlock, option: FunnelOption) => void;
  toggleOption: (block: OptionsBlock, optionId: string) => void;
  continueMultiple: (block: OptionsBlock) => void;
  pressButton: (block: PublicButtonBlock) => void;
  fields: Partial<Record<LeadField, string>>;
  fieldErrors: Partial<Record<LeadField, string>>;
  setField: (field: LeadField, value: string) => void;
  loadingDone: (blockId: string) => void;
  /** Id of the first heading of the screen: it is the h1 and gets the focus. */
  titleBlockId: string | null;
};

export const RADIUS_PX: Record<"sm" | "md" | "lg", number> = { sm: 8, md: 12, lg: 16 };

/** Template media point to https://troque.invalid/...: never load them, show a gray box. */
export function isPlaceholderMedia(url: string | undefined | null): boolean {
  if (!url) return true;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "invalid" || host.endsWith(".invalid");
  } catch {
    return true;
  }
}

/** Template video uses the id XXXXXXXXXXX until the owner pastes the real link. */
export function isPlaceholderVideo(embedUrl: string): boolean {
  return embedUrl.includes("XXXXXXXXXXX");
}

export function MediaPlaceholder({ label, ratio = "16 / 9" }: { label: string; ratio?: string }) {
  return (
    <div
      className="grid w-full place-items-center px-4 text-center text-sm font-semibold"
      style={{
        aspectRatio: ratio,
        borderRadius: "var(--fq-radius)",
        background: "color-mix(in srgb, var(--fq-text) 8%, transparent)",
        color: "color-mix(in srgb, var(--fq-text) 60%, transparent)",
        border: "1px dashed color-mix(in srgb, var(--fq-text) 25%, transparent)",
      }}
    >
      {label}
    </div>
  );
}

/** Funnel text with **bold**, *italic*, line breaks and "- " lists. */
export function RichText({
  text,
  labels,
  className = "",
  style,
}: {
  text: string;
  labels: Record<string, string>;
  className?: string;
  style?: React.CSSProperties;
}) {
  const lines = parseRichText(text, labels);
  const out: React.ReactNode[] = [];
  let list: React.ReactNode[] = [];
  const flush = (key: string) => {
    if (list.length) {
      out.push(
        <ul key={key} className="list-disc space-y-1 pl-5">
          {list}
        </ul>
      );
      list = [];
    }
  };
  lines.forEach((line, i) => {
    const runs = line.runs.map((r, j) => {
      let node: React.ReactNode = r.text;
      if (r.italic) node = <em>{node}</em>;
      if (r.bold) node = <strong>{node}</strong>;
      return <span key={j}>{node}</span>;
    });
    if (line.kind === "li") {
      list.push(<li key={i}>{runs}</li>);
    } else {
      flush(`ul${i}`);
      out.push(
        <p key={i} className="min-h-[1em]">
          {runs}
        </p>
      );
    }
  });
  flush("ul-end");
  return (
    <div className={`space-y-2 ${className}`} style={style}>
      {out}
    </div>
  );
}

/** Check icon used by checklists, chosen options and bonuses. */
export function CheckIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={`shrink-0 ${className}`}>
      <circle cx="12" cy="12" r="10" fill="var(--fq-primary)" />
      <path d="m7.5 12.5 3 3 6-6.5" fill="none" stroke="var(--fq-on-primary)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function useImageLabel() {
  const t = useT();
  return t("Add your image");
}

export const mutedStyle: React.CSSProperties = { color: "color-mix(in srgb, var(--fq-text) 68%, transparent)" };
export const borderColor = "color-mix(in srgb, var(--fq-text) 16%, transparent)";
export const softBg = "color-mix(in srgb, var(--fq-text) 5%, transparent)";
