"use client";

/**
 * Etapa 6 (Quiz): the player. The public page (/q/<slug>), the full screen
 * draft preview (?preview=1) and the phone preview of the editor all use it.
 *
 *  - One screen at a time, the URL does not change. Short fade (200 ms, only
 *    opacity/transform, off with prefers-reduced-motion), scroll to the top
 *    and focus on the screen title, announced politely.
 *  - Single choice moves on by itself ~250 ms after the tap; multiple choice
 *    has a Continue button. Back keeps the answers.
 *  - Checkout: buildCheckoutUrl adds the entry UTMs/fbclid/src/sck and the
 *    xcod (visitor id) for Hotmart. Only "live" records events, loads the
 *    Pixel or leaves to the checkout; "preview" and "editor" never do.
 *  - Funnel text goes through parseRichText/interpolate. No HTML, ever.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useT } from "@/components/lang-provider";
import { answerLabels, nextStepId, progressPct, type Answers } from "@/lib/funnels/navigation";
import { buildCheckoutUrl } from "@/lib/funnels/checkout";
import type {
  FunnelAdSignals,
  FunnelDefinition,
  FunnelOption,
  LeadField,
  OptionsBlock,
  PublicBlock,
  PublicFunnel,
  PublicStep,
  TrackingParams,
} from "@/lib/funnels/types";
import { RADIUS_PX, type PlayerCtx, type PlayerMode, type PublicButtonBlock } from "@/components/funnels/blocks/shared";
import HeadingView from "@/components/funnels/blocks/heading";
import TextView from "@/components/funnels/blocks/text";
import ImageView from "@/components/funnels/blocks/image";
import VideoView from "@/components/funnels/blocks/video";
import ButtonView from "@/components/funnels/blocks/button";
import OptionsView from "@/components/funnels/blocks/options";
import FieldView from "@/components/funnels/blocks/field";
import CompareView from "@/components/funnels/blocks/compare";
import TestimonialView from "@/components/funnels/blocks/testimonial";
import ChecklistView from "@/components/funnels/blocks/checklist";
import CountdownView from "@/components/funnels/blocks/countdown";
import LoadingView from "@/components/funnels/blocks/loading";
import OfferView from "@/components/funnels/blocks/offer";
import GalleryView from "@/components/funnels/blocks/gallery";
import FaqView from "@/components/funnels/blocks/faq";
import SpacerView from "@/components/funnels/blocks/spacer";
import ConsentBanner from "@/components/funnels/consent-banner";
import {
  getVisitorId,
  loadPixel,
  newEventId,
  readPixelCookies,
  pixelCustom,
  pixelTrack,
  readConsent,
  saveConsent,
  sendFunnelEvent,
  submitFunnelLead,
  type ConsentChoice,
} from "@/components/funnels/player-tracking";

export type FunnelPlayerProps = {
  funnel: PublicFunnel;
  mode: PlayerMode;
  entryParams?: TrackingParams;
  contactToken?: string | null;
  initialStepId?: string;
  onStepChange?: (stepId: string) => void;
};

const SINGLE_CHOICE_DELAY_MS = 250;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// ─── Colors ─────────────────────────────────────────────────────────────────

function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 1;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

export function contrastRatio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/**
 * Text color on the main color: white while it keeps 3:1 (the same line the
 * editor check uses for buttons, and the Instagram look), black otherwise.
 */
export function onColor(hex: string): string {
  return contrastRatio(hex, "#ffffff") >= 3 ? "#ffffff" : "#000000";
}

const PLAYER_CSS = `
@keyframes fq-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.fq-in{animation:fq-in 200ms ease-out both}
@keyframes fq-fill{from{transform:scaleX(0)}to{transform:scaleX(1)}}
.fq-fill{animation-name:fq-fill;animation-timing-function:linear;animation-fill-mode:both}
@keyframes fq-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.03)}}
.fq-pulse{animation:fq-pulse 1.6s ease-in-out infinite}
.fq-press{transition:transform 120ms ease-out}
.fq-press:active{transform:scale(.98)}
.fq-root :focus-visible{outline:2px solid var(--fq-primary);outline-offset:2px}
.fq-root h1:focus,.fq-root h2:focus{outline:none}
@media (prefers-reduced-motion: reduce){.fq-in,.fq-pulse{animation:none}.fq-press,.fq-press:active{transition:none;transform:none}.fq-fill{animation-duration:.01ms!important}}
`;

