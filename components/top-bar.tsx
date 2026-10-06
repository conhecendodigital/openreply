"use client";

/**
 * Top Bar
 *
 * Page title, mobile hamburger, and connection status.
 */

import { usePathname } from "next/navigation";
import { useT } from "@/components/lang-provider";

const pageTitles: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/campaigns": "Campaigns",
  "/campaigns/new": "New Campaign",
  "/automations": "Campaigns",
  "/automations/new": "New Campaign",
  "/logs": "DM Logs",
  "/inbox": "Inbox",
  "/overview": "Overview",
  "/settings": "Settings",
  "/diagnostics": "Diagnostics",
  "/contacts": "Contacts",
  "/moderation": "Moderation",
  "/approvals": "Approvals",
  "/sequences": "Sequences",
  "/conversation-links": "Conversation links",
  "/channels": "Channels",
  "/whatsapp/inbox": "WhatsApp",
  "/whatsapp/connections": "WhatsApp",
  "/whatsapp/agents": "WhatsApp",
  "/flows": "Flows",
  "/flows/new": "New flow",
  // Etapa 5
  "/reports": "Reports",
  "/broadcasts": "Broadcasts",
  "/broadcasts/new": "New broadcast",
  "/segments": "Segments",
  // Etapa 6
  "/quizzes": "Quizzes",
  "/quizzes/new": "New quiz",
};

interface TopBarProps {
  onMenuClick: () => void;
  instagramUsername: string | null;
  instagramAccountCount: number;
}

export default function TopBar({
  onMenuClick,
  instagramUsername,
  instagramAccountCount,
}: TopBarProps) {
  const pathname = usePathname();
  const t = useT();
  const title = t(pageTitles[pathname] ?? (pathname.startsWith("/campaigns/") ? "Campaign" : pathname.startsWith("/contacts/") ? "Contact" : pathname.startsWith("/flows/") ? "Flow" : pathname.startsWith("/broadcasts/") ? "Broadcast" : pathname.startsWith("/quizzes/") ? "Quiz" : "Dashboard"));

  return (
    <header
      className="sticky top-0 z-30 flex items-center justify-between gap-3 px-4 lg:px-8 border-b border-border bg-background/95 backdrop-blur"
      // Installed to the home screen the app starts at the very top of the
      // display, so without this the title sits under the clock and battery.
      // The inset is 0 in a browser tab and on desktop.
      style={{
        height: "calc(4rem + env(safe-area-inset-top))",
        paddingTop: "env(safe-area-inset-top)",
      }}
    >
      <div className="flex min-w-0 items-center gap-3 sm:gap-4">
        <button
          onClick={onMenuClick}
          className="lg:hidden shrink-0 px-2.5 py-1.5 rounded border border-border text-sm text-muted hover:text-foreground"
          aria-label="Toggle sidebar"
        >
          {t("Menu")}
        </button>
        <h1 className="truncate text-base font-semibold sm:text-lg">{title}</h1>
      </div>

      {instagramAccountCount > 0 ? (
        <p className="shrink-0 truncate text-sm text-muted">
          {instagramAccountCount > 1
            ? t("{n} accounts", { n: instagramAccountCount })
            : `@${instagramUsername}`}
        </p>
      ) : (
        <a
          href="/api/instagram/connect"
          className="shrink-0 whitespace-nowrap text-sm font-semibold px-4 py-1.5 rounded-lg bg-accent text-white hover:bg-accent-hover"
        >
          {/* Full label needs more room than a 360px header has to spare. */}
          <span className="sm:hidden">{t("Connect")}</span>
          <span className="hidden sm:inline">{t("Connect Instagram")}</span>
        </a>
      )}
    </header>
  );
}
