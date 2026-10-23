"use client";

/**
 * Compositor de post do TikTok (Direct Post). Segue as regras de UX do TikTok:
 * nome da conta, privacidade SEM valor padrão (só as opções que o TikTok devolve),
 * comentários/duet/stitch desligados por padrão, aviso de conteúdo comercial,
 * declaração de uso de música e duração máxima. Nada é publicado sem a pessoa
 * clicar em Agendar ou Publicar agora.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/components/lang-provider";
import { callApi, putFile, type UploadTicket } from "@/components/posts/api";
import { Avatar, btnPrimary, btnSecondary } from "@/components/posts/accounts-bar";
import {
  CAPTION_MAX,
  PRIVACY_LABELS,
  availablePrivacyOptions,
  brasiliaLocalToIso,
  disclosureKind,
  emptySettings,
  formatBytes,
  isAllowedVideoType,
  isoToBrasiliaLocal,
  normalizeSettings,
  validateComposer,
  type ComposerAction,
  type CreatorInfo,
  type PostDTO,
  type SocialAccountDTO,
  type TikTokSettings,
} from "@/lib/tiktok-composer";

const BC_POLICY = "https://www.tiktok.com/legal/page/global/bc-policy/en";
const MUSIC_POLICY = "https://www.tiktok.com/legal/page/global/music-usage-confirmation/en";
const field = "w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent/40 disabled:opacity-50";
const label = "text-xs font-semibold uppercase tracking-wide text-zinc-500";

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
  const [accountId, setAccountId] = useState(post?.socialAccountId ?? (active.length === 1 ? active[0].id : ""));
  const [info, setInfo] = useState<{ id: string; data: CreatorInfo | null } | null>(null);
  const [caption, setCaption] = useState(post?.caption ?? "");
  const [settings, setSettings] = useState<TikTokSettings>(post?.settings ?? emptySettings());
  const [media, setMedia] = useState({
    url: post?.mediaUrl ?? "",
    bytes: post?.mediaBytes ?? 0,
    type: post?.mediaContentType ?? "",
    name: "",
    preview: post?.mediaUrl ?? "",
  });
  const [durationSec, setDurationSec] = useState<number | null>(null);
  const [upload, setUpload] = useState<{ pct: number; error: string | null } | null>(null);
  const [mode, setMode] = useState<"now" | "schedule">(initialMode === "schedule" || post?.status === "SCHEDULED" ? "schedule" : "now");
  const [scheduledLocal, setScheduledLocal] = useState(isoToBrasiliaLocal(post?.scheduledAt));
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState<ComposerAction | null>(null);
  const [postId, setPostId] = useState<string | null>(post?.id ?? null);
  const objectUrl = useRef<string | null>(null);

  const infoData = info?.id === accountId ? info.data : null;
  const infoLoading = Boolean(accountId) && info?.id !== accountId;
  const infoFailed = Boolean(accountId) && info?.id === accountId && !info.data;

  // Detalhes do criador (privacidades, interações e duração) toda vez que a conta muda.
  useEffect(() => {
    if (!accountId) return;
    let alive = true;
    void callApi<CreatorInfo>(`/api/social-accounts/${accountId}/creator-info`).then((res) => {
      if (!alive) return;
      setInfo({ id: accountId, data: res.data });
      if (res.data) setSettings((s) => normalizeSettings(s, res.data));
    });
    return () => {
      alive = false;
    };
  }, [accountId]);

  useEffect(
    () => () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    },
    []
  );

  const patch = useCallback((next: Partial<TikTokSettings>) => {
    setSettings((s) => normalizeSettings({ ...s, ...next }, infoData));
  }, [infoData]);

  async function pickFile(file: File | undefined) {
    if (!file) return;
    setErrors([]);
    if (!isAllowedVideoType(file.type)) {
      setUpload({ pct: 0, error: t("Use an MP4, MOV or WebM video.") });
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

  async function submit(action: ComposerAction) {
    const errs = validateComposer(
      { accountId, caption, mediaUrl: media.url, mediaContentType: media.type, durationSec, settings, scheduledLocal },
      infoData,
      action
    );
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
      settings,
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

  const c = settings.commercial;
  const privacyOptions = infoData?.privacyLevelOptions ?? [];
  const allowedPrivacy = availablePrivacyOptions(privacyOptions, c.enabled && c.brandedContent);
  const tooLong = infoData != null && durationSec != null && durationSec > infoData.maxVideoPostDurationSec;
  const disclosure = disclosureKind(c);
  const nowLocal = isoToBrasiliaLocal(new Date().toISOString());
  const uploading = Boolean(upload && !upload.error);

  return (
    <section aria-label={post ? t("Edit post") : t("New post")} className="panel space-y-5 rounded-xl border border-border p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{post ? t("Edit post") : t("New post")}</h2>
        <button type="button" onClick={onClose} className={btnSecondary}>
          {t("Close")}
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        {/* Vídeo e conta */}
        <div className="space-y-3">
          <span className={label}>{t("Video")}</span>
          <div className="mx-auto w-full max-w-[260px] overflow-hidden rounded-xl border border-border bg-surface-hover">
            {media.preview ? (
              <video
                key={media.preview}
                src={media.preview}
                controls
                playsInline
                preload="metadata"
                onLoadedMetadata={(e) => setDurationSec(e.currentTarget.duration)}
                className="aspect-[9/16] w-full bg-black object-contain"
              />
            ) : (
              <div className="flex aspect-[9/16] w-full items-center justify-center p-4 text-center text-sm text-muted">
                {t("Your video preview shows here.")}
              </div>
            )}
          </div>
          <label className={`${btnSecondary} w-full cursor-pointer`}>
            {media.preview ? t("Change video") : t("Choose video")}
            <input
              type="file"
              accept="video/mp4,video/quicktime,video/webm"
              className="sr-only"
              disabled={uploading}
              onChange={(e) => {
                void pickFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
          {media.name && (
            <p className="break-all text-xs text-muted">
              {media.name} · {formatBytes(media.bytes)}
            </p>
          )}
          {upload && !upload.error && (
            <div>
              <div className="h-2 overflow-hidden rounded-full bg-surface-hover" role="progressbar" aria-valuenow={upload.pct} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full bg-accent transition-all" style={{ width: `${upload.pct}%` }} />
              </div>
              <p className="mt-1 text-xs text-muted">{t("Uploading {n}%", { n: upload.pct })}</p>
            </div>
          )}
          {upload?.error && <p className="rounded-lg bg-error/10 px-3 py-2 text-xs text-error">{upload.error}</p>}
          {media.url && !upload && <p className="text-xs text-success">{t("Video uploaded")}</p>}
        </div>

        {/* Campos */}
        <div className="min-w-0 space-y-5">
          <label className="flex flex-col gap-2 text-sm">
            <span className={label}>{t("TikTok account")}</span>
            <select
              value={accountId}
              disabled={Boolean(post?.status === "SCHEDULED" || postId)}
              onChange={(e) => setAccountId(e.target.value)}
              className={field}
            >
              <option value="">{t("Choose an account")}</option>
              {active.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.displayName}
                  {a.username ? ` (@${a.username})` : ""}
                </option>
              ))}
            </select>
            {active.length === 0 && <span className="text-xs text-warning">{t("Connect a TikTok account first.")}</span>}
          </label>

          {accountId && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl bg-surface-hover px-4 py-3">
              {infoLoading && <span className="text-sm text-muted">{t("Loading account details...")}</span>}
              {infoFailed && <span className="text-sm text-error">{t("Could not load the account details. Reconnect the account and try again.")}</span>}
              {infoData && (
                <>
                  <Avatar url={infoData.avatarUrl} name={infoData.nickname} size={36} />
                  <div className="min-w-[10rem] flex-1">
                    <p className="text-xs text-muted">{t("Posting as")}</p>
                    <p className="break-words text-sm font-semibold">
                      {infoData.nickname}
                      {infoData.username ? <span className="font-normal text-muted"> @{infoData.username}</span> : null}
                    </p>
                  </div>
                  <p className="w-full text-xs text-muted sm:w-auto">
                    {t("Maximum video length: {time}", {
                      time:
                        infoData.maxVideoPostDurationSec >= 60
                          ? t("{n} min", { n: Math.round(infoData.maxVideoPostDurationSec / 60) })
                          : t("{n} s", { n: infoData.maxVideoPostDurationSec }),
                    })}
                  </p>
                </>
              )}
            </div>
          )}
          {tooLong && infoData && (
            <p role="alert" className="rounded-xl bg-error/10 px-4 py-2.5 text-sm text-error">
              {t("This video has {n} s and this account accepts up to {max} s. Choose a shorter video.", {
                n: Math.round(durationSec ?? 0),
                max: infoData.maxVideoPostDurationSec,
              })}
            </p>
          )}

          <label className="flex flex-col gap-2 text-sm">
            <span className={label}>{t("Caption")}</span>
            <textarea
              value={caption}
              maxLength={CAPTION_MAX}
              rows={4}
              onChange={(e) => setCaption(e.target.value)}
              placeholder={t("Write the caption of the video")}
              className={field}
            />
            <span className="self-end text-xs text-muted">
              {caption.length}/{CAPTION_MAX}
            </span>
          </label>

          <div className="flex flex-col gap-2 text-sm">
            <label htmlFor="tt-privacy" className={label}>
              {t("Who can see this video")}
            </label>
            <select
              id="tt-privacy"
              value={settings.privacyLevel}
              disabled={!infoData}
              onChange={(e) => patch({ privacyLevel: e.target.value })}
              className={field}
            >
              <option value="">{t("Choose who can see it")}</option>
              {privacyOptions.map((o) => (
                <option key={o} value={o} disabled={!allowedPrivacy.includes(o)}>
                  {t(PRIVACY_LABELS[o] ?? o)}
                </option>
              ))}
            </select>
            {c.enabled && c.brandedContent && privacyOptions.includes("SELF_ONLY") && (
              <span className="text-xs text-warning">{t("Branded content can't be private, so Only me is not available.")}</span>
            )}
            <span className="text-xs text-muted">{t("Accounts not yet audited by TikTok can only post as Only me.")}</span>
          </div>

          <fieldset className="space-y-2">
            <legend className={label}>{t("Allow people to")}</legend>
            {(
              [
                ["allowComment", "Comment", infoData?.commentDisabled],
                ["allowDuet", "Duet", infoData?.duetDisabled],
                ["allowStitch", "Stitch", infoData?.stitchDisabled],
              ] as const
            ).map(([key, name, off]) => (
              <label key={key} className={`flex items-start gap-3 text-sm ${off ? "opacity-60" : ""}`}>
                <input
                  type="checkbox"
                  checked={settings[key]}
                  disabled={Boolean(off)}
                  onChange={(e) => patch({ [key]: e.target.checked })}
                  className="mt-0.5 h-4 w-4 accent-accent"
                />
                <span>
                  {t(name)}
                  {off && <span className="block text-xs text-muted">{t("Turned off in your TikTok settings.")}</span>}
                </span>
              </label>
            ))}
          </fieldset>

          <div className="space-y-2">
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={c.enabled}
                onChange={(e) => patch({ commercial: { enabled: e.target.checked, yourBrand: false, brandedContent: false } })}
                className="mt-0.5 h-4 w-4 accent-accent"
              />
              <span>
                <span className="font-semibold">{t("Disclose commercial content")}</span>
                <span className="block text-xs text-muted">{t("Turn on if this video promotes a brand, product or service.")}</span>
              </span>
            </label>
            {c.enabled && (
              <div className="ml-7 space-y-2 rounded-xl border border-border p-3">
                <label className="flex items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={c.yourBrand}
                    onChange={(e) => patch({ commercial: { ...c, yourBrand: e.target.checked } })}
                    className="mt-0.5 h-4 w-4 accent-accent"
                  />
                  <span>
                    {t("Your brand")}
                    <span className="block text-xs text-muted">{t("You are promoting yourself or your own business.")}</span>
                  </span>
                </label>
                <label className="flex items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={c.brandedContent}
                    onChange={(e) => patch({ commercial: { ...c, brandedContent: e.target.checked } })}
                    className="mt-0.5 h-4 w-4 accent-accent"
                  />
                  <span>
                    {t("Branded content")}
                    <span className="block text-xs text-muted">{t("You are promoting another brand or a third party.")}</span>
                  </span>
                </label>
                {!c.yourBrand && !c.brandedContent && (
                  <p className="text-xs text-warning">{t("Pick at least one option to continue.")}</p>
                )}
              </div>
            )}
          </div>

          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={settings.isAigc}
              onChange={(e) => patch({ isAigc: e.target.checked })}
              className="mt-0.5 h-4 w-4 accent-accent"
            />
            <span>
              <span className="font-semibold">{t("AI-generated content")}</span>
              <span className="block text-xs text-muted">{t("Turn on if the video was made or changed with AI.")}</span>
            </span>
          </label>

          <fieldset className="space-y-2">
            <legend className={label}>{t("When")}</legend>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="radio" name="tt-when" checked={mode === "now"} onChange={() => setMode("now")} className="h-4 w-4 accent-accent" />
                {t("Publish now")}
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="tt-when" checked={mode === "schedule"} onChange={() => setMode("schedule")} className="h-4 w-4 accent-accent" />
                {t("Schedule")}
              </label>
            </div>
            {mode === "schedule" && (
              <label className="flex max-w-xs flex-col gap-1 text-sm">
                <input
                  type="datetime-local"
                  value={scheduledLocal}
                  min={nowLocal}
                  onChange={(e) => setScheduledLocal(e.target.value)}
                  className={field}
                />
                <span className="text-xs text-muted">{t("Time in Brasília")}</span>
              </label>
            )}
          </fieldset>

          <p className="text-xs text-muted">
            {t("By posting, you agree to the")}{" "}
            {disclosure === "branded" ? (
              <>
                <a href={BC_POLICY} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent hover:underline">
                  {t("TikTok Branded Content Policy")}
                </a>{" "}
                {t("and the")}{" "}
              </>
            ) : null}
            <a href={MUSIC_POLICY} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent hover:underline">
              {t("TikTok Music Usage Confirmation")}
            </a>
          </p>

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
