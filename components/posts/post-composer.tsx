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
import { btnPrimary, btnSecondary } from "@/components/posts/accounts-bar";
import { FacebookTop } from "@/components/posts/options/facebook";
import { InstagramFields } from "@/components/posts/options/instagram";
import { TikTokFields, TikTokFooter, TikTokTop } from "@/components/posts/options/tiktok";
import { YouTubeFields, YouTubeTop } from "@/components/posts/options/youtube";
import { fieldClass, labelClass } from "@/components/posts/styles";
import { VideoPicker, type MediaState, type UploadState } from "@/components/posts/video-picker";
import { BrandIcon } from "@/components/social/brand-icon";
import { ChipsInput } from "@/components/posts/chips-input";
import { cleanHashtag, countHashtags, INSTAGRAM_HASHTAG_MAX, joinCaptionHashtags, splitCaptionHashtags } from "@/lib/social/text-fields";
import { NETWORK_LIMITS } from "@/lib/social/limits";
import {
  channelKey,
  channelsFor,
  formatFromSettings,
  pickedChannels,
  shortProblem,
  toggleChannel,
  withYouTubeFormat,
  type Channel,
} from "@/lib/social/channels";
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
  type SocialPlatform,
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
  const allChannels = channelsFor(active);
  // Canais marcados. Editar um post existente continua sendo uma conta só.
  const [picked, setPicked] = useState<string[]>(() => {
    if (post) return [channelKey(post.accountId, post.platform === "YOUTUBE" ? formatFromSettings(post.settings) : null)];
    return active.length === 1 && active[0].platform !== "YOUTUBE" ? [active[0].id] : [];
  });
  const chosen = pickedChannels(allChannels, picked);
  const first = chosen[0] ?? null;
  const accountId = first?.accountId ?? post?.accountId ?? "";
  const network = first?.platform ?? post?.platform ?? null;
  const networksChosen = new Set(chosen.map((c) => c.platform));
  const multi = chosen.length > 1;
  const [videoSize, setVideoSize] = useState<{ width: number; height: number } | null>(null);

  const [info, setInfo] = useState<{ id: string; data: CreatorInfo | null } | null>(null);
  // Legenda + hashtags (Instagram, TikTok, Facebook). O YouTube tem descrição e tags próprias.
  const initialText = post && post.platform !== "YOUTUBE" ? splitCaptionHashtags(post.caption ?? "") : { caption: "", hashtags: [] as string[] };
  const [caption, setCaption] = useState(initialText.caption);
  const [hashtags, setHashtags] = useState<string[]>(initialText.hashtags);
  const [tiktok, setTiktok] = useState<TikTokSettings>(post?.platform === "TIKTOK" ? (post.settings as unknown as TikTokSettings) : emptySettings());
  const [youtube, setYoutube] = useState<YouTubeForm>(post?.platform === "YOUTUBE" ? youTubeFormFromSettings(post.settings, post.caption ?? "") : emptyYouTubeForm());
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

  // Detalhes do TikTok vêm da primeira conta de TikTok marcada.
  const tiktokId = chosen.find((c) => c.platform === "TIKTOK")?.accountId ?? "";
  const infoData = tiktokId && info?.id === tiktokId ? info.data : null;
  const infoLoading = Boolean(tiktokId) && info?.id !== tiktokId;
  const infoFailed = Boolean(tiktokId) && info?.id === tiktokId && !info.data;

  // Detalhes do criador do TikTok (privacidades, interações e duração) toda vez que a conta muda.
  useEffect(() => {
    if (!tiktokId) return;
    let alive = true;
    void callApi<CreatorInfo>(`/api/social-accounts/${tiktokId}/creator-info`).then((res) => {
      if (!alive) return;
      setInfo({ id: tiktokId, data: res.data });
      if (res.data) setTiktok((s) => normalizeSettings(s, res.data));
    });
    return () => {
      alive = false;
    };
  }, [tiktokId]);

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
    const accepted = (chosen.length ? chosen.map((c) => NETWORK_LIMITS[c.platform].videoTypes) : [NETWORK_LIMITS.TIKTOK.videoTypes]).reduce((a, b) =>
      a.filter((x) => b.includes(x))
    );
    if (!accepted.includes(file.type)) {
      setUpload({ pct: 0, error: networksChosen.has("TIKTOK") && networksChosen.size === 1 || !network ? t("Use an MP4, MOV or WebM video.") : t("Use an MP4 or MOV video.") });
      return;
    }
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = URL.createObjectURL(file);
    setDurationSec(null);
    setVideoSize(null);
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

  function settingsFor(channel: Channel): Record<string, unknown> {
    if (channel.platform === "YOUTUBE") {
      return withYouTubeFormat(youTubeSettingsPayload(youtube), channel.format ?? "video", {
        width: videoSize?.width ?? null,
        height: videoSize?.height ?? null,
        durationSec: durationSec,
      });
    }
    if (channel.platform === "INSTAGRAM") return { ...instagram };
    if (channel.platform === "FACEBOOK") return facebookSettingsPayload(facebook);
    return { ...tiktok };
  }

  /** Texto que vai para a rede: YouTube = descrição; as outras = legenda com as hashtags no fim. */
  function textFor(c: Channel): string {
    return c.platform === "YOUTUBE" ? youtube.description : joinCaptionHashtags(caption, hashtags);
  }

  function channelName(c: Channel): string {
    const a = accounts.find((x) => x.id === c.accountId);
    const net = c.platform === "YOUTUBE" && c.format === "short" ? "YouTube Shorts" : NETWORK_NAME[c.platform];
    return a ? `${net} (${a.displayName})` : net;
  }

  /** Erros de um canal, sem misturar com os dos outros. */
  function channelErrors(c: Channel, action: ComposerAction): string[] {
    const errs =
      c.platform !== "TIKTOK"
        ? validateSocialComposer(
            { network: c.platform, accountId: c.accountId, caption: textFor(c), mediaUrl: media.url, mediaBytes: media.bytes, mediaContentType: media.type, youtube, facebook, scheduledLocal },
            action
          )
        : validateComposer({ accountId: c.accountId, caption: textFor(c), mediaUrl: media.url, mediaContentType: media.type, durationSec, settings: tiktok, scheduledLocal }, infoData, action);
    if (c.platform === "YOUTUBE" && c.format === "short" && media.url) {
      const problem = shortProblem({ width: videoSize?.width ?? null, height: videoSize?.height ?? null, durationSec });
      if (problem) errs.push(problem);
    }
    return errs;
  }

  async function saveOne(c: Channel, action: ComposerAction, existingId: string | null): Promise<{ ok: boolean; stage: "save" | "action" }> {
    const body = {
      socialAccountId: c.accountId,
      caption: textFor(c),
      mediaUrl: media.url,
      mediaBytes: media.bytes,
      mediaContentType: media.type,
      settings: settingsFor(c),
    };
    const saved = existingId
      ? await callApi<PostDTO>(`/api/posts/${existingId}`, { method: "PATCH", body: JSON.stringify(body) })
      : await callApi<PostDTO>("/api/posts", { method: "POST", body: JSON.stringify({ ...body, scheduledAt: null }) });
    if (!saved.ok || !saved.data) return { ok: false, stage: "save" };
    if (!existingId) setPostId(saved.data.id);
    if (action === "schedule") {
      const res = await callApi(`/api/posts/${saved.data.id}/schedule`, { method: "POST", body: JSON.stringify({ scheduledAt: brasiliaLocalToIso(scheduledLocal) }) });
      if (!res.ok) return { ok: false, stage: "action" };
    } else if (action === "publish") {
      const res = await callApi(`/api/posts/${saved.data.id}/publish`, { method: "POST" });
      if (!res.ok) return { ok: false, stage: "action" };
    }
    return { ok: true, stage: "action" };
  }

  async function submit(action: ComposerAction) {
    const global: string[] = [];
    if (!chosen.length) global.push("Pick the account.");
    if (upload && !upload.error) global.push("Wait for the upload to finish.");
    // Cada canal é conferido sozinho: o que está certo segue, o que não está é avisado pelo nome.
    const problems: string[] = [];
    const ready: Channel[] = [];
    for (const c of chosen) {
      const errs = channelErrors(c, action);
      if (errs.length === 0) ready.push(c);
      else for (const e of errs) problems.push(multi ? `${channelName(c)}: ${t(e)}` : e);
    }
    setErrors([...global, ...problems]);
    if (global.length || ready.length === 0) return;

    setSaving(action);
    // Um post por canal; o vídeo já foi enviado uma vez só. Um canal que falha não derruba os outros.
    const failed: string[] = [];
    const done: string[] = [];
    for (const c of ready) {
      const result = await saveOne(c, action, chosen.length === 1 ? postId : null);
      if (result.ok) done.push(c.key);
      else failed.push(`${channelName(c)}: ${t(result.stage === "save" ? "Could not save the post. Check the fields and try again." : "The post was saved as a draft, but it could not be published.")}`);
    }
    setSaving(null);
    if (failed.length || problems.length) {
      // Quem deu certo sai da seleção para não ser criado de novo ao tentar outra vez.
      setPicked((p) => p.filter((k) => !done.includes(k)));
      setErrors([...problems, ...failed]);
      await onSaved();
      return;
    }
    await onSaved();
    onClose();
  }

  const nowLocal = isoToBrasiliaLocal(new Date().toISOString());
  const uploading = Boolean(upload && !upload.error);
  const isYouTube = networksChosen.has("YOUTUBE");
  const captionChannels = chosen.filter((c) => c.platform !== "YOUTUBE");
  // Sem canal marcado a tela mostra a legenda; com só YouTube, só os campos dele.
  const showCaption = captionChannels.length > 0 || chosen.length === 0;
  const captionMax = captionChannels.length ? Math.min(...captionChannels.map((c) => NETWORK_LIMITS[c.platform].captionMax)) : NETWORK_LIMITS.TIKTOK.captionMax;
  const fullCaption = joinCaptionHashtags(caption, hashtags);
  const hasShort = chosen.some((c) => c.platform === "YOUTUBE" && c.format === "short");
  const captionNetworks = Array.from(new Set(captionChannels.map((c) => c.platform)));
  // Opções por rede, na ordem dos canais marcados (YouTube e Shorts dividem o mesmo grupo). Facebook só tem o título.
  const optionNetworks = Array.from(new Set(chosen.map((c) => c.platform))).filter((n) => n !== "FACEBOOK");
  const lockedAccount = Boolean(post?.status === "SCHEDULED" || postId);
  const hasTikTok = networksChosen.has("TIKTOK");
  const lacksYouTubeUpload = chosen.some((c) => {
    if (c.platform !== "YOUTUBE") return false;
    const a = accounts.find((x) => x.id === c.accountId);
    return a != null && !a.scopes.includes(YOUTUBE_UPLOAD_SCOPE);
  });

  return (
    <section aria-label={post ? t("Edit post") : t("New post")} className="panel space-y-5 rounded-xl border border-border p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{post ? t("Edit post") : t("New post")}</h2>
        <button type="button" onClick={onClose} className={btnSecondary}>
          {t("Close")}
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <VideoPicker media={media} upload={upload} accept={acceptForNetwork(networksChosen.size === 1 ? network : networksChosen.has("TIKTOK") ? "INSTAGRAM" : network)} onPick={(f) => void pickFile(f)} onDuration={setDurationSec} onDimensions={(width, height) => setVideoSize({ width, height })} />

        <div className="min-w-0 space-y-5">
          <fieldset className="space-y-2" disabled={lockedAccount}>
            <legend className={labelClass}>{post ? t("Account") : t("Channels")}</legend>
            {!post && <p className="text-xs text-muted">{t("Mark every channel that should get this video. Each one becomes its own post.")}</p>}
            <div className="flex flex-wrap gap-2">
              {allChannels
                .filter((c) => !post || c.key === picked[0])
                .map((c) => {
                  const a = accounts.find((x) => x.id === c.accountId);
                  const on = picked.includes(c.key);
                  const label = c.platform === "YOUTUBE" && c.format === "short" ? "YouTube Shorts" : NETWORK_NAME[c.platform];
                  return (
                    <button
                      key={c.key}
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      disabled={lockedAccount}
                      onClick={() => setPicked((p) => toggleChannel(p, c.key))}
                      className={`flex items-center gap-2.5 rounded-xl border px-3 py-2 text-left text-sm transition-colors disabled:cursor-default ${
                        on ? "border-accent bg-accent/10" : "border-border bg-surface hover:bg-surface-hover"
                      }`}
                    >
                      <span className={on ? "" : "opacity-60 grayscale"}>
                        <BrandIcon brand={c.platform} size={30} />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-xs font-semibold">{label}</span>
                        <span className="block max-w-[11rem] truncate text-xs text-muted">{a?.displayName}</span>
                      </span>
                    </button>
                  );
                })}
            </div>
            {active.length === 0 && <span className="text-xs text-warning">{t("Connect an account first.")}</span>}
          </fieldset>

          {lacksYouTubeUpload && (
            <p role="alert" className="rounded-xl bg-warning/10 px-4 py-2.5 text-sm text-warning">
              {t("This YouTube channel did not allow uploads. Connect it again and accept every permission.")}
            </p>
          )}

          {hasTikTok && <TikTokTop accountId={accountId} info={infoData} loading={infoLoading} failed={infoFailed} durationSec={durationSec} />}
          {networksChosen.has("FACEBOOK") && <FacebookTop form={facebook} onChange={(n) => setFacebook((f) => ({ ...f, ...n }))} />}

          {showCaption && (
            <div className="space-y-4">
              {isYouTube && captionNetworks.length > 0 && (
                <p className="flex items-center gap-2 text-xs font-semibold text-muted">
                  {captionNetworks.map((n) => (
                    <BrandIcon key={n} brand={n} size={18} />
                  ))}
                  {captionNetworks.map((n) => NETWORK_NAME[n]).join(", ")}
                </p>
              )}
              <label className="flex flex-col gap-2 text-sm">
                <span className={labelClass}>{t("Caption")}</span>
                <textarea
                  value={caption}
                  maxLength={captionMax}
                  rows={4}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder={t("Write the caption of the video")}
                  className={fieldClass}
                />
                <span className={`self-end text-xs ${fullCaption.length > captionMax ? "text-error" : "text-muted"}`}>
                  {fullCaption.length}/{captionMax}
                </span>
              </label>
              <ChipsInput
                label={t("Hashtags")}
                values={hashtags}
                onChange={setHashtags}
                clean={cleanHashtag}
                prefix="#"
                placeholder={t("Type a hashtag and press Enter")}
                counter={networksChosen.has("INSTAGRAM") ? { value: countHashtags(fullCaption), max: INSTAGRAM_HASHTAG_MAX } : undefined}
                hint={t("They go at the end of the caption, after a blank line.")}
              />
            </div>
          )}

          {isYouTube && (
            <div className="space-y-4">
              {showCaption && (
                <NetworkHeading network="YOUTUBE" />
              )}
              <YouTubeTop form={youtube} onChange={(n) => setYoutube((f) => ({ ...f, ...n }))} hasShort={hasShort} />
            </div>
          )}

          {optionNetworks.map((n, i) => (
            <div key={n} className={`space-y-4 ${i > 0 || optionNetworks.length > 1 ? "border-t border-border pt-5" : ""}`}>
              {optionNetworks.length > 1 && <NetworkHeading network={n} />}
              {n === "TIKTOK" && <TikTokFields settings={tiktok} info={infoData} patch={patchTikTok} />}
              {n === "YOUTUBE" && <YouTubeFields form={youtube} onChange={(f2) => setYoutube((f) => ({ ...f, ...f2 }))} />}
              {n === "INSTAGRAM" && <InstagramFields form={instagram} onChange={(f2) => setInstagram((f) => ({ ...f, ...f2 }))} />}
            </div>
          ))}

          <fieldset className="space-y-2 border-t border-border pt-5">
            <legend className={`${labelClass} float-left mb-2 w-full`}>{t("When")}</legend>
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

          {hasTikTok && <TikTokFooter settings={tiktok} />}

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

/** Cabeçalho de grupo: ícone + nome da rede, para saber de qual rede é cada opção. */
function NetworkHeading({ network }: { network: SocialPlatform }) {
  return (
    <p className="flex items-center gap-2 text-xs font-semibold text-muted">
      <BrandIcon brand={network} size={18} />
      {NETWORK_NAME[network]}
    </p>
  );
}
