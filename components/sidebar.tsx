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
 * 2026-10-07: Fluxos (Etapa 3), logo depois de Campanhas em Automações.
 * 2026-10-08: Etapa 5. Disparos e Segmentos em Automações, Relatórios em Início.
 * 2026-10-09: pedido do dono, "pra não ficar aquele menu gigante". Cada seção
 * vira um grupo que abre e fecha; o grupo da página atual abre sozinho e o
 * que ficou aberto é lembrado no navegador. Avisos (aprovações, canal) sobem
 * pro nome do grupo quando ele está fechado. A Etapa 6 entra como grupo "Quiz".
 * 2026-10-10: Etapa 6. Grupo "Quiz" (funis interativos), logo depois de Automações.
 * 2026-10-06: grupo "WhatsApp" (Conversas, Conexões, Agentes), logo depois de Conversas.
 * 2026-10-06: grupo "Admin da plataforma" no fim, só pro admin da plataforma
 * (adminMenu vem do servidor, lib/platform-admin.ts). Pra qualquer outra
 * pessoa o grupo não é renderizado.
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LangSwitch, useT } from "@/components/lang-provider";
import type { AdminMenuState } from "@/lib/platform-admin";

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
  "/flows": ({ ativo }) => (
    <svg viewBox="0 0 24 24" className="h-6 w-6"><rect {...traco(ativo)} x="2.5" y="3.5" width="7" height="5" rx="1.5" /><rect {...traco(ativo)} x="14.5" y="9.5" width="7" height="5" rx="1.5" /><rect {...traco(ativo)} x="2.5" y="15.5" width="7" height="5" rx="1.5" /><path {...traco(ativo)} d="M9.5 6H12v12H9.5M12 12h2.5" /></svg>
  ),
  "/quizzes": ({ ativo }) => (
    <svg viewBox="0 0 24 24" className="h-6 w-6"><rect {...traco(ativo)} x="4" y="2.5" width="16" height="19" rx="3" /><path {...traco(ativo)} d="M9.5 8.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 16.5h.01" /></svg>
  ),
  "/reports": ({ ativo }) => (
    <svg viewBox="0 0 24 24" className="h-6 w-6"><path {...traco(ativo)} d="M4 4v16h16" /><path {...traco(ativo)} d="m7.5 14.5 3.5-4 3 2.5 5-6" /></svg>
  ),
  "/broadcasts": ({ ativo }) => (
    <svg viewBox="0 0 24 24" className="h-6 w-6"><path {...traco(ativo)} d="M3 10.5v3a1.5 1.5 0 0 0 1.5 1.5H7l7 4.5v-15L7 9H4.5A1.5 1.5 0 0 0 3 10.5z" /><path {...traco(ativo)} d="M17.5 8.5a5 5 0 0 1 0 7M20 6a8.5 8.5 0 0 1 0 12" /></svg>
  ),
  "/segments": ({ ativo }) => (
    <svg viewBox="0 0 24 24" className="h-6 w-6"><path {...traco(ativo)} d="M3 4.5h18l-7 8.5v6l-4 1.5v-7.5z" /></svg>
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
  "/whatsapp/inbox": ({ ativo }) => (
    <svg viewBox="0 0 24 24" className="h-6 w-6"><path {...traco(ativo)} d="M3 21l1.7-5A8.5 8.5 0 1 1 8 19.4z" /><path {...traco(ativo)} d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 1c-1-.4-1.8-1.2-2.2-2.2l1-1-1-2z" /></svg>
  ),
  "/whatsapp/connections": ({ ativo }) => (
    <svg viewBox="0 0 24 24" className="h-6 w-6"><rect {...traco(ativo)} x="3" y="3" width="7" height="7" rx="1" /><rect {...traco(ativo)} x="14" y="3" width="7" height="7" rx="1" /><rect {...traco(ativo)} x="3" y="14" width="7" height="7" rx="1" /><path {...traco(ativo)} d="M14 14h3v3h-3zM20 14v.01M20 20h-6M17 17v3" /></svg>
  ),
  "/whatsapp/agents": ({ ativo }) => (
    <svg viewBox="0 0 24 24" className="h-6 w-6"><rect {...traco(ativo)} x="4" y="7" width="16" height="12" rx="3" /><path {...traco(ativo)} d="M12 3v4M9 12h.01M15 12h.01M9.5 15.5h5M2 12v3M22 12v3" /></svg>
  ),
  "/settings": ({ ativo }) => (
    <svg viewBox="0 0 24 24" className="h-6 w-6"><path {...traco(ativo)} d="M3 6h18M3 12h18M3 18h18" /></svg>
  ),
  "/admin": ({ ativo }) => (
    <svg viewBox="0 0 24 24" className="h-6 w-6"><circle {...traco(ativo)} cx="8" cy="15" r="4" /><path {...traco(ativo)} d="m11 12 9-9M17 6l3 3M14.5 8.5l2 2" /></svg>
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
      { label: "Reports", href: "/reports" },
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
    // 2026-10-06: WhatsApp (conectar pelo QR, inbox e os 3 agentes de IA).
    title: "WhatsApp",
    items: [
      { label: "Conversations", href: "/whatsapp/inbox" },
      { label: "Connections", href: "/whatsapp/connections" },
      { label: "Agents", href: "/whatsapp/agents" },
    ],
  },
  {
    title: "Automations",
    items: [
      { label: "Campaigns", href: "/campaigns" },
      { label: "Flows", href: "/flows" },
      { label: "Broadcasts", href: "/broadcasts" },
      { label: "Segments", href: "/segments" },
      { label: "Sequences", href: "/sequences" },
      { label: "Conversation links", href: "/conversation-links" },
      { label: "Moderation", href: "/moderation" },
      { label: "DM Logs", href: "/logs" },
    ],
  },
  {
    title: "Quiz",
    items: [{ label: "Quizzes", href: "/quizzes" }],
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

const isActiveHref = (pathname: string, href: string) => pathname === href || pathname.startsWith(href + "/");

/** Which groups the owner left open or closed. Browser only; empty is fine. */
const OPEN_GROUPS_KEY = "lead-engine:menu-grupos";
const OPEN_GROUPS_EVENT = "lead-engine:menu-grupos";
// Fallback when the browser blocks storage (private window): the menu still
// opens and closes, it just forgets on reload.
let groupsInMemory = "{}";
const readGroups = () => {
  try {
    return window.localStorage.getItem(OPEN_GROUPS_KEY) ?? groupsInMemory;
  } catch {
    return groupsInMemory;
  }
};
const writeGroups = (value: string) => {
  groupsInMemory = value;
  try {
    window.localStorage.setItem(OPEN_GROUPS_KEY, value);
  } catch {
    // Blocked storage: groupsInMemory keeps it for this visit.
  }
  window.dispatchEvent(new Event(OPEN_GROUPS_EVENT));
};
const subscribeGroups = (onChange: () => void) => {
  window.addEventListener("storage", onChange);
  window.addEventListener(OPEN_GROUPS_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(OPEN_GROUPS_EVENT, onChange);
  };
};

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceName: string;
  /** True when some channel needs attention: red dot next to "Channels". */
  channelsNeedAttention?: boolean;
  /** Platform admin only (computed on the server). */
  adminMenu?: AdminMenuState;
}

type NavSection = { title: string; items: { label: string; href: string; icon?: string }[]; notice?: string };

/** Grupo do admin da plataforma (no fim do menu). null = não aparece. */
export function adminSection(state: AdminMenuState | null | undefined): NavSection | null {
  if (state === "admin") return { title: "Platform admin", items: [{ label: "Admin", href: "/admin" }] };
  if (state === "needs_2fa") {
    return {
      title: "Platform admin",
      items: [{ label: "Admin", href: "/account/two-factor", icon: "/admin" }],
      notice: "Turn on two-step verification to open Admin.",
    };
  }
  return null;
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

export default function Sidebar({ isOpen, onClose, workspaceName, channelsNeedAttention = false, adminMenu = null }: SidebarProps) {
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

  // Groups the owner opened or closed by hand. A group never touched follows
  // the page: open when it holds the current page, closed otherwise.
  const savedGroups = useSyncExternalStore(subscribeGroups, readGroups, () => "{}");
  const openGroups = useMemo<Record<string, boolean>>(() => {
    try {
      const parsed = JSON.parse(savedGroups);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }, [savedGroups]);
  const toggleGroup = (title: string, open: boolean) => writeGroups(JSON.stringify({ ...openGroups, [title]: !open }));

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
          {[...navSections, ...(adminMenu ? [adminSection(adminMenu)!] : [])].map((section: NavSection, i) => {
            const hasActive = section.items.some((item) => isActiveHref(pathname, item.href));
            const open = openGroups[section.title] ?? hasActive;
            const groupId = `menu-grupo-${i}`;
            const drafts = section.items.some((item) => item.href === "/approvals") ? pendingDrafts : 0;
            const channelAlert = channelsNeedAttention && section.items.some((item) => item.href === "/channels");
            return (
              <div key={section.title} className={i > 0 ? "mt-1" : ""}>
                <button
                  type="button"
                  onClick={() => toggleGroup(section.title, open)}
                  aria-expanded={open}
                  aria-controls={groupId}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[15px] text-foreground transition-colors hover:bg-surface-hover ${
                    hasActive ? "font-bold" : "font-semibold"
                  }`}
                >
                  <span className="flex-1">{t(section.title)}</span>
                  {!open && drafts > 0 && (
                    <span
                      className="grid h-5 min-w-5 place-items-center rounded-full bg-error px-1.5 text-[11px] font-semibold text-white"
                      aria-label={t("{n} waiting", { n: drafts })}
                    >
                      {drafts > 99 ? "99+" : drafts}
                    </span>
                  )}
                  {!open && channelAlert && (
                    <span className="h-2.5 w-2.5 rounded-full bg-error" aria-label={t("Needs attention")} />
                  )}
                  <svg
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    className={`h-4 w-4 text-muted transition-transform duration-150 ${open ? "rotate-180" : ""}`}
                  >
                    <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                {open && (
                  <ul id={groupId} className="mb-2 space-y-0.5 pl-2">
                    {section.items.map((item) => {
                      const isActive = isActiveHref(pathname, item.href);
                      const Icon = icones[item.icon ?? item.href];
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
                    {section.notice && <li className="px-3 pb-1 text-xs text-warning">{t(section.notice)}</li>}
                  </ul>
                )}
              </div>
            );
          })}
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
