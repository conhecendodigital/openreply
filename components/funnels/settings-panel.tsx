"use client";

/**
 * Etapa 6 (Quiz): settings of the funnel (they live inside the draft and go
 * live together on Publish): look, logo, default checkout, Meta Pixel,
 * SEO, privacy and consent text. Data the owner only has later (Pixel id,
 * checkout link) are optional: empty simply means "off".
 */

import { useEffect, useId, useRef } from "react";
import { useT } from "@/components/lang-provider";
import { DEFAULT_CONSENT_TEXT, DEFAULT_THEME } from "@/lib/funnels/schema";
import { contrastRatio } from "@/lib/funnels/validate";
import { isAllowedImageUrl, isHttpsUrl, isLocalPath } from "@/lib/funnels/media";
import type { FunnelDefinition, FunnelSettings, FunnelTheme } from "@/lib/funnels/types";
import { updateSettings } from "@/components/funnels/editor-model";
import { CheckField, FieldShell, SelectField, TextField, inputClass } from "@/components/funnels/form-controls";

type SetDef = (update: (d: FunnelDefinition) => FunnelDefinition) => void;

const HEX = /^#[0-9a-fA-F]{6}$/;
const DARK_THEME: FunnelTheme = { mode: "dark", primary: "#0095f6", background: "#000000", text: "#ffffff", radius: "lg" };

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const id = useId();
  const ok = HEX.test(value);
  return (
    <FieldShell label={label} htmlFor={id} error={ok ? null : "#RRGGBB"}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={label}
          value={ok ? value : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="h-11 w-12 shrink-0 cursor-pointer rounded-lg border border-border bg-background p-1"
        />
        <input id={id} value={value} maxLength={7} onChange={(e) => onChange(e.target.value.trim())} className={`${inputClass} font-mono`} />
      </div>
    </FieldShell>
  );
}

