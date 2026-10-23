"use client";

/** Dados da página Canais (grade e detalhe): canais, contas de TikTok/YouTube, posts e papel da pessoa. */

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { callApi } from "@/components/posts/api";
import type { Overview, Role } from "@/components/channels/types";
import type { PostDTO, SocialAccountDTO } from "@/lib/tiktok-composer";

export function useChannelsData() {
  const router = useRouter();
  const [data, setData] = useState<Overview | null>(null);
  const [social, setSocial] = useState<SocialAccountDTO[]>([]);
  const [posts, setPosts] = useState<PostDTO[]>([]);
  const [postsLoading, setPostsLoading] = useState(true);
  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [overview, accounts, list] = await Promise.all([
        fetch("/api/channels", { cache: "no-store" }).then((res) => res.json()),
        callApi<SocialAccountDTO[]>("/api/social-accounts"),
        callApi<PostDTO[]>("/api/posts"),
      ]);
      if (overview.success) {
        setData(overview.data);
        setLoadError(null);
      } else {
        setLoadError(overview.error ?? "error");
      }
      // TikTok e YouTube são extras: se falharem, Instagram e Facebook seguem na tela.
      setSocial(accounts.ok && accounts.data ? accounts.data : []);
      setPosts(list.ok && list.data ? list.data : []);
    } catch {
      setLoadError("error");
    } finally {
      setLoading(false);
      setPostsLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial
    void load();
    fetch("/api/workspace/members")
      .then((r) => r.json())
      .then((p) => p.success && setRole(p.data.currentUserRole))
      .catch(() => undefined);
  }, [load]);

  // Depois de qualquer mudança: dados novos aqui e o aviso do layout.
  const refresh = useCallback(async () => {
    await load();
    router.refresh();
  }, [load, router]);

  return { data, social, posts, postsLoading, role, loading, loadError, refresh };
}