const subscribeNothing = () => () => {};

// ─── Player ─────────────────────────────────────────────────────────────────

export default function FunnelPlayer({ funnel, mode, entryParams, contactToken, initialStepId, onStepChange }: FunnelPlayerProps) {
  const t = useT();
  const live = mode === "live";
  const mounted = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const steps = funnel.steps;
  const def = useMemo(
    () => ({ schemaVersion: 1, settings: funnel.settings, steps: funnel.steps }) as FunnelDefinition,
    [funnel.settings, funnel.steps]
  );
  const firstId = steps[0]?.id ?? "";
  const startId = initialStepId && steps.some((s) => s.id === initialStepId) ? initialStepId : firstId;

  const [history, setHistory] = useState<string[]>([startId]);
  const [anchor, setAnchor] = useState(initialStepId);
  const lastInHistory = history[history.length - 1];
  const step: PublicStep | undefined = steps.find((s) => s.id === lastInHistory) ?? steps[0];
  const currentId = step?.id ?? "";

  // The editor picked another screen: show it (the back stack starts over there).
  if (initialStepId !== anchor) {
    setAnchor(initialStepId);
    if (initialStepId && initialStepId !== currentId && steps.some((s) => s.id === initialStepId)) setHistory([initialStepId]);
  }

  const [answers, setAnswers] = useState<Answers>({});
  const [pendingOptionId, setPendingOptionId] = useState<string | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [fields, setFields] = useState<Partial<Record<LeadField, string>>>({});
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<LeadField, string>>>({});
  const [consent, setConsent] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [honeypot, setHoneypot] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const [consentPick, setConsentPick] = useState<ConsentChoice | null>(null);

  const labels = useMemo(() => answerLabels(def, answers), [def, answers]);
  const index = Math.max(0, steps.findIndex((s) => s.id === currentId));
  const blocks: PublicBlock[] = useMemo(() => step?.blocks ?? [], [step]);
  const hasFields = blocks.some((b) => b.type === "field");
  const needsTick = blocks.some((b) => (b.delaySec ?? 0) > 0 || b.type === "countdown");

  // ── Clock: block delays and countdowns, restarted on every screen ────────
  const [clock, setClock] = useState<{ stepId: string; enteredAt: number; now: number } | null>(null);
  useEffect(() => {
    const start = Date.now();
    const first = window.setTimeout(() => setClock({ stepId: currentId, enteredAt: start, now: Date.now() }), 0);
    const timer = needsTick
      ? window.setInterval(
          () => setClock((c) => ({ stepId: currentId, enteredAt: c && c.stepId === currentId ? c.enteredAt : start, now: Date.now() })),
          500
        )
      : 0;
    return () => {
      window.clearTimeout(first);
      if (timer) window.clearInterval(timer);
    };
  }, [currentId, needsTick]);
  const elapsedMs = clock && clock.stepId === currentId ? clock.now - clock.enteredAt : -1;
  const isVisible = (b: PublicBlock) => mode === "editor" || !b.delaySec || elapsedMs >= b.delaySec * 1000;

  // ── Pixel and consent (live only) ────────────────────────────────────────
  const pixelId = live && funnel.settings.pixelId && /^\d{5,20}$/.test(funnel.settings.pixelId) ? funnel.settings.pixelId : null;
  const consentMode = funnel.settings.pixelConsent ?? "banner";
  const storedConsent = mounted && pixelId ? readConsent() : null;
  const consentChoice = consentPick ?? storedConsent;
  const pixelAllowed = Boolean(pixelId) && (consentMode === "notice" || consentMode === "off" || consentChoice === "accepted");
  // "off": no notice at all; the privacy policy stays linked in the page footer.
  const showBanner = Boolean(pixelId) && mounted && consentMode !== "off" && consentChoice === null;

  // LGPD: the signed contact token (?c=) already reached the server; take it
  // out of the address bar so the Pixel (which reads the page URL), a shared
  // link or a screenshot never carries who the visitor is.
  useEffect(() => {
    if (!live || typeof window === "undefined") return;
    try {
      const url = new URL(window.location.href);
      if (!url.searchParams.has("c")) return;
      url.searchParams.delete("c");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    } catch {
      // Old browser: keep the address as it is.
    }
  }, [live]);

  useEffect(() => {
    if (pixelAllowed && pixelId) loadPixel(pixelId);
  }, [pixelAllowed, pixelId]);

  // What the server needs for the Conversions API copy of the events: the
  // cookie notice choice (no choice = nothing goes) and the Pixel cookies.
  const adSignals = (): FunnelAdSignals => {
    if (!pixelId) return {};
    const adConsent = consentChoice === "accepted" ? "accepted" : consentChoice === "declined" ? "declined" : undefined;
    return { ...(adConsent ? { adConsent } : {}), ...(pixelAllowed ? readPixelCookies() : {}) };
  };

  const visitorId = useMemo(() => (live && mounted ? getVisitorId(funnel.id) : ""), [live, mounted, funnel.id]);

  // ── Each screen: record the view, scroll up, move the focus ─────────────
  const rootRef = useRef<HTMLDivElement>(null);
  const firstViewSent = useRef(false);
  const shownScreen = useRef<string | null>(null);
  useEffect(() => {
    if (!currentId) return;
    if (live && visitorId) {
      const isFirst = !firstViewSent.current;
      firstViewSent.current = true;
      sendFunnelEvent(funnel.slug, {
        visitorId,
        version: funnel.version,
        type: "view",
        stepId: currentId,
        ...adSignals(),
        ...(isFirst
          ? {
              tracking: entryParams,
              contactToken: contactToken ?? undefined,
              referrer: document.referrer ? document.referrer.slice(0, 500) : undefined,
            }
          : {}),
      });
      if (index === steps.length - 1) sendFunnelEvent(funnel.slug, { visitorId, version: funnel.version, type: "complete", stepId: currentId });
      if (blocks.some((b) => b.type === "offer")) pixelTrack("ViewContent");
      if (funnel.settings.pixelStepEvents) pixelCustom("QuizStep", { step: index + 1 });
    }
    // Scroll and focus only when the screen really changed (not on load).
    const changed = shownScreen.current !== null && shownScreen.current !== currentId;
    shownScreen.current = currentId;
    if (!changed) return;
    const root = rootRef.current;
    if (!root) return;
    if (mode === "editor") {
      root.closest("[data-fq-scroll]")?.scrollTo({ top: 0 });
      return;
    }
    window.scrollTo({ top: 0 });
    const title = root.querySelector<HTMLElement>("[data-fq-title]") ?? root.querySelector<HTMLElement>("[data-fq-screen]");
    title?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per screen; the rest is read at that moment
  }, [currentId, visitorId]);

  // ── Navigation ───────────────────────────────────────────────────────────
  const resetScreen = () => {
    setPendingOptionId(null);
    setOptionsError(null);
    setFieldErrors({});
    setConsentError(null);
    setNotice(null);
  };

  const goTo = (next: string | null) => {
    if (!next || !steps.some((s) => s.id === next)) return;
    resetScreen();
    setHistory((h) => [...h, next]);
    onStepChange?.(next);
  };

  const goBack = () => {
    if (history.length < 2) return;
    const prev = history[history.length - 2];
    resetScreen();
    setHistory((h) => h.slice(0, -1));
    onStepChange?.(prev);
  };

  const track = (type: "answer" | "checkout", extra: { blockId?: string; optionIds?: string[]; eventId?: string } = {}) => {
    if (!live || !visitorId) return;
    sendFunnelEvent(funnel.slug, { visitorId, version: funnel.version, type, stepId: currentId, ...adSignals(), ...extra });
  };

  const optionsOf = (): OptionsBlock | undefined => blocks.find((b): b is OptionsBlock => b.type === "options");

  function validateFields(): boolean {
    const errors: Partial<Record<LeadField, string>> = {};
    for (const b of blocks) {
      if (b.type !== "field") continue;
      const value = (fields[b.field] ?? "").trim();
      const required = b.required !== false;
      if (!value) {
        if (required) errors[b.field] = t("Fill in this field to continue.");
        continue;
      }
      if (b.field === "email" && !EMAIL_RE.test(value)) errors[b.field] = t("Type a valid email, like name@email.com.");
      if (b.field === "whatsapp") {
        const digits = value.replace(/\D/g, "");
        if (digits.length < 10 || digits.length > 13) errors[b.field] = t("Type your WhatsApp with the area code, numbers only.");
      }
      if (b.field === "name" && (value.length < 2 || value.length > 80)) errors[b.field] = t("Type your name.");
    }
    setFieldErrors(errors);
    const consentOk = consent;
    setConsentError(consentOk ? null : t("Tick the box to continue."));
    return Object.keys(errors).length === 0 && consentOk;
  }

  async function sendLead(): Promise<boolean> {
    if (!validateFields()) return false;
    if (!live) return true;
    setBusy(true);
    const clean: Partial<Record<LeadField, string>> = {};
    for (const b of blocks) if (b.type === "field" && fields[b.field]?.trim()) clean[b.field] = fields[b.field]!.trim();
    const eventId = newEventId("lead");
    const r = await submitFunnelLead(funnel.slug, {
      ...adSignals(),
      eventId,
      visitorId,
      version: funnel.version,
      stepId: currentId,
      fields: clean,
      consent: true,
      website: honeypot,
    });
    setBusy(false);
    if (!r.ok) {
      setNotice({
        tone: "error",
        text:
          r.code === "consent_required"
            ? t("Tick the box to continue.")
            : r.code === "rate_limited"
              ? t("Too many tries in a row. Wait a moment and try again.")
              : r.code === "network"
                ? t("No connection. Try again.")
                : t("Check the fields and try again."),
      });
      return false;
    }
    pixelTrack("Lead", eventId);
    return true;
  }

  async function pressButton(block: PublicButtonBlock) {
    if (busy) return;
    const opts = optionsOf();
    if (opts && opts.required !== false && !(answers[opts.name]?.length)) {
      setOptionsError(t("Choose an option to continue."));
      return;
    }
    if (hasFields && !(await sendLead())) return;
    const action = block.action;
    if (action.kind !== "checkout") {
      goTo(nextStepId(def, currentId, { kind: "button", action }));
      return;
    }
    if (!live) {
      setNotice({ tone: "info", text: t("In the preview the button does not open the checkout.") });
      return;
    }
    const target = block.checkoutUrl ? buildCheckoutUrl(block.checkoutUrl, entryParams ?? {}, { visitorId }) : null;
    if (!target) {
      setNotice({ tone: "error", text: t("This button has no checkout link yet.") });
      return;
    }
    const eventId = newEventId("ic");
    track("checkout", { blockId: block.id, eventId });
    pixelTrack("InitiateCheckout", eventId);
    if (action.newTab) window.open(target, "_blank", "noopener");
    else window.location.assign(target);
  }

  function selectOption(block: OptionsBlock, option: FunnelOption) {
    if (pendingOptionId || busy) return;
    setPendingOptionId(option.id);
    setOptionsError(null);
    window.setTimeout(() => {
      setAnswers((a) => ({ ...a, [block.name]: [option.id] }));
      track("answer", { blockId: block.id, optionIds: [option.id] });
      setPendingOptionId(null);
      const next = nextStepId(def, currentId, { kind: "option", option });
      // A screen with lead fields waits for its own button.
      if (!hasFields) goTo(next);
    }, SINGLE_CHOICE_DELAY_MS);
  }

  function toggleOption(block: OptionsBlock, optionId: string) {
    setOptionsError(null);
    setAnswers((a) => {
      const list = a[block.name] ?? [];
      if (list.includes(optionId)) return { ...a, [block.name]: list.filter((x) => x !== optionId) };
      if (block.maxChoices && list.length >= block.maxChoices) return a;
      return { ...a, [block.name]: [...list, optionId] };
    });
  }

  function continueMultiple(block: OptionsBlock) {
    const chosen = answers[block.name] ?? [];
    const min = block.required === false ? 0 : Math.max(1, block.minChoices ?? 1);
    if (chosen.length < min) {
      setOptionsError(min <= 1 ? t("Choose an option to continue.") : t("Choose at least {n}.", { n: min }));
      return;
    }
    if (chosen.length) track("answer", { blockId: block.id, optionIds: chosen });
    goTo(nextStepId(def, currentId, { kind: "continue" }));
  }

  function loadingDone(blockId: string) {
    const block = blocks.find((b) => b.id === blockId);
    if (!block || block.type !== "loading") return;
    goTo(nextStepId(def, currentId, { kind: "loading", block, answers }));
  }

  const setField = useCallback((f: LeadField, v: string) => {
    setFields((x) => ({ ...x, [f]: v }));
    setFieldErrors((x) => (x[f] ? { ...x, [f]: undefined } : x));
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────
  const theme = funnel.settings.theme;
  const vars = {
    "--fq-primary": theme.primary,
    "--fq-on-primary": onColor(theme.primary),
    "--fq-bg": theme.background,
    "--fq-text": theme.text,
    "--fq-radius": `${RADIUS_PX[theme.radius ?? "lg"]}px`,
    "--fq-error": theme.mode === "dark" ? "#ff8a80" : "#c62828",
    background: theme.background,
    color: theme.text,
    colorScheme: theme.mode,
  } as React.CSSProperties;

  const priorityImageId = useMemo(() => steps[0]?.blocks.find((b) => b.type === "image")?.id ?? null, [steps]);
  const titleBlockId = blocks.find((b) => b.type === "heading")?.id ?? null;

  const ctx: PlayerCtx = {
    mode,
    settings: funnel.settings,
    labels,
    answers,
    now: clock?.now ?? 0,
    priorityImageId: index === 0 ? priorityImageId : null,
    pendingOptionId,
    optionsError,
    busy,
    selectOption,
    toggleOption,
    continueMultiple,
    pressButton: (b) => void pressButton(b),
    fields,
    fieldErrors,
    setField,
    loadingDone,
    titleBlockId,
  };

  const header = step?.header ?? {};
  const logoUrl = funnel.settings.logoUrl;
  const showHeader = Boolean(header.showBack || header.showProgress || (header.showLogo && logoUrl));
  const pct = currentId ? progressPct(def, currentId) : 0;
  const privacyUrl = funnel.settings.privacyUrl || "/privacy";
  const lastFieldId = [...blocks].reverse().find((b) => b.type === "field")?.id;
  const stickyButtons = blocks.filter((b): b is PublicButtonBlock => b.type === "button" && Boolean(b.sticky) && isVisible(b));
  const Main = mode === "editor" ? "div" : "main";

  const renderBlock = (b: PublicBlock): React.ReactNode => {
    switch (b.type) {
      case "heading":
        return <HeadingView block={b} ctx={ctx} />;
      case "text":
        return <TextView block={b} ctx={ctx} />;
      case "image":
        return <ImageView block={b} ctx={ctx} />;
      case "video":
        return <VideoView block={b} />;
      case "button":
        return b.sticky ? null : <ButtonView block={b} ctx={ctx} />;
      case "options":
        return <OptionsView block={b} ctx={ctx} />;
      case "field":
        return <FieldView block={b} ctx={ctx} />;
      case "compare":
        return <CompareView block={b} />;
      case "testimonial":
        return <TestimonialView block={b} />;
      case "checklist":
        return <ChecklistView block={b} ctx={ctx} />;
      case "countdown":
        return ctx.now ? <CountdownView block={b} ctx={ctx} /> : null;
      case "loading":
        return <LoadingView key={`${currentId}:${b.id}`} block={b} ctx={ctx} />;
      case "offer":
        return <OfferView block={b} />;
      case "gallery":
        return <GalleryView block={b} />;
      case "faq":
        return <FaqView block={b} ctx={ctx} />;
      case "spacer":
        return <SpacerView block={b} />;
    }
  };

  return (
    <div ref={rootRef} lang="pt-BR" className={`fq-root flex flex-col ${mode === "editor" ? "min-h-full" : "min-h-dvh"}`} style={vars}>
      <style>{PLAYER_CSS}</style>
      {mode === "preview" && (
        <p role="status" className="sticky top-0 z-20 bg-[#fff4d6] px-4 py-2 text-center text-[13px] font-semibold text-[#5c3d00]">
          {t("Preview of the draft")} · {t("Nothing here is recorded and the checkout does not open.")}
        </p>
      )}
      <div className="mx-auto flex w-full max-w-[28rem] flex-1 flex-col px-4">
        {showHeader && (
          <div className="flex min-h-14 items-center gap-3 pt-3">
            {header.showBack ? (
              <button
                type="button"
                onClick={goBack}
                disabled={history.length < 2}
                aria-label={t("Back")}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full disabled:invisible"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6">
                  <path d="M15 5 8 12l7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            ) : (
              <span className="w-11 shrink-0" />
            )}
            <div className="flex min-w-0 flex-1 flex-col items-center gap-2">
              {header.showLogo && logoUrl && !logoUrl.includes(".invalid") && (
                // eslint-disable-next-line @next/next/no-img-element -- logo comes from any https host the owner pastes
                <img src={logoUrl} alt={funnel.name} className="h-7 w-auto max-w-[10rem] object-contain" />
              )}
              {header.showProgress && (
                <div
                  role="progressbar"
                  aria-label={t("Progress")}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={pct}
                  className="h-2 w-full overflow-hidden rounded-full"
                  style={{ background: "color-mix(in srgb, var(--fq-text) 12%, transparent)" }}
                >
                  <div
                    className="h-full w-full origin-left rounded-full transition-transform duration-200 ease-out"
                    style={{ background: "var(--fq-primary)", transform: `scaleX(${pct / 100})` }}
                  />
                </div>
              )}
            </div>
            <span className="w-11 shrink-0" />
          </div>
        )}

        {mode !== "editor" && (
          <p className="sr-only" aria-live="polite">
            {t("Screen {n} of {total}", { n: index + 1, total: steps.length })}
          </p>
        )}

        {!step ? (
          <p className="py-16 text-center text-base">{t("This quiz has no screens yet.")}</p>
        ) : (
          <Main key={currentId} data-fq-screen="" tabIndex={-1} className="fq-in flex-1 space-y-5 py-6 outline-none">
            {blocks.map((b) => {
              if (!isVisible(b)) return null;
              const node = renderBlock(b);
              if (node === null) return null;
              const delayed = Boolean(b.delaySec) && mode !== "editor";
              return (
                <div key={b.id} data-block-id={b.id} className={delayed ? "fq-in" : undefined}>
                  {node}
                  {b.id === lastFieldId && (
                    <ConsentCheckbox
                      checked={consent}
                      onChange={(v) => {
                        setConsent(v);
                        if (v) setConsentError(null);
                      }}
                      text={funnel.settings.consentText || ""}
                      privacyUrl={privacyUrl}
                      error={consentError}
                    />
                  )}
                </div>
              );
            })}
            {hasFields && (
              <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", width: 1, height: 1, overflow: "hidden" }}>
                <label>
                  Website
                  <input type="text" name="website" tabIndex={-1} autoComplete="off" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
                </label>
              </div>
            )}
          </Main>
        )}

        {funnel.settings.footerText && (
          <footer className="space-y-1 pb-6 pt-2 text-center text-xs" style={{ color: "color-mix(in srgb, var(--fq-text) 68%, transparent)" }}>
            <p>{funnel.settings.footerText}</p>
            <a href={privacyUrl} target="_blank" rel="noopener" className="inline-block min-h-6 underline underline-offset-2">
              {t("Privacy Policy")}
            </a>
          </footer>
        )}
      </div>

      {(stickyButtons.length > 0 || notice || showBanner) && (
        <div
          className="sticky bottom-0 z-10 mt-auto space-y-2 px-4 pt-2"
          style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))", background: stickyButtons.length ? "var(--fq-bg)" : "transparent" }}
        >
          {notice && (
            <p
              role={notice.tone === "error" ? "alert" : "status"}
              className="mx-auto max-w-[28rem] rounded-xl px-4 py-2.5 text-center text-sm font-semibold"
              style={{ background: notice.tone === "error" ? "#fdecea" : "#e8f1fe", color: notice.tone === "error" ? "#8e1b1b" : "#0b3d75" }}
            >
              {notice.text}
            </p>
          )}
          {showBanner && pixelId && (
            <ConsentBanner
              kind={consentMode}
              privacyUrl={privacyUrl}
              onAccept={() => {
                const v: ConsentChoice = consentMode === "notice" ? "seen" : "accepted";
                saveConsent(v);
                setConsentPick(v);
              }}
              onDecline={() => {
                saveConsent("declined");
                setConsentPick("declined");
              }}
            />
          )}
          {stickyButtons.map((b) => (
            <div key={b.id} className="mx-auto max-w-[28rem]">
              <ButtonView block={b} ctx={ctx} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ConsentCheckbox({
  checked,
  onChange,
  text,
  privacyUrl,
  error,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  text: string;
  privacyUrl: string;
  error: string | null;
}) {
  const t = useT();
  return (
    <div className="mt-4 space-y-1.5 text-left">
      <label className="flex min-h-11 cursor-pointer items-start gap-3 text-[15px] leading-snug">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          required
          aria-invalid={error ? true : undefined}
          className="mt-0.5 h-6 w-6 shrink-0"
          style={{ accentColor: "var(--fq-primary)" }}
        />
        <span>
          {text}{" "}
          <a href={privacyUrl} target="_blank" rel="noopener" className="font-semibold underline underline-offset-2">
            {t("Privacy Policy")}
          </a>
        </span>
      </label>
      {error && (
        <p role="alert" className="text-sm font-semibold" style={{ color: "var(--fq-error)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
