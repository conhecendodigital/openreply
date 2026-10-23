"use client";

/**
 * Compositor de post (TikTok, YouTube, Instagram Reels, Facebook Página). Esta casca cuida do
 * que é igual em todas as redes: conta, vídeo, legenda, quando publicar e salvar. As opções de
 * cada rede ficam em components/posts/options/. Nada é publicado sem a pessoa clicar em
 * Agendar ou Publicar agora.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/components/lang-provider";
import { callApi, putFile, type UploadTicket } from "@/components/posts/api";
import { Avatar, btnPrimary, btnSecondary } from "@/components/posts/accounts-bar";
import { FacebookTop } from "@/components/posts/options/facebook";
import { InstagramFields } from "@/components/posts/options/instagram";
import { TikTokFields, TikTokFooter, TikTokTop } from "@/components/posts/options/tiktok";
import { YouTubeFields, YouTubeTop } from "@/components/posts/options/youtube";
import { fieldClass, labelClass } from "@/components/posts/styles";
import { VideoPicker, type MediaState, type UploadState } from "@/components/posts/video-picker";
import { BrandIcon } from "@/components/social/brand-icon";
import { NETWORK_LIMITS } from "@/lib/social/limits";
import {
  NETWORK_NAME,
  acceptForNetwork,
  emptyFacebookForm,
  emptyInstagramForm,
  emptyYouTubeForm,
  facebookFormFromSettings,
  facebookSettingsPayload,
  instagramFormFromSettings,
  validateSocialComposer,
  youTubeFormFromSettings,
  youTubeSettingsPayload,
  type FacebookForm,
  type InstagramForm,
  type YouTubeForm,
} from "@/lib/social-composer";
import {
  brasiliaLocalToIso,
  emptySettings,
  isoToBrasiliaLocal,
  normalizeSettings,
  validateComposer,
  type ComposerAction,
  type CreatorInfo,
  type PostDTO,
  type SocialAccountDTO,
  type TikTokSettings,
} from "@/lib/tiktok-composer";

const YOUTUBE_UPLOAD_SCOPE = "https://www.googleapis.com/auth/youtube.upload";

export function PostComposer({
  accounts,
  post,
  initialMode,
  onClose,
  onSaved,
}: {
  accounts: SocialAccountDTO[];
  post: PostDTO | null;
  initialMode: "draft" | "schedule";
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const t = useT();
  const active = accounts.filter((a) => a.status === "ACTIVE");
  const [accountId, setAccountId] = useState(post?.accountId ?? (active.length === 1 ? active[0].id : ""));
  const account = accounts.find((a) => a.id === accountId) ?? null;
  const network = account?.platform ?? post?.platform ?? null;

  const [info, setInfo] = useState<{ id: string; data: CreatorInfo | null } | null>(null);
  const [caption, setCaption] = useState(post?.caption ?? "");
  const [tiktok, setTiktok] = useState<TikTokSettings>(post?.platform === "TIKTOK" ? (post.settings as unknown as TikTokSettings) : emptySettings());
  const [youtube, setYoutube] = useState<YouTubeForm>(post?.platform === "YOUTUBE" ? youTubeFormFromSettings(post.settings) : emptyYouTubeForm());
  const [instagram, setInstagram] = useState<InstagramForm>(post?.platform === "INSTAGRAM" ? instagramFormFromSettings(post.settings) : emptyInstagramForm());
  const [facebook, setFacebook] = useState<FacebookForm>(post?.platform === "FACEBOOK" ? facebookFormFromSettings(post.settings) : emptyFacebookForm());
  const [media, setMedia] = useState<MediaState>({
    url: post?.mediaUrl ?? "",
    bytes: post?.mediaBytes ?? 0,
    type: post?.mediaContentType ?? "",
    name: "",
    preview: post?.mediaUrl ?? "",
  });
  const [durationSec, setDurationSec] = useState<number | null>(null);
  const [upload, setUpload] = useState<UploadState>(null);
  const [mode, setMode] = useState<"now" | "schedule">(initialMode === "schedule" || post?.status === "SCHEDULED" ? "schedule" : "now");
  const [scheduledLocal, setScheduledLocal] = useState(isoToBrasiliaLocal(post?.scheduledAt));
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState<ComposerAction | null>(null);
  const [postId, setPostId] = useState<string | null>(post?.id ?? null);
  const objectUrl = useRef<string | null>(null);

  const infoData = network === "TIKTOK" && info?.id === accountId ? info.data : null;
  const infoLoading = network === "TIKTOK" && Boolean(accountId) && info?.id !== accountId;
  const infoFailed = network === "TIKTOK" && Boolean(accountId) && info?.id === accountId && !info.data;

  // Detalhes do criador do TikTok (privacidades, interações e duração) toda vez que a conta muda.
  useEffect(() => {
    if (!accountId || network !== "TIKTOK") return;
    let alive = true;
    void callApi<CreatorInfo>(`/api/social-accounts/${accountId}/creator-info`).then((res) => {
      if (!alive) return;
      setInfo({ id: accountId, data: res.data });
      if (res.data) setTiktok((s) => normalizeSettings(s, res.data));
    });
    return () => {
      alive = false;
    };
  }, [accountId, network]);

  useEffect(
    () => () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    },
    []
  );

  const patchTikTok = useCallback(
    (next: Partial<TikTokSettings>) => {
      setTiktok((s) => normalizeSettings({ ...s, ...next }, infoData));
    },
    [infoData]
  );

  async function pickFile(file: File | undefined) {
    if (!file) return;
    setErrors([]);
    const accepted = NETWORK_LIMITS[network ?? "TIKTOK"].videoTypes;
    if (!accepted.includes(file.type)) {
      setUpload({ pct: 0, error: network === "TIKTOK" || !network ? t("Use an MP4, MOV or WebM video.") : t("Use an MP4 or MOV video.") });
      return;
    }
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = URL.createObjectURL(file);
    setDurationSec(null);
    setMedia({ url: "", bytes: file.size, type: file.type, name: file.name, preview: objectUrl.current });
    setUpload({ pct: 0, error: null });

    const ticket = await callApi<UploadTicket>("/api/posts/upload-url", {
      method: "POST",
      body: JSON.stringify({ contentType: file.type, size: file.size, name: file.name }),
    });
    if (!ticket.ok || !ticket.data) {
      setUpload({
        pct: 0,
        error: ticket.code === "not_configured" ? t("Video upload is not set up on the server yet.") : t("Could not start the upload. Try again."),
      });
      return;
    }
    const done = await putFile(ticket.data, file, file.type, (pct) => setUpload({ pct, error: null }));
    if (!done) {
      setUpload({ pct: 0, error: t("The upload failed. Try again.") });
      return;
    }
    setMedia((m) => ({ ...m, url: ticket.data!.publicUrl }));
    setUpload(null);
  }

  function settingsFor(action: ComposerAction): Record<string, unknown> {
    if (network === "YOUTUBE") return youTubeSettingsPayload(youtube);
    if (network === "INSTAGRAM") return { ...instagram };
    if (network === "FACEBOOK") return facebookSettingsPayload(facebook);
    void action;
    return { ...tiktok };
  }

  async function submit(action: ComposerAction) {
    const errs =
      network && network !== "TIKTOK"
        ? validateSocialComposer(
            { network, accountId, caption, mediaUrl: media.url, mediaBytes: media.bytes, mediaContentType: media.type, youtube, facebook, scheduledLocal },
            action
          )
        : validateComposer({ accountId, caption, mediaUrl: media.url, mediaContentType: media.type, durationSec, settings: tiktok, scheduledLocal }, infoData, action);
    if (!network && !errs.length) errs.push("Pick the account.");
    if (upload && !upload.error) errs.push("Wait for the upload to finish.");
    setErrors(errs);
    if (errs.length) return;

    setSaving(action);
    const body = {
      socialAccountId: accountId,
      caption,
      mediaUrl: media.url,
      mediaBytes: media.bytes,
      mediaContentType: media.type,
      settings: settingsFor(action),
    };
    const saved = postId
      ? await callApi<PostDTO>(`/api/posts/${postId}`, { method: "PATCH", body: JSON.stringify(body) })
      : await callApi<PostDTO>("/api/posts", { method: "POST", body: JSON.stringify({ ...body, scheduledAt: null }) });
    if (!saved.ok || !saved.data) {
      setSaving(null);
      setErrors(["Could not save the post. Check the fields and try again."]);
      return;
    }
    setPostId(saved.data.id);

    if (action === "schedule") {
      const res = await callApi(`/api/posts/${saved.data.id}/schedule`, {
        method: "POST",
        body: JSON.stringify({ scheduledAt: brasiliaLocalToIso(scheduledLocal) }),
      });
      if (!res.ok) {
        setSaving(null);
        setErrors(["The post was saved as a draft, but it could not be scheduled."]);
        await onSaved();
        return;
      }
    } else if (action === "publish") {
      const res = await callApi(`/api/posts/${saved.data.id}/publish`, { method: "POST" });
      if (!res.ok) {
        setSaving(null);
        setErrors(["The post was saved as a draft, but it could not be published."]);
        await onSaved();
        return;
      }
    }
    setSaving(null);
    await onSaved();
    onClose();
  }

  const nowLocal = isoToBrasiliaLocal(new Date().toISOString());
  const uploading = Boolean(upload && !upload.error);
  const captionMax = NETWORK_LIMITS[network ?? "TIKTOK"].captionMax;
  const isYouTube = network === "YOUTUBE";
  const lockedAccount = Boolean(post?.status === "SCHEDULED" || postId);
  const lacksYouTubeUpload = isYouTube && account != null && !account.scopes.includes(YOUTUBE_UPLOAD_SCOPE);
  const grouped = (["TIKTOK", "YOUTUBE", "INSTAGRAM", "FACEBOOK"] as const)
    .map((n) => ({ network: n, items: active.filter((a) => a.platform === n) }))
    .filter((g) => g.items.length > 0);

  return (
    <section aria-label={post ? t("Edit post") : t("New post")} className="panel space-y-5 rounded-xl border border-border p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{post ? t("Edit post") : t("New post")}</h2>
        <button type="button" onClick={onClose} className={btnSecondary}>
          {t("Close")}
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <VideoPicker media={media} upload={upload} accept={acceptForNetwork(network)} onPick={(f) => void pickFile(f)} onDuration={setDurationSec} />

        <div className="min-w-0 space-y-5">
          <label className="flex flex-col gap-2 text-sm">
            <span className={labelClass}>{t("Account")}</span>
            <select value={accountId} disabled={lockedAccount} onChange={(e) => setAccountId(e.target.value)} className={fieldClass}>
              <option value="">{t("Choose an account")}</option>
              {grouped.map((g) => (
                <optgroup key={g.network} label={NETWORK_NAME[g.network]}>
                  {g.items.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.displayName}
                      {a.username ? ` (@${a.username})` : ""}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            {active.length === 0 && <span className="text-xs text-warning">{t("Connect an account first.")}</span>}
          </label>

          {account && network !== "TIKTOK" && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl bg-surface-hover px-4 py-3">
              <Avatar url={account.avatarUrl} name={account.displayName} size={36} />
              <div className="min-w-[10rem] flex-1">
                <p className="text-xs text-muted">{t("Posting as")}</p>
                <p className="break-words text-sm font-semibold">
                  {account.displayName}
                  {account.username ? <span className="font-normal text-muted"> @{account.username}</span> : null}
                </p>
              </div>
              <BrandIcon brand={account.platform} size={28} />
            </div>
          )}
          {lacksYouTubeUpload && (
            <p role="alert" className="rounded-xl bg-warning/10 px-4 py-2.5 text-sm text-warning">
              {t("This YouTube channel did not allow uploads. Connect it again and accept every permission.")}
            </p>
          )}

          {network === "TIKTOK" && <TikTokTop accountId={accountId} info={infoData} loading={infoLoading} failed={infoFailed} durationSec={durationSec} />}
          {network === "YOUTUBE" && <YouTubeTop form={youtube} onChange={(n) => setYoutube((f) => ({ ...f, ...n }))} />}
          {network === "FACEBOOK" && <FacebookTop form={facebook} onChange={(n) => setFacebook((f) => ({ ...f, ...n }))} />}

          <label className="flex flex-col gap-2 text-sm">
            <span className={labelClass}>{isYouTube ? t("Description") : t("Caption")}</span>
            <textarea
              value={caption}
              maxLength={captionMax}
              rows={4}
              onChange={(e) => setCaption(e.target.value)}
              placeholder={isYouTube ? t("Write the description of the video") : t("Write the caption of the video")}
              className={fieldClass}
            />
            <span className="self-end text-xs text-muted">
              {caption.length}/{captionMax}
            </span>
          </label>

          {network === "TIKTOK" && <TikTokFields settings={tiktok} info={infoData} patch={patchTikTok} />}
          {network === "YOUTUBE" && <YouTubeFields form={youtube} onChange={(n) => setYoutube((f) => ({ ...f, ...n }))} />}
          {network === "INSTAGRAM" && <InstagramFields form={instagram} onChange={(n) => setInstagram((f) => ({ ...f, ...n }))} />}

          <fieldset className="space-y-2">
            <legend className={labelClass}>{t("When")}</legend>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="radio" name="post-when" checked={mode === "now"} onChange={() => setMode("now")} className="h-4 w-4 accent-accent" />
                {t("Publish now")}
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="post-when" checked={mode === "schedule"} onChange={() => setMode("schedule")} className="h-4 w-4 accent-accent" />
                {t("Schedule")}
              </label>
            </div>
            {mode === "schedule" && (
              <label className="flex max-w-xs flex-col gap-1 text-sm">
                <input type="datetime-local" value={scheduledLocal} min={nowLocal} onChange={(e) => setScheduledLocal(e.target.value)} className={fieldClass} />
                <span className="text-xs text-muted">{t("Time in Brasília")}</span>
              </label>
            )}
          </fieldset>

          {network === "TIKTOK" && <TikTokFooter settings={tiktok} />}

          {errors.length > 0 && (
            <ul role="alert" className="space-y-1 rounded-xl bg-error/10 px-4 py-3 text-sm text-error">
              {errors.map((e) => (
                <li key={e}>{t(e)}</li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap gap-3">
            {post?.status !== "SCHEDULED" && (
              <button type="button" disabled={saving !== null || uploading} onClick={() => void submit("draft")} className={btnSecondary}>
                {saving === "draft" ? t("Saving...") : t("Save draft")}
              </button>
            )}
            {mode === "schedule" ? (
              <button type="button" disabled={saving !== null || uploading} onClick={() => void submit("schedule")} className={btnPrimary}>
                {saving === "schedule" ? t("Saving...") : t("Schedule")}
              </button>
            ) : (
              <button type="button" disabled={saving !== null || uploading} onClick={() => void submit("publish")} className={btnPrimary}>
                {saving === "publish" ? t("Saving...") : t("Publish now")}
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
