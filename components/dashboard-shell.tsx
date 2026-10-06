"use client";

import { useState } from "react";
import Sidebar from "@/components/sidebar";
import TopBar from "@/components/top-bar";
import ChannelAlertBanner, { type BannerAlert } from "@/components/channel-alert-banner";
import type { AdminMenuState } from "@/lib/platform-admin";

interface DashboardShellProps {
  children: React.ReactNode;
  workspaceName: string;
  instagramUsername: string | null;
  instagramAccountCount: number;
  /** Channels that need attention (banner at the top of every page). */
  channelAlerts?: BannerAlert[];
  /** Item Admin do menu: só o admin da plataforma (lib/platform-admin.ts). */
  adminMenu?: AdminMenuState;
}

export default function DashboardShell({
  children,
  workspaceName,
  instagramUsername,
  instagramAccountCount,
  channelAlerts = [],
  adminMenu = null,
}: DashboardShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    // h-dvh, not h-screen: on mobile browsers the URL bar eats into 100vh, which
    // would push the composer and pagination controls below the fold.
    <div className="flex h-dvh overflow-hidden bg-background">
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        workspaceName={workspaceName}
        channelsNeedAttention={channelAlerts.length > 0}
        adminMenu={adminMenu}
      />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar
          onMenuClick={() => setSidebarOpen(true)}
          instagramUsername={instagramUsername}
          instagramAccountCount={instagramAccountCount}
        />

        {/* overflow-x-hidden: enabling vertical scrolling makes the browser
            allow horizontal scrolling too, which lets a wide child drag the
            whole page sideways on a phone. */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden">
          <div className="px-4 lg:px-8 py-5 sm:py-6 max-w-7xl mx-auto">
            <ChannelAlertBanner alerts={channelAlerts} />
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
