"use client";

/**
 * Opções do TikTok (Direct Post). Segue as regras de UX do TikTok: nome da conta,
 * privacidade SEM valor padrão (só as opções que o TikTok devolve), comentários/duet/stitch
 * desligados por padrão, aviso de conteúdo comercial, declaração de uso de música e
 * duração máxima. Nada mudou em relação à versão que só tinha TikTok.
 */

import { useT } from "@/components/lang-provider";
import { Avatar } from "@/components/posts/accounts-bar";
import { fieldClass, labelClass } from "@/components/posts/styles";
import { availablePrivacyOptions, privacyLabel, disclosureKind, type CreatorInfo, type TikTokSettings } from "@/lib/tiktok-composer";

const BC_POLICY = "https://www.tiktok.com/legal/page/global/bc-policy/en";
const MUSIC_POLICY = "https://www.tiktok.com/legal/page/global/music-usage-confirmation/en";

/** Quem posta, duração máxima e o aviso de vídeo longo demais. */
export function TikTokTop({
  accountId,
  info,
  loading,
  failed,
  durationSec,
}: {
  accountId: string;
  info: CreatorInfo | null;
  loading: boolean;
  failed: boolean;
  durationSec: number | null;
}) {
  const t = useT();
  const tooLong = info != null && durationSec != null && durationSec > info.maxVideoPostDurationSec;
  return (
    <>
      {accountId && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-surface-hover px-4 py-3">
          {loading && <span className="text-sm text-muted">{t("Loading account details...")}</span>}
          {failed && <span className="text-sm text-error">{t("Could not load the account details. Reconnect the account and try again.")}</span>}
          {info && (
            <>
              <Avatar url={info.avatarUrl} name={info.nickname} size={36} />
              <div className="min-w-[10rem] flex-1">
                <p className="text-xs text-muted">{t("Posting as")}</p>
                <p className="break-words text-sm font-semibold">
                  {info.nickname}
                  {info.username ? <span className="font-normal text-muted"> @{info.username}</span> : null}
                </p>
              </div>
              <p className="w-full text-xs text-muted sm:w-auto">
                {t("Maximum video length: {time}", {
                  time:
                    info.maxVideoPostDurationSec >= 60
                      ? t("{n} min", { n: Math.round(info.maxVideoPostDurationSec / 60) })
                      : t("{n} s", { n: info.maxVideoPostDurationSec }),
                })}
              </p>
            </>
          )}
        </div>
      )}
      {tooLong && info && (
        <p role="alert" className="rounded-xl bg-error/10 px-4 py-2.5 text-sm text-error">
          {t("This video has {n} s and this account accepts up to {max} s. Choose a shorter video.", {
            n: Math.round(durationSec ?? 0),
            max: info.maxVideoPostDurationSec,
          })}
        </p>
      )}
    </>
  );
}

/** Privacidade, interações, conteúdo comercial e IA. */
export function TikTokFields({
  settings,
  info,
  patch,
}: {
  settings: TikTokSettings;
  info: CreatorInfo | null;
  patch: (next: Partial<TikTokSettings>) => void;
}) {
  const t = useT();
  const c = settings.commercial;
  const viaZernio = info?.via === "zernio";
  const privacyOptions = info?.privacyLevelOptions ?? [];
  const allowedPrivacy = availablePrivacyOptions(privacyOptions, c.enabled && c.brandedContent);
  return (
    <>
      <div className="flex flex-col gap-2 text-sm">
        <label htmlFor="tt-privacy" className={labelClass}>
          {t("Who can see this video")}
        </label>
        <select id="tt-privacy" value={settings.privacyLevel} disabled={!info} onChange={(e) => patch({ privacyLevel: e.target.value })} className={fieldClass}>
          <option value="">{t("Choose who can see it")}</option>
          {privacyOptions.map((o) => (
            <option key={o} value={o} disabled={!allowedPrivacy.includes(o)}>
              {t(privacyLabel(o, info))}
            </option>
          ))}
        </select>
        {c.enabled && c.brandedContent && privacyOptions.includes("SELF_ONLY") && (
          <span className="text-xs text-warning">{t("Branded content can't be private, so Only me is not available.")}</span>
        )}
        {viaZernio ? (
          <span className="text-xs text-muted">
            {t("Posting through Zernio: the video goes out Public, or as a draft in the TikTok app, where you choose the audience. In a draft, the caption does not come along.")}
          </span>
        ) : (
          <span className="text-xs text-muted">{t("Accounts not yet audited by TikTok can only post as Only me.")}</span>
        )}
      </div>

      <fieldset className="space-y-2">
        <legend className={labelClass}>{t("Allow people to")}</legend>
        {(
          [
            ["allowComment", "Comment", info?.commentDisabled],
            ["allowDuet", "Duet", info?.duetDisabled],
            ["allowStitch", "Stitch", info?.stitchDisabled],
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

      {!viaZernio && (
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
            {!c.yourBrand && !c.brandedContent && <p className="text-xs text-warning">{t("Pick at least one option to continue.")}</p>}
          </div>
        )}
      </div>
      )}

      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" checked={settings.isAigc} onChange={(e) => patch({ isAigc: e.target.checked })} className="mt-0.5 h-4 w-4 accent-accent" />
        <span>
          <span className="font-semibold">{t("AI-generated content")}</span>
          <span className="block text-xs text-muted">{t("Turn on if the video was made or changed with AI.")}</span>
        </span>
      </label>
    </>
  );
}

/** Declaração perto dos botões (política de conteúdo de marca + música). */
export function TikTokFooter({ settings }: { settings: TikTokSettings }) {
  const t = useT();
  const disclosure = disclosureKind(settings.commercial);
  return (
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
  );
}
