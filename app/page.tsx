import type { Metadata } from "next";
import Link from "next/link";
import "./home.css";
import { DemoNotice } from "@/components/demo-notice";
import PublicSiteHeader from "@/components/public-site-header";
import LegalCompanyLine from "@/components/legal-company-line";
import { LeadEngineLogo } from "@/components/sidebar";
import BrandTile from "@/components/home/brand-tile";
import HeroStage from "@/components/home/hero-stage";
import { homeIcons as icons } from "@/components/home/icons";
import MotionSlot from "@/components/home/motion-slot";
import Reveal from "@/components/home/reveal";
import { CommentDmVisual, FlowVisual, PublishVisual } from "@/components/home/visuals";
import { getT } from "@/lib/i18n/server";
import type { SocialBrand } from "@/lib/social/brand-icons";

/**
 * Página inicial (24/10/2026): estilo Apple, com os logos oficiais de cada rede
 * (Instagram, Facebook, WhatsApp, TikTok, YouTube) usados como os guias de marca
 * pedem, sem recolorir nem distorcer e sem sugerir parceria. Textos honestos: diz o
 * que o Lead Engine faz, sem prometer resultado. TikTok e YouTube só para conectar a
 * conta e publicar ou agendar vídeos; nada de comentário ou DM dessas duas redes.
 * Vídeos de movimento entram por components/home/motion-slot (public/motions/*.mp4,
 * lista em lib/home/motion-slots.ts); sem o arquivo, aparece a ilustração em CSS.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t("Lead Engine: Instagram, Facebook, WhatsApp, TikTok and YouTube in one place"),
    description: t(
      "Turn comments into conversations on Instagram and Facebook, answer on WhatsApp, and publish or schedule videos on TikTok and YouTube, all through official APIs."
    ),
  };
}

const features: Array<{ icon: keyof typeof icons; title: string; body: string }> = [
  {
    icon: "comment",
    title: "Comment to DM",
    body: "Pick a post, the keyword and the message. Whoever comments gets the DM automatically, with a public reply if you want one.",
  },
  {
    icon: "direct",
    title: "Direct with photos and audio",
    body: "Answer every conversation in one inbox and see the photos, videos and audio the person sent, like in the app.",
  },
  {
    icon: "contacts",
    title: "Contacts CRM",
    body: "Each person who talks to you becomes a contact with history, tags and notes, so nobody gets lost.",
  },
  {
    icon: "shield",
    title: "Comment moderation",
    body: "Hide offensive comments and spam with rules you set, and review what was hidden.",
  },
  {
    icon: "flow",
    title: "Visual flows",
    body: "Draw the conversation in blocks: message, button, wait, condition. You see the whole path before turning it on.",
  },
  {
    icon: "clock",
    title: "Broadcasts within 24 hours",
    body: "Send a message to a group of contacts, only to people who talked to you in the last 24 hours, as Meta requires.",
  },
  {
    icon: "chart",
    title: "Reports",
    body: "See what was sent, clicked and replied, by campaign and by period, with A/B tests to compare messages.",
  },
];

const videoSteps: Array<{ icon: keyof typeof icons; title: string; body: string }> = [
  {
    icon: "lock",
    title: "Connect your TikTok account",
    body: "Use TikTok's official login and accept the permissions on TikTok's own screen. Lead Engine never sees your password.",
  },
  {
    icon: "upload",
    title: "Choose the video",
    body: "Upload the video file and write the caption.",
  },
  {
    icon: "sliders",
    title: "Set privacy and interactions",
    body: "Pick who can watch, allow or block comments, duet and stitch, and say if the video promotes a brand. TikTok's options are shown as they come from TikTok.",
  },
  {
    icon: "clock",
    title: "Publish now or schedule",
    body: "Confirm the post and it goes out now, or on the date and time you chose. You follow the status in the same screen.",
  },
];

const steps = [
  {
    title: "Connect",
    body: "Link your Instagram professional account through the official Meta login. Lead Engine never asks for your password.",
  },
  {
    title: "Set up",
    body: "Choose the post, the keyword and the message, or build a flow. Everything is created turned off.",
  },
  {
    title: "Follow",
    body: "Turn it on when you are ready and follow each send in the history: sent, skipped or failed, with the reason.",
  },
];

const controls: Array<{ icon: keyof typeof icons; title: string; body: string }> = [
  {
    icon: "unlink",
    title: "Disconnecting never deletes anything",
    body: "Your campaigns, contacts and history stay saved. Connect again and pick up where you left off.",
  },
  {
    icon: "check",
    title: "AI suggests, a person approves",
    body: "AI drafts replies, but no DM goes out and no campaign is turned on without a human approving it.",
  },
  {
    icon: "shield",
    title: "Inside Meta's rules",
    body: "Only the official API, with Meta's sending limits and the 24 hour window respected on every message.",
  },
  {
    icon: "lock",
    title: "Encrypted access",
    body: "Instagram access keys are stored encrypted and you can revoke them at any time.",
  },
  {
    icon: "lock",
    title: "Your TikTok password stays with TikTok",
    body: "You sign in on TikTok's own page. Lead Engine only receives the access TikTok allows, stored encrypted, and you can revoke it in TikTok at any time.",
  },
  {
    icon: "check",
    title: "A person confirms every post",
    body: "Nothing is published or scheduled by itself. An AI assistant can write a draft, but only a person confirms it on the screen.",
  },
];

const networks: Array<{ brand: SocialBrand; name: string; body: string }> = [
  { brand: "INSTAGRAM", name: "Instagram", body: "Comment to DM, Direct inbox with photos and audio, comment moderation, flows and broadcasts." },
  { brand: "FACEBOOK", name: "Facebook", body: "Answer comments and Messenger messages on the Facebook Pages you manage." },
  { brand: "WHATSAPP", name: "WhatsApp", body: "Conversations, leads and AI agents on your WhatsApp number, with a person always in control." },
  { brand: "TIKTOK", name: "TikTok", body: "Connect your account with TikTok's official login, then publish or schedule your videos. No TikTok comments or DMs." },
  { brand: "YOUTUBE", name: "YouTube", body: "Connect your channel with Google's official login, then publish or schedule your videos. No YouTube comments." },
];

const btnPrimary =
  "home-btn inline-flex h-12 items-center justify-center rounded-full bg-accent px-7 text-[15px] font-semibold text-white hover:bg-accent-hover";
const btnSecondary =
  "home-btn inline-flex h-12 items-center justify-center rounded-full px-5 text-[15px] font-semibold text-accent hover:bg-accent/10";

export default async function Home() {
  const t = await getT();
  const lead = features.slice(0, 2);
  const rest = features.slice(2);
  return (
    <div className="home min-h-screen">
      <DemoNotice variant="banner" />
      <PublicSiteHeader variant="home" />

      <main>
        {/* Topo */}
        <section className="mx-auto w-full max-w-6xl px-4 pb-10 pt-12 sm:px-6 md:pb-16 md:pt-20">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="home-display home-rise text-balance text-[40px] font-semibold sm:text-6xl md:text-[72px]">
              {t("Comments become conversations. Videos go out on schedule.")}
            </h1>
            <p
              className="home-rise home-muted mx-auto mt-6 max-w-2xl text-lg leading-8 md:text-xl"
              style={{ ["--d" as string]: "120ms" }}
            >
              {t(
                "Connect your Instagram professional account, your Facebook Page, WhatsApp, TikTok and YouTube. Reply to comments with a message in the Direct or Messenger, talk to leads on WhatsApp, and publish or schedule your videos on TikTok and YouTube. Everything goes through the official APIs, with no shared password."
              )}
            </p>
            <div
              className="home-rise mt-9 flex flex-col items-center justify-center gap-2 sm:flex-row sm:gap-3"
              style={{ ["--d" as string]: "220ms" }}
            >
              <Link href="/login" className={btnPrimary}>
                {t("Sign in")}
              </Link>
              <a href="#como-funciona" className={btnSecondary}>
                {t("See how it works")}
              </a>
            </div>
          </div>

          <div className="mt-12 md:mt-16">
            <MotionSlot name="hero" className="overflow-hidden rounded-[28px] md:rounded-[36px]">
              <HeroStage t={t} />
            </MotionSlot>
          </div>
        </section>

        {/* Redes conectadas */}
        <section id="redes" className="scroll-mt-20 py-16 md:py-28">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
            <Reveal>
              <h2 className="home-title mx-auto max-w-2xl text-balance text-center text-4xl font-semibold md:text-5xl">
                {t("Connected networks")}
              </h2>
              <p className="home-muted mx-auto mt-4 max-w-2xl text-center text-lg leading-8">
                {t(
                  "Each network is connected through its own official login. Here is what Lead Engine does on each one, and nothing more."
                )}
              </p>
            </Reveal>
            <ul className="mt-12 grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-5">
              {networks.map((n, i) => (
                <li key={n.name} className="min-w-0">
                  <Reveal delay={i * 60} className="flex flex-col items-center text-center">
                    <BrandTile brand={n.brand} size={64} />
                    <h3 className="mt-5 text-lg font-semibold tracking-tight">{n.name}</h3>
                    <p className="home-muted mt-1.5 max-w-[17rem] text-[15px] leading-6">{t(n.body)}</p>
                  </Reveal>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Recursos */}
        <section id="recursos" className="scroll-mt-20 bg-[var(--home-soft)] py-16 md:py-28">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
            <Reveal>
              <h2 className="home-title max-w-2xl text-balance text-4xl font-semibold md:text-5xl">
                {t("What Lead Engine does")}
              </h2>
              <p className="home-muted mt-4 max-w-2xl text-lg leading-8">
                {t(
                  "Tools for the conversations that already happen on your profile, without making you leave Instagram's rules."
                )}
              </p>
            </Reveal>

            <div className="mt-12 space-y-6 md:mt-16 md:space-y-8">
              {lead.map((f, i) => (
                <Reveal key={f.title}>
                  <div className="grid items-center gap-6 overflow-hidden rounded-[28px] bg-white p-2 md:grid-cols-2 md:gap-0 md:rounded-[36px] md:p-3">
                    <div className={`p-6 md:p-12 ${i % 2 ? "md:order-2" : ""}`}>
                      <span className="grid h-11 w-11 place-items-center rounded-full bg-accent/10 text-accent">{icons[f.icon]}</span>
                      <h3 className="home-title mt-6 text-3xl font-semibold md:text-4xl">{t(f.title)}</h3>
                      <p className="home-muted mt-3 max-w-md text-lg leading-8">{t(f.body)}</p>
                    </div>
                    <MotionSlot name={i === 0 ? "comentario-dm" : "fluxo"} className={`overflow-hidden rounded-[22px] md:rounded-[28px] ${i % 2 ? "md:order-1" : ""}`}>
                      {i === 0 ? <CommentDmVisual t={t} /> : <FlowVisual t={t} />}
                    </MotionSlot>
                  </div>
                </Reveal>
              ))}
            </div>

            <ul className="mt-12 grid gap-x-10 gap-y-9 sm:grid-cols-2 lg:grid-cols-3 md:mt-16">
              {rest.map((f, i) => (
                <li key={f.title}>
                  <Reveal delay={(i % 3) * 60}>
                    <span className="grid h-10 w-10 place-items-center rounded-full bg-white text-accent">{icons[f.icon]}</span>
                    <h3 className="mt-4 text-lg font-semibold tracking-tight">{t(f.title)}</h3>
                    <p className="home-muted mt-1.5 text-[15px] leading-6">{t(f.body)}</p>
                  </Reveal>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Vídeos */}
        <section id="videos" className="scroll-mt-20 bg-[#1d1d1f] py-16 text-white md:py-28">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
            <Reveal className="flex flex-col items-start gap-5">
              <span className="flex gap-2">
                <BrandTile brand="TIKTOK" size={36} />
                <BrandTile brand="YOUTUBE" size={36} />
              </span>
              <h2 className="home-title max-w-2xl text-balance text-4xl font-semibold md:text-5xl">
                {t("Schedule and publish videos")}
              </h2>
              <p className="max-w-2xl text-lg leading-8 text-white/70">
                {t(
                  "From your computer to TikTok or YouTube in four steps. You choose every option, and nothing goes out without your confirmation."
                )}
              </p>
            </Reveal>

            <Reveal className="mt-12">
              <MotionSlot name="publicar" className="mx-auto max-w-4xl overflow-hidden rounded-[28px] md:rounded-[36px]">
                <PublishVisual t={t} />
              </MotionSlot>
            </Reveal>

            <ol className="mt-12 grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
              {videoSteps.map((s, i) => (
                <li key={s.title}>
                  <Reveal delay={i * 60}>
                    <p className="text-[15px] font-semibold text-white/50">{t("Step {n}", { n: i + 1 })}</p>
                    <h3 className="mt-2 text-lg font-semibold tracking-tight">{t(s.title)}</h3>
                    <p className="mt-1.5 text-[15px] leading-6 text-white/70">{t(s.body)}</p>
                  </Reveal>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Como funciona */}
        <section id="como-funciona" className="scroll-mt-20 py-16 md:py-28">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
            <Reveal>
              <h2 className="home-title text-balance text-4xl font-semibold md:text-5xl">{t("Three steps, no secret")}</h2>
            </Reveal>
            <ol className="mt-12 grid gap-10 md:grid-cols-3 md:gap-12">
              {steps.map((s, i) => (
                <li key={s.title}>
                  <Reveal delay={i * 80}>
                    <p className="home-display text-6xl font-semibold text-accent" aria-hidden="true">{i + 1}</p>
                    <h3 className="home-title mt-4 text-2xl font-semibold">{t(s.title)}</h3>
                    <p className="home-muted mt-2 text-[17px] leading-7">{t(s.body)}</p>
                  </Reveal>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Controle */}
        <section id="controle" className="scroll-mt-20 bg-[var(--home-soft)] py-16 md:py-28">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
            <Reveal>
              <h2 className="home-title max-w-2xl text-balance text-4xl font-semibold md:text-5xl">
                {t("Automation helps, you decide")}
              </h2>
            </Reveal>
            <ul className="mt-12 grid gap-x-12 gap-y-9 sm:grid-cols-2">
              {controls.map((c, i) => (
                <li key={c.title}>
                  <Reveal delay={(i % 2) * 60} className="flex gap-4">
                    <span className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white text-accent">{icons[c.icon]}</span>
                    <div>
                      <h3 className="text-lg font-semibold tracking-tight">{t(c.title)}</h3>
                      <p className="home-muted mt-1 text-[15px] leading-6">{t(c.body)}</p>
                    </div>
                  </Reveal>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Chamada final */}
        <section className="py-20 md:py-32">
          <Reveal className="mx-auto w-full max-w-2xl px-4 text-center sm:px-6">
            <div className="flex justify-center">
              <LeadEngineLogo />
            </div>
            <h2 className="home-title mt-6 text-balance text-4xl font-semibold md:text-5xl">
              {t("Ready to look at your comments with other eyes?")}
            </h2>
            <p className="home-muted mx-auto mt-4 max-w-xl text-lg leading-8">
              {t("Sign in with your email and connect your Instagram, Facebook, WhatsApp, TikTok or YouTube account.")}
            </p>
            <Link href="/login" className={`${btnPrimary} mt-8`}>
              {t("Sign in")}
            </Link>
          </Reveal>
        </section>
      </main>

      <footer className="border-t border-[var(--home-line)] py-8">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-3 px-4 text-center text-xs text-muted sm:px-6">
          <nav className="flex flex-wrap justify-center gap-x-4 gap-y-2" aria-label={t("Lead Engine")}>
            <Link href="/privacy" className="hover:underline">{t("Privacy")}</Link>
            <Link href="/terms" className="hover:underline">{t("Terms")}</Link>
            <Link href="/data-deletion" className="hover:underline">{t("Data deletion")}</Link>
            <Link href="/templates" className="hover:underline">{t("Templates")}</Link>
          </nav>
          <p>{t("Uses the official APIs of Meta, TikTok and Google. Not affiliated with Meta, Instagram, Facebook, WhatsApp, TikTok, Google or YouTube.")}</p>
          <LegalCompanyLine />
        </div>
      </footer>
    </div>
  );
}
