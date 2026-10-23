"use client";

/** Cartões "Em breve" da página Canais (Telegram, WhatsApp, Messenger, Threads). Sem mudança. */

import { useT } from "@/components/lang-provider";
import type { ComingSoon } from "@/components/channels/types";

export function ComingSoonCard({ channel }: { channel: ComingSoon }) {
  const t = useT();
  return (
    <div className="panel rounded-xl p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 font-semibold">
          <PlatformGlyph platform={channel.platform} />
          {channel.name}
        </p>
        <span className="rounded-full bg-surface-hover px-2.5 py-1 text-xs font-semibold text-muted">{t("Coming soon")}</span>
      </div>
      <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted">{t("What's missing to turn it on")}</p>
      <ul className="mt-1.5 space-y-1 text-sm">
        {channel.requirements.map((req) => (
          <li key={req} className="flex gap-2">
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-muted" />
            <span>{t(req)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const glyphStroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function PlatformGlyph({ platform }: { platform: ComingSoon["platform"] }) {
  const cls = "h-5 w-5 text-muted";
  switch (platform) {
    case "telegram":
      return (
        <svg viewBox="0 0 24 24" className={cls} aria-hidden>
          <path {...glyphStroke} d="M21.5 4.5 2.8 11.7c-.8.3-.8 1.4 0 1.6l4.7 1.5 1.8 5.6c.2.7 1.1.9 1.6.4l2.6-2.5 4.8 3.5c.6.4 1.4.1 1.6-.6l3-15.4c.2-.9-.6-1.6-1.4-1.3zM7.5 14.8 18 7.5l-7.9 8.1" />
        </svg>
      );
    case "whatsapp":
      return (
        <svg viewBox="0 0 24 24" className={cls} aria-hidden>
          <path {...glyphStroke} d="M3.5 20.5 5 16.3A8.5 8.5 0 1 1 8 19.2z" />
          <path {...glyphStroke} d="M9 8.5c0 3.5 3 6.5 6.5 6.5l1-1.5-2-1-1 .8c-1-.4-2-1.4-2.4-2.4l.8-1-1-2z" />
        </svg>
      );
    case "messenger":
      return (
        <svg viewBox="0 0 24 24" className={cls} aria-hidden>
          <path {...glyphStroke} d="M12 3C7 3 3 6.7 3 11.4c0 2.6 1.2 4.9 3.2 6.4V21l3-1.6c.9.2 1.8.4 2.8.4 5 0 9-3.7 9-8.4S17 3 12 3z" />
          <path {...glyphStroke} d="m7.5 13.5 3-3.2 2.2 2.2 3.8-2.5-3 3.2-2.2-2.2z" />
        </svg>
      );
    case "threads":
      return (
        <svg viewBox="0 0 24 24" className={cls} aria-hidden>
          <path {...glyphStroke} d="M17 8.5C16 5.5 14 4 11.8 4 7.7 4 5 7.4 5 12s2.7 8 6.8 8c3.4 0 6-2 6-5 0-2.6-2.2-4.2-5.2-4.2-2.2 0-3.6 1.1-3.6 2.6 0 1.4 1.2 2.4 2.8 2.4 2.6 0 3.7-2.3 3.4-6" />
        </svg>
      );
  }
}
