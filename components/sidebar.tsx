"use client";

/**
 * Sidebar Navigation
 *
 * 2026-10-03: visual do menu lateral do instagram.com (ícone + texto, item ativo
 * em negrito), marca Lead Engine e troca de idioma PT | EN no rodapé.
 * Contatos (CRM) e Moderação entram logo depois de Campanhas.
 * 2026-10-04: Aprovações (com o número de rascunhos esperando), Sequências e
 * Links de conversa.
 * 2026-10-05: Canais (status de cada canal ligado, com bolinha quando algum
 * precisa de atenção).
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LangSwitch, useT } from "@/components/lang-provider";

type Icone = (props: { ativo: boolean }) => React.ReactElement;

const traco = (ativo: boolean) => ({ fill: "none", stroke: "currentColor", strokeWidth: ativo ? 2.4 : 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const });

const icones: Record<string, Icone> = {
  "/dashboard": ({ ativo }) => (
    <svg viewBox="0 0 24 24" className="h-6 w-6"><path {...traco(ativo)} d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z" /></svg>
  ),
  "/overview": ({ ativo }) => (
    <svg viewBox="0 0 24 24" className="h-6 w-6"><path {...traco(ativo)} d="M4 20V10m6 10V4m6 16v-7m4 7H2" /></svg>
  ),
  "/inbox": ({ ativo }) => (
    <svg viewBox="0 0 24 24" className="h-6 w-6"><path {...traco(ativo)} d="M22 3 9.2 10.1M22 3l-7 18-3.8-8.9L2 8.3z" /></svg>
  ),
  "/campaigns": ({ ativo }) => (
    <svg viewBox="0 0 24 24" className="h-6 w-6"><path {...traco(ativo)} d="M12 21s-7-4.4-9.3-9C1.1 8.6 3 4.5 6.9 4.5c2.3 0 3.8 1.4 5.1 3.2 1.3-1.8 2.8-3.2 5.1-3.2 3.9 0 5.8 4.1 4.2 7.5C19 16.6 12 21 12 21z" /></svg>
  ),
  "/approvals": ({ ativo }) => (
    <svg viewBox="0 0 24 24" className="h-6 w-6"><path {...traco(ativo)} d="M21 11.5a8.4 8.4 0 0 1-12.3 7.5L3 21l2-5.5A8.4 8.4 0 1 1 21 11.5z" /><path {...traco(ativo)} d="m8.5 11.5 2.5 2.5 4.5-4.5" /></svg>
  ),
  "/sequences": ({ ativo }) => (
    <svg viewBox="0 0 24 24" className="h-6 w-6"><circle {...traco(ativo)} cx="5" cy="6" r="2" /><circle {...traco(ativo)} cx="5" cy="18" r="2" /><path {...traco(ativo)} d="M5 8v8M10 6h10M10 12h7M10 18h10" /></svg>
  ),
  "/conversation-links": ({ ativo }) => (
    <svg viewBox="0 0 24 24" className="h-6 w-6"><path {...traco(ativo)} d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></svg>
  ),
  "/contacts": ({ ativo }) => (
    <svg viewBox="0 0 24 24" className="h-6 w-6"><circle {...traco(ativo)} cx="9" cy="8" r="4" /><path {...traco(ativo)} d="M2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 9M18 14.5a6 6 0 0 1 4 6.5" /></svg>
  ),
  "/moderation": ({ ativo }) => (
    <svg viewBox="0 0 24 24" className="h-6 w-6"><path {...traco(ativo)} d="M12 2.5 4 5.5v6c0 5 3.4 8.8 8 10 4.6-1.2 8-5 8-10v-6z" /><path {...traco(ativo)} d="m8.5 12 2.5 2.5 4.5-5" /></svg>
  ),
  "/logs": ({ ativo }) => (
    <svg viewBox="0 0 24 24" className="h-6 w-6"><path {...traco(ativo)} d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" /></svg>
  ),
  "/channels": ({ ativo }) => (
    <svg viewBox="0 0 24 24" className="h-6 w-6"><circle {...traco(ativo)} cx="12" cy="12" r="2" /><path {...traco(ativo)} d="M16.2 7.8a6 6 0 0 1 0 8.4M7.8 16.2a6 6 0 0 1 0-8.4M19 5a10 10 0 0 1 0 14M5 19A10 10 0 0 1 5 5" /></svg>
  ),
  "/settings": ({ ativo }) => (
    <svg viewBox="0 0 24 24" className="h-6 w-6"><path {...traco(ativo)} d="M3 6h18M3 12h18M3 18h18" /></svg>
  ),
  "/diagnostics": ({ ativo }) => (
    <svg viewBox="0 0 24 24" className="h-6 w-6"><circle {...traco(ativo)} cx="12" cy="12" r="9" /><path {...traco(ativo)} d="M12 7v5l3 2" /></svg>
  ),
};

/**
 * 2026-10-06: menu por seções (título pequeno em cinza, como no ManyChat).
 * Cada rota aparece uma vez só; a ordem segue o caminho do dono no dia a dia.
 */
