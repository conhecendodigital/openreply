"use client";

/**
 * Detalhe de um canal (23/10/2026). Abre ao clicar num cartão da grade de /channels e
 * reúne tudo o que antes ficava espalhado: dados, estado e permissões, testar conexão,
 * reconectar, desconectar (com confirmação), webhooks e, nos canais que publicam, os
 * posts agendados e recentes com o link para a aba Posts.
 */

import Link from "next/link";
import { useParams } from "next/navigation";
import { ChannelPosts } from "@/components/channels/channel-posts";
import { InstagramChannelDetail } from "@/components/channels/instagram-detail";
import { SocialChannelDetail } from "@/components/channels/social-detail";
import { useChannelsData } from "@/components/channels/use-channels";
import { useT } from "@/components/lang-provider";

export default function ChannelDetailPage() {
  const t = useT();
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const { data, social, posts, postsLoading, role, loading, loadError, refresh } = useChannelsData();

  const card = data?.instagram.find((c) => c.id === id) ?? null;
  const account = card ? null : (social.find((a) => a.id === id && a.source === "social") ?? null);
  const channelPosts = posts.filter((p) => p.accountId === id);
  // Instagram e Facebook publicam Reels e vídeos; TikTok e YouTube também.
  const found = card ?? account;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/channels" className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline">
        <span aria-hidden>←</span>
        {t("Back to channels")}
      </Link>

      {loading && <div className="panel h-56 animate-pulse rounded-xl" />}

      {!loading && loadError && !found && (
        <div className="rounded-xl border border-error/20 bg-error/10 p-4 text-sm text-error">
          {t("Could not load the channels. Try again in a moment.")}
        </div>
      )}

      {!loading && !loadError && !found && (
        <div className="panel rounded-xl p-6 text-center">
          <p className="text-sm font-semibold">{t("Channel not found")}</p>
          <p className="mt-1 text-sm text-muted">{t("It may have been removed. Go back to the list of channels.")}</p>
        </div>
      )}

      {card && <InstagramChannelDetail card={card} role={role} onChanged={refresh} />}
      {account && <SocialChannelDetail account={account} role={role} onChanged={refresh} />}

      {found && <ChannelPosts posts={channelPosts} loading={postsLoading} />}
    </div>
  );
}
