import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { DemoNotice } from "@/components/demo-notice";
import PublicSiteHeader from "@/components/public-site-header";
import LegalCompanyLine from "@/components/legal-company-line";
import { LeadEngineLogo } from "@/components/sidebar";
import { getT } from "@/lib/i18n/server";
import type { TFunction } from "@/lib/i18n";

/**
 * Página inicial (2026-10-04): visual do instagram.com (fundo #fafafa, cartões
 * brancos com borda #dbdbdb, botão azul arredondado, pilha de fonte do site),
 * em português por padrão. Conteúdo honesto: diz o que o Lead Engine faz, sem
 * prometer resultado. Nenhum logo da Meta ou do Instagram, só o nome em texto.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t("Lead Engine: Instagram comments turned into Direct conversations"),
    description: t(
      "Reply to comments with an automatic DM through the official Meta API, see the photos and audio people send in the Direct, and keep every contact organized."
    ),
  };
}

/* Ícones de linha próprios (24x24), no traço fino do app. */
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-6 w-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const icons = {
  comment: (
    <Icon>
      <path d="M20.5 11.5a8.5 8.5 0 0 1-12.4 7.6L3.5 20.5l1.4-4.6A8.5 8.5 0 1 1 20.5 11.5z" />
    </Icon>
  ),
  direct: (
    <Icon>
      <path d="M21.5 3 10.2 10.6" />
      <path d="M21.5 3 15 21l-4.8-10.4L2.5 7.9z" />
    </Icon>
  ),
  contacts: (
    <Icon>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.5a6.5 6.5 0 0 1 3 5.5" />
    </Icon>
  ),
  shield: (
    <Icon>
      <path d="M12 2.8 4.5 5.6v5.6c0 4.6 3.1 8.5 7.5 10 4.4-1.5 7.5-5.4 7.5-10V5.6z" />
      <path d="m8.8 12 2.3 2.3 4.3-4.6" />
    </Icon>
  ),
  flow: (
    <Icon>
      <rect x="3" y="3" width="7" height="5.5" rx="1.5" />
      <rect x="14" y="15.5" width="7" height="5.5" rx="1.5" />
      <path d="M6.5 8.5v4a2.5 2.5 0 0 0 2.5 2.5h8.5v.5" />
    </Icon>
  ),
  clock: (
    <Icon>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.2 2" />
    </Icon>
  ),
  chart: (
    <Icon>
      <path d="M3.5 20.5h17" />
      <rect x="5" y="11" width="3" height="6.5" rx="0.8" />
      <rect x="10.5" y="6.5" width="3" height="11" rx="0.8" />
      <rect x="16" y="13.5" width="3" height="4" rx="0.8" />
    </Icon>
  ),
  unlink: (
    <Icon>
      <path d="M9.5 14.5 7.3 16.7a3.3 3.3 0 0 1-4.6-4.6l2.9-2.9a3.3 3.3 0 0 1 4.6 0" />
      <path d="m14.5 9.5 2.2-2.2a3.3 3.3 0 0 1 4.6 4.6l-2.9 2.9a3.3 3.3 0 0 1-4.6 0" />
    </Icon>
  ),
  check: (
    <Icon>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12.2 2.7 2.7L16.2 9.4" />
    </Icon>
  ),
  lock: (
    <Icon>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </Icon>
  ),
};

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
];

