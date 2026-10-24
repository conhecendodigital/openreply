"use client";

/**
 * Channels. 2026-10-05: one page for every channel the Lead Engine talks through.
 * 2026-10-23: the page is now a GRID of lean cards, one per connected channel
 * (Instagram, Facebook Page, TikTok, YouTube), plus a "Connect channel" card as
 * the last item. A card shows the network, the photo and name, the status and at
 * most one extra line. Everything that used to sit in the big Instagram card
 * (details, token, webhooks, test connection, reconnect, disconnect, "delete for
 * real", the channel's posts) moved to its own page, /channels/[id].
 * Owner's rule (2026-10-03) is unchanged: disconnecting never deletes anything;
 * deleting for real is a separate, hidden step that only the owner can do.
 * Below the grid: "coming soon" cards for Telegram, WhatsApp, Messenger and
 * Threads. 2026-10-06: "Conexões e chaves" (owner and admins only): the keys of
 * uazapi, the OpenWA gateway, the Meta Pixel and Conversions API and, for the
 * platform admin, the AI keys status.
 */

import { Suspense, useMemo } from "react";
import { ChannelCard } from "@/components/channels/channel-card";
import { ComingSoonCard } from "@/components/channels/coming-soon";
import { ConnectCard } from "@/components/channels/connect-card";
import { useChannelsData } from "@/components/channels/use-channels";
import { isSeriousAlert } from "@/components/channel-alert-banner";
import { IntegrationsPanel } from "@/components/integrations-panel";
import { InstagramConnectNotice } from "@/components/instagram-connect-notice";
import { useT } from "@/components/lang-provider";
import { ConnectNotice } from "@/components/posts/connect-notice";
import { CollapsibleSection, SectionsProvider } from "@/components/ui/collapsible-section";
import { TabPanel, Tabs, type TabItem } from "@/components/ui/tabs";
import { buildGrid, countScheduled } from "@/lib/channels/grid";

export default function ChannelsPage() {
  const t = useT();
  const { data, social, posts, role, loading, loadError } = useChannelsData();

  const canManage = role === "OWNER" || role === "ADMIN";
  const instagram = useMemo(() => data?.instagram ?? [], [data]);
  const comingSoon = data?.comingSoon ?? [];

  const channels = useMemo(() => {
    const seriousAlertIds = new Set(instagram.filter((c) => c.alerts.some(isSeriousAlert)).map((c) => c.id));
    return buildGrid({ instagram, social, scheduledByAccount: countScheduled(posts), seriousAlertIds });
  }, [instagram, social, posts]);

  const on = channels.filter((c) => c.status === "ACTIVE").length;
  const alert = channels.some((c) => c.state === "reconnect" || c.state === "attention" || c.state === "expiring");

  // 07/10/2026: abas de canais e Conexões e chaves (o link antigo /channels#conexoes abre a segunda).
  // 23/10/2026: a aba "Instagram" virou "Canais"; os links #instagram e #em-breve continuam abrindo-a.
  const tabs: TabItem[] = [
    {
      id: "canais",
      label: t("Channels"),
      aliases: ["instagram", "em-breve"],
      badge: channels.length > 0 ? { text: t("{a} of {b}", { a: on, b: channels.length }), tone: alert ? "warning" : "success" } : null,
    },
    { id: "conexoes", label: t("Connections and keys") },
  ];

  return (
    <SectionsProvider page="canais">
      <div className="mx-auto max-w-6xl space-y-6">
        <Suspense fallback={null}>
          <InstagramConnectNotice />
          <ConnectNotice />
        </Suspense>

        <p className="text-sm text-muted">
          {t("Every channel the Lead Engine talks through. Disconnecting turns a channel off and never deletes anything.")}
        </p>

        <Tabs page="canais" label={t("Channel sections")} tabs={tabs}>
          <TabPanel id="canais">
            <div className="space-y-6">
              {loading && (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="panel h-[148px] animate-pulse rounded-xl" />
                  ))}
                </div>
              )}

              {!loading && loadError && (
                <div className="rounded-xl border border-error/20 bg-error/10 p-4 text-sm text-error">
                  {t("Could not load the channels. Try again in a moment.")}
                </div>
              )}

              {!loading && !loadError && (
                <section aria-label={t("Connected channels")}>
                  {channels.length === 0 && (
                    <div className="panel mb-4 rounded-xl p-6 text-center">
                      <p className="text-sm font-semibold">{t("No channel connected yet")}</p>
                      <p className="mt-1 text-sm text-muted">
                        {t("Connect Instagram, Facebook, TikTok or YouTube to launch campaigns and schedule posts.")}
                      </p>
                    </div>
                  )}
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {channels.map((channel) => (
                      <ChannelCard key={channel.id} channel={channel} />
                    ))}
                    {canManage && <ConnectCard hasAny={channels.length > 0} />}
                  </div>
                  {!canManage && role && (
                    <p className="mt-3 text-xs text-muted">{t("Only owners and admins can connect or change a channel.")}</p>
                  )}
                </section>
              )}

              <CollapsibleSection
                id="em-breve"
                title={t("Coming soon")}
                defaultOpen={false}
                badge={{ text: String(comingSoon.length) }}
                summary={comingSoon.map((c) => c.name).join(" · ")}
                description={t("Channels we can turn on next, and what each one needs.")}
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  {comingSoon.map((channel) => (
                    <ComingSoonCard key={channel.platform} channel={channel} />
                  ))}
                </div>
              </CollapsibleSection>
            </div>
          </TabPanel>

          <TabPanel id="conexoes">
            {canManage && <IntegrationsPanel />}
            {role === "MEMBER" && <p className="text-sm text-muted">{t("Only owners and admins see the connection keys.")}</p>}
          </TabPanel>
        </Tabs>
      </div>
    </SectionsProvider>
  );
}
