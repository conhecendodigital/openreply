"use client";

/**
 * Posts: agendamento de posts no TikTok (Direct Post), YouTube, Instagram (Reels) e
 * Facebook (Página). Contas conectadas, lista de posts por status e o compositor.
 * Publicar e agendar são sempre um clique de pessoa.
 */

import { Suspense, useCallback, useEffect, useState } from "react";
import { useT } from "@/components/lang-provider";
import { callApi } from "@/components/posts/api";
import { AccountsBar, btnPrimary } from "@/components/posts/accounts-bar";
import { PostComposer } from "@/components/posts/post-composer";
import { PostList } from "@/components/posts/post-list";
import { ConnectNotice } from "@/components/posts/connect-notice";
import type { PostDTO, SocialAccountDTO } from "@/lib/tiktok-composer";

export default function PostsPage() {
  const t = useT();
  const [accounts, setAccounts] = useState<SocialAccountDTO[]>([]);
  const [posts, setPosts] = useState<PostDTO[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loadingPosts, setLoadingPosts] = useState(true);
  const [postsError, setPostsError] = useState(false);
  const [composer, setComposer] = useState<{ post: PostDTO | null; mode: "draft" | "schedule" } | null>(null);

  const loadAccounts = useCallback(async () => {
    const res = await callApi<SocialAccountDTO[]>("/api/social-accounts");
    if (res.ok && res.data) setAccounts(res.data);
    setLoadingAccounts(false);
  }, []);

  const loadPosts = useCallback(async () => {
    const res = await callApi<PostDTO[]>("/api/posts");
    if (res.ok && res.data) {
      setPosts(res.data);
      setPostsError(false);
    } else {
      setPostsError(true);
    }
    setLoadingPosts(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial das duas listas
    void loadAccounts();
    void loadPosts();
  }, [loadAccounts, loadPosts]);

  const hasActive = accounts.some((a) => a.status === "ACTIVE");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-muted">
          {t("Plan and schedule your posts. You always confirm each post yourself before it goes out.")}
        </p>
        {!composer && (
          <button
            type="button"
            disabled={!hasActive}
            onClick={() => setComposer({ post: null, mode: "draft" })}
            className={btnPrimary}
          >
            {t("New post")}
          </button>
        )}
      </div>

      <Suspense fallback={null}>
        <ConnectNotice />
      </Suspense>

      <AccountsBar accounts={accounts} loading={loadingAccounts} onChanged={loadAccounts} />

      {composer && (
        <PostComposer
          key={composer.post?.id ?? "new"}
          accounts={accounts}
          post={composer.post}
          initialMode={composer.mode}
          onClose={() => setComposer(null)}
          onSaved={loadPosts}
        />
      )}

      <section aria-label={t("Posts")} className="space-y-3">
        <h2 className="text-sm font-semibold">{t("Posts")}</h2>
        <PostList
          posts={posts}
          loading={loadingPosts}
          error={postsError}
          onEdit={(post, mode) => {
            setComposer({ post, mode });
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
          onChanged={loadPosts}
        />
      </section>
    </div>
  );
}