/* Celular de exemplo com uma conversa no Direct, só em CSS. */
function PhoneMock({ t }: { t: TFunction }) {
  return (
    <div
      role="img"
      aria-label={t("Example of a Direct conversation")}
      className="relative mx-auto w-full max-w-[300px] rounded-[44px] border border-border bg-white p-2.5 shadow-[0_20px_60px_-25px_rgba(0,0,0,0.35)]"
    >
      <div className="overflow-hidden rounded-[36px] border border-border bg-white" aria-hidden="true">
        {/* Barra de status */}
        <div className="flex items-center justify-between px-6 pb-1 pt-3 text-[11px] font-semibold text-foreground">
          <span>9:41</span>
          <span className="h-5 w-20 rounded-full bg-foreground" />
          <span className="flex items-center gap-1">
            <span className="h-2 w-3 rounded-[2px] bg-foreground" />
            <span className="h-2.5 w-5 rounded-[3px] border border-foreground" />
          </span>
        </div>

        {/* Topo da conversa */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-2.5">
          <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 5-7 7 7 7" />
          </svg>
          <span className="ig-gradient grid h-8 w-8 shrink-0 place-items-center rounded-full p-[2px]">
            <span className="grid h-full w-full place-items-center rounded-full bg-white text-[11px] font-semibold text-foreground">
              M
            </span>
          </span>
          <div className="min-w-0 leading-tight">
            <p className="truncate text-[13px] font-semibold text-foreground">maria.flores</p>
            <p className="text-[11px] text-muted">{t("Active now")}</p>
          </div>
        </div>

        {/* Mensagens */}
        <div className="space-y-2 px-3 pb-3 pt-3 text-[13px] leading-snug">
          <p className="text-center text-[11px] text-muted">{t("Commented FLOWERS on your reel")}</p>

          <div className="ml-auto max-w-[80%] rounded-[18px] bg-accent px-3.5 py-2 text-white">
            {t("Hi Maria! Here is the price list you asked for. Want me to set one aside?")}
          </div>
          <div className="ml-auto max-w-[80%] rounded-[14px] border border-border px-3.5 py-2 text-center text-[13px] font-semibold text-accent">
            {t("See price list")}
          </div>

          <div className="flex items-end gap-2">
            <span className="h-6 w-6 shrink-0 rounded-full bg-[#efefef]" />
            <div className="max-w-[75%] rounded-[18px] bg-[#efefef] px-3.5 py-2 text-foreground">
              {t("I do! Do you deliver on Saturday?")}
            </div>
          </div>

          <div className="flex items-end gap-2">
            <span className="h-6 w-6 shrink-0" />
            <div className="h-28 w-[62%] rounded-[18px] bg-[linear-gradient(135deg,#ffd1dc_0%,#fbe3c4_45%,#c9e7cf_100%)]">
              <span className="sr-only">{t("Photo of the arrangement")}</span>
            </div>
          </div>

          <div className="flex items-end gap-2">
            <span className="h-6 w-6 shrink-0 rounded-full bg-[#efefef]" />
            <div className="flex items-center gap-2 rounded-[18px] bg-[#efefef] px-3 py-2">
              <svg viewBox="0 0 24 24" className="h-4 w-4 text-foreground" fill="currentColor">
                <path d="M8 5.5v13l10.5-6.5z" />
              </svg>
              <span className="flex h-5 items-center gap-[3px]">
                {[6, 12, 9, 16, 10, 14, 7, 12, 8, 5, 10, 6].map((h, i) => (
                  <span key={i} className="w-[3px] rounded-full bg-foreground/70" style={{ height: `${h}px` }} />
                ))}
              </span>
              <span className="text-[11px] text-muted">0:12</span>
            </div>
          </div>
        </div>

        {/* Campo de mensagem */}
        <div className="px-3 pb-4">
          <div className="flex items-center gap-2 rounded-full border border-border px-3 py-2">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-accent text-white">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="4" y="7" width="16" height="12" rx="2" />
                <circle cx="12" cy="13" r="3" />
              </svg>
            </span>
            <span className="text-[13px] text-muted">{t("Message...")}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default async function Home() {
  const t = await getT();
  return (
    <div className="min-h-screen bg-[#fafafa] text-foreground">
      <DemoNotice variant="banner" />
      <PublicSiteHeader variant="home" />

      <main>
        {/* Topo */}
        <section className="mx-auto grid w-full max-w-5xl items-center gap-10 px-4 pb-14 pt-10 sm:px-6 md:grid-cols-[1fr_1fr] md:gap-12 md:pb-20 md:pt-16">
          <div className="md:order-2">
            <p className="inline-flex items-center gap-2 rounded-full border border-border bg-white px-3 py-1 text-xs font-semibold text-muted">
              <span className="h-2 w-2 rounded-full bg-success" aria-hidden="true" />
              {t("Official Meta API")}
            </p>
            <h1 className="mt-5 text-balance text-[32px] font-bold leading-[1.15] tracking-tight sm:text-[42px]">
              {t("Every comment can start a conversation in the Direct")}
            </h1>
            <p className="mt-4 max-w-xl text-base leading-7 text-muted">
              {t(
                "Someone comments your keyword on a post or reel and gets your message in the Direct right after, through the official Meta API. No shared password, no bot clicking around in a browser."
              )}
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/login"
                className="inline-flex h-11 items-center justify-center rounded-lg bg-accent px-6 text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
              >
                {t("Sign in")}
              </Link>
              <a
                href="#como-funciona"
                className="inline-flex h-11 items-center justify-center rounded-lg border border-border bg-white px-6 text-sm font-semibold text-foreground transition-colors hover:bg-surface-hover"
              >
                {t("See how it works")}
              </a>
            </div>
          </div>

          <div className="md:order-1">
            <PhoneMock t={t} />
          </div>
        </section>

        {/* Recursos */}
        <section id="recursos" className="scroll-mt-20 border-t border-border bg-white py-14 md:py-20">
          <div className="mx-auto w-full max-w-5xl px-4 sm:px-6">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{t("What Lead Engine does")}</h2>
            <p className="mt-3 max-w-2xl text-base leading-7 text-muted">
              {t(
                "Tools for the conversations that already happen on your profile, without making you leave Instagram's rules."
              )}
            </p>
            <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((f) => (
                <li key={f.title} className="rounded-xl border border-border bg-white p-5">
                  <span className="grid h-11 w-11 place-items-center rounded-full border border-border text-foreground">
                    {icons[f.icon]}
                  </span>
                  <h3 className="mt-4 text-base font-semibold">{t(f.title)}</h3>
                  <p className="mt-1.5 text-sm leading-6 text-muted">{t(f.body)}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Como funciona */}
        <section id="como-funciona" className="scroll-mt-20 border-t border-border py-14 md:py-20">
          <div className="mx-auto w-full max-w-5xl px-4 sm:px-6">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{t("Three steps, no secret")}</h2>
            <ol className="mt-8 grid gap-3 md:grid-cols-3">
              {steps.map((s, i) => (
                <li key={s.title} className="rounded-xl border border-border bg-white p-5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-accent">
                    {t("Step {n}", { n: i + 1 })}
                  </p>
                  <h3 className="mt-2 text-lg font-semibold">{t(s.title)}</h3>
                  <p className="mt-1.5 text-sm leading-6 text-muted">{t(s.body)}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Controle */}
        <section id="controle" className="scroll-mt-20 border-t border-border bg-white py-14 md:py-20">
          <div className="mx-auto w-full max-w-5xl px-4 sm:px-6">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{t("Automation helps, you decide")}</h2>
            <ul className="mt-8 grid gap-x-8 gap-y-6 sm:grid-cols-2">
              {controls.map((c) => (
                <li key={c.title} className="flex gap-4">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-border text-foreground">
                    {icons[c.icon]}
                  </span>
                  <div>
                    <h3 className="text-base font-semibold">{t(c.title)}</h3>
                    <p className="mt-1 text-sm leading-6 text-muted">{t(c.body)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Chamada final */}
        <section className="border-t border-border py-14 md:py-20">
          <div className="mx-auto w-full max-w-md px-4 sm:px-6">
            <div className="rounded-xl border border-border bg-white px-6 py-10 text-center sm:px-10">
              <div className="flex justify-center">
                <LeadEngineLogo />
              </div>
              <h2 className="mt-5 text-xl font-semibold leading-snug">
                {t("Ready to look at your comments with other eyes?")}
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted">
                {t("Sign in with your email and connect your Instagram professional account.")}
              </p>
              <Link
                href="/login"
                className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-lg bg-accent px-6 text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
              >
                {t("Sign in")}
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border py-8">
        <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-3 px-4 text-center text-xs text-muted sm:px-6">
          <nav className="flex flex-wrap justify-center gap-x-4 gap-y-2" aria-label={t("Lead Engine")}>
            <Link href="/privacy" className="hover:underline">{t("Privacy")}</Link>
            <Link href="/terms" className="hover:underline">{t("Terms")}</Link>
            <Link href="/data-deletion" className="hover:underline">{t("Data deletion")}</Link>
            <Link href="/templates" className="hover:underline">{t("Templates")}</Link>
          </nav>
          <p>{t("Uses the official Meta API. Not affiliated with Meta or Instagram.")}</p>
          <LegalCompanyLine />
        </div>
      </footer>
    </div>
  );
}