const navSections: { title: string; items: { label: string; href: string }[] }[] = [
  {
    title: "Home",
    items: [
      { label: "Dashboard", href: "/dashboard" },
      { label: "Overview", href: "/overview" },
    ],
  },
  {
    title: "Conversations",
    items: [
      { label: "Inbox", href: "/inbox" },
      { label: "Approvals", href: "/approvals" },
      { label: "Contacts", href: "/contacts" },
    ],
  },
  {
    title: "Automations",
    items: [
      { label: "Campaigns", href: "/campaigns" },
      { label: "Sequences", href: "/sequences" },
      { label: "Conversation links", href: "/conversation-links" },
      { label: "Moderation", href: "/moderation" },
      { label: "DM Logs", href: "/logs" },
    ],
  },
  {
    title: "Channels and account",
    items: [
      { label: "Channels", href: "/channels" },
      { label: "Settings", href: "/settings" },
      { label: "Diagnostics", href: "/diagnostics" },
    ],
  },
];

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceName: string;
  /** True when some channel needs attention: red dot next to "Channels". */
  channelsNeedAttention?: boolean;
}

/** Marca: ícone com o gradiente do Instagram + nome. */
export function LeadEngineLogo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <span className="ig-gradient grid h-8 w-8 place-items-center rounded-[10px] text-white">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.5L3 21l2-5.5A8.4 8.4 0 1 1 21 11.5z" />
          <path d="M9 11.5h6M12 8.5v6" />
        </svg>
      </span>
      <span className="text-xl font-semibold tracking-tight">Lead Engine</span>
    </span>
  );
}

export default function Sidebar({ isOpen, onClose, workspaceName, channelsNeedAttention = false }: SidebarProps) {
  const pathname = usePathname();
  const t = useT();
  // How many AI drafts wait for a human, shown next to "Approvals".
  const [pendingDrafts, setPendingDrafts] = useState(0);
  useEffect(() => {
    let alive = true;
    const check = () =>
      fetch("/api/drafts?status=PENDING&limit=1", { cache: "no-store" })
        .then((r) => r.json())
        .then((p) => {
          if (alive && p.success) setPendingDrafts(Number(p.data.total) || 0);
        })
        .catch(() => undefined);
    void check();
    const timer = window.setInterval(check, 30_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [pathname]);

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={onClose} />}

      <aside
        className={`
          fixed top-0 left-0 z-50 h-dvh w-64 max-w-[85vw] shrink-0 bg-background border-r border-border flex flex-col
          transition-transform duration-200 ease-out
          lg:h-full lg:translate-x-0 lg:static lg:z-auto
          ${isOpen ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        {/* The drawer is full height, so the wordmark would otherwise land under the status bar. */}
        <div className="px-6 pt-8 pb-5" style={{ paddingTop: "calc(2rem + env(safe-area-inset-top))" }}>
          <Link href="/dashboard" aria-label="Lead Engine">
            <LeadEngineLogo />
          </Link>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 pb-4" aria-label={t("Menu")}>
          {navSections.map((section, i) => (
            <div key={section.title} className={i > 0 ? "mt-5" : ""}>
              <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
                {t(section.title)}
              </p>
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
                  const Icon = icones[item.href];
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onClose}
                        aria-current={isActive ? "page" : undefined}
                        className={`flex items-center gap-4 rounded-lg px-3 py-2.5 text-[15px] text-foreground transition-colors hover:bg-surface-hover ${
                          isActive ? "font-bold" : ""
                        }`}
                      >
                        {Icon && <Icon ativo={isActive} />}
                        <span className="flex-1">{t(item.label)}</span>
                        {item.href === "/approvals" && pendingDrafts > 0 && (
                          <span
                            className="grid h-5 min-w-5 place-items-center rounded-full bg-error px-1.5 text-[11px] font-semibold text-white"
                            aria-label={t("{n} waiting", { n: pendingDrafts })}
                          >
                            {pendingDrafts > 99 ? "99+" : pendingDrafts}
                          </span>
                        )}
                        {item.href === "/channels" && channelsNeedAttention && (
                          <span className="h-2.5 w-2.5 rounded-full bg-error" aria-label={t("Needs attention")} />
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="space-y-3 px-5 py-4 border-t border-border">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">{workspaceName}</p>
              <p className="text-xs text-muted">{t("Self-hosted")}</p>
            </div>
            <LangSwitch />
          </div>
        </div>
      </aside>
    </>
  );
}