export default function SettingsPanel({ def, setDef, onClose }: { def: FunnelDefinition; setDef: SetDef; onClose: () => void }) {
  const t = useT();
  const s = def.settings;
  const theme = s.theme;
  const set = (patch: Partial<FunnelSettings>) => setDef((d) => updateSettings(d, patch));
  const setTheme = (patch: Partial<FunnelTheme>) => setDef((d) => updateSettings(d, { theme: { ...d.settings.theme, ...patch } }));
  const opt = (v: string) => (v.trim() ? v : undefined);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCloseRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const textContrast = HEX.test(theme.text) && HEX.test(theme.background) ? contrastRatio(theme.text, theme.background) : 0;
  const buttonContrast = HEX.test(theme.primary) ? Math.max(contrastRatio("#ffffff", theme.primary), contrastRatio("#000000", theme.primary)) : 0;
  const lowContrast = textContrast < 4.5 || buttonContrast < 3;

  const urlError = (v: string | undefined, check: (x: string) => boolean) => (v && v.trim() && !check(v.trim()) ? t("Use a link that starts with https://") : null);
  const privacyOk = (v: string) => isLocalPath(v) || isHttpsUrl(v);
  const pixelBad = Boolean(s.pixelId) && !/^\d{5,20}$/.test(s.pixelId ?? "");

  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-black/40" role="dialog" aria-modal="true" aria-labelledby="funnel-settings-title" onClick={onClose}>
      <div className="flex h-full w-full max-w-lg flex-col bg-background shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3" style={{ paddingTop: "calc(0.75rem + env(safe-area-inset-top))" }}>
          <h2 id="funnel-settings-title" className="text-base font-semibold">
            {t("Quiz settings")}
          </h2>
          <button ref={closeRef} type="button" onClick={onClose} className="min-h-11 rounded-lg px-3 text-sm font-semibold hover:bg-surface-hover">
            {t("Done")}
          </button>
        </div>
        <div className="flex-1 space-y-8 overflow-y-auto px-4 py-5" style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}>
          <p className="text-xs text-muted">{t("Settings go live together with the screens when you publish.")}</p>

          <section className="space-y-4">
            <h3 className="text-sm font-semibold">{t("Look")}</h3>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setTheme({ ...DEFAULT_THEME })} className="min-h-11 rounded-lg border border-border px-3 text-sm font-semibold hover:bg-surface-hover">
                {t("Light (like Instagram)")}
              </button>
              <button type="button" onClick={() => setTheme({ ...DARK_THEME })} className="min-h-11 rounded-lg border border-border px-3 text-sm font-semibold hover:bg-surface-hover">
                {t("Dark")}
              </button>
            </div>
            <SelectField
              label={t("Mode")}
              value={theme.mode}
              onChange={(v) => setTheme({ mode: v })}
              options={[
                { value: "light", label: t("Light") },
                { value: "dark", label: t("Dark") },
              ]}
            />
            <div className="grid gap-3 sm:grid-cols-3">
              <ColorField label={t("Button color")} value={theme.primary} onChange={(v) => setTheme({ primary: v })} />
              <ColorField label={t("Background")} value={theme.background} onChange={(v) => setTheme({ background: v })} />
              <ColorField label={t("Text")} value={theme.text} onChange={(v) => setTheme({ text: v })} />
            </div>
            <SelectField
              label={t("Corners")}
              value={theme.radius ?? "lg"}
              onChange={(v) => setTheme({ radius: v })}
              options={[
                { value: "sm", label: t("Small") },
                { value: "md", label: t("Medium") },
                { value: "lg", label: t("Large") },
              ]}
            />
            {lowContrast && (
              <p role="alert" className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-[#8a560c]">
                {t("Hard to read: text {a}:1 (minimum 4.5) and button {b}:1 (minimum 3). Pick stronger colors.", {
                  a: textContrast.toFixed(1),
                  b: buttonContrast.toFixed(1),
                })}
              </p>
            )}
            <TextField
              label={t("Logo link (optional)")}
              value={s.logoUrl ?? ""}
              type="url"
              placeholder="https://"
              onChange={(v) => set({ logoUrl: opt(v) })}
              error={urlError(s.logoUrl, isAllowedImageUrl)}
              hint={t("Shows on screens with \"Logo\" turned on.")}
            />
          </section>

          <section className="space-y-4">
            <h3 className="text-sm font-semibold">{t("Checkout")}</h3>
            <TextField
              label={t("Default checkout link")}
              value={s.checkoutUrl ?? ""}
              type="url"
              placeholder="https://pay.hotmart.com/..."
              onChange={(v) => set({ checkoutUrl: opt(v) })}
              error={urlError(s.checkoutUrl, isHttpsUrl)}
              hint={t("Used by checkout buttons without their own link. The entry UTMs, fbclid, src and sck go along, plus the visit id for Hotmart.")}
            />
          </section>

          <section className="space-y-4">
            <h3 className="text-sm font-semibold">{t("Meta Pixel")}</h3>
            <TextField
              label={t("Pixel ID (optional)")}
              value={s.pixelId ?? ""}
              inputMode="numeric"
              maxLength={20}
              placeholder="123456789012345"
              onChange={(v) => set({ pixelId: opt(v.replace(/\s/g, "")) })}
              error={pixelBad ? t("Only digits (5 to 20).") : null}
              hint={t("Empty = uses the account Pixel (Settings, Pixel and Conversions API). Without one there either, no Pixel and no cookie notice. Only the number: the script is ours.")}
            />
            <SelectField
              label={t("Cookie notice")}
              value={s.pixelConsent ?? "banner"}
              onChange={(v) => set({ pixelConsent: v })}
              options={[
                { value: "banner", label: t("Ask first (Pixel only after Accept)") },
                { value: "notice", label: t("Only inform (Pixel loads right away)") },
              ]}
              hint={t("Asking first is the safest choice for LGPD.")}
            />
            <CheckField
              label={t("Event per screen")}
              hint={t("Sends QuizStep with the screen number to the Pixel.")}
              checked={Boolean(s.pixelStepEvents)}
              onChange={(v) => set({ pixelStepEvents: v || undefined })}
            />
          </section>

          <section className="space-y-4">
            <h3 className="text-sm font-semibold">{t("Search and sharing")}</h3>
            <TextField label={t("Page title")} value={s.seo?.title ?? ""} maxLength={120} onChange={(v) => set({ seo: { ...s.seo, title: opt(v) } })} />
            <TextField
              label={t("Description")}
              value={s.seo?.description ?? ""}
              multiline
              rows={2}
              maxLength={300}
              onChange={(v) => set({ seo: { ...s.seo, description: opt(v) } })}
            />
            <TextField
              label={t("Sharing image link")}
              value={s.seo?.imageUrl ?? ""}
              type="url"
              placeholder="https://"
              onChange={(v) => set({ seo: { ...s.seo, imageUrl: opt(v) } })}
              error={urlError(s.seo?.imageUrl, isAllowedImageUrl)}
            />
            <CheckField
              label={t("Show on Google")}
              hint={t("Off by default: quizzes are usually only for who comes from Instagram.")}
              checked={Boolean(s.seo?.indexable)}
              onChange={(v) => set({ seo: { ...s.seo, indexable: v || undefined } })}
            />
          </section>

          <section className="space-y-4">
            <h3 className="text-sm font-semibold">{t("Privacy")}</h3>
            <TextField
              label={t("Privacy policy link")}
              value={s.privacyUrl ?? ""}
              placeholder="/privacy"
              onChange={(v) => set({ privacyUrl: opt(v) })}
              error={s.privacyUrl && !privacyOk(s.privacyUrl.trim()) ? t("Use /path or an https:// link.") : null}
              hint={t("Empty = /privacy of this site.")}
            />
            <TextField
              label={t("Consent text (screens with data fields)")}
              value={s.consentText ?? ""}
              multiline
              rows={2}
              maxLength={500}
              placeholder={DEFAULT_CONSENT_TEXT}
              onChange={(v) => set({ consentText: opt(v) })}
            />
            <TextField
              label={t("Footer text (optional)")}
              value={s.footerText ?? ""}
              multiline
              rows={2}
              maxLength={500}
              placeholder={t("ex.: Payment processed by Hotmart.")}
              onChange={(v) => set({ footerText: opt(v) })}
            />
          </section>
        </div>
      </div>
    </div>
  );
}
