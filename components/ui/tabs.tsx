"use client";

/**
 * Abas do painel (07/10/2026). Pedido do dono: "quando eu falei de abas nas
 * opções do sistema, principalmente na aba Agentes do WhatsApp, era das abas
 * de divisório da seção Agentes que está gigante". Então: abas horizontais
 * que trocam o conteúdo, uma parte por vez, no lugar da página com tudo
 * empilhado.
 *
 * - <Tabs page="..." tabs={[...]}>: a barra de abas (role="tablist") e os
 *   painéis. Setas, Home e End trocam de aba; no celular a barra rola na
 *   horizontal sem quebrar a página.
 * - <TabPanel id="...">: o conteúdo de uma aba. Todos os painéis ficam
 *   montados (só o da aba ativa aparece), então trocar de aba não perde o que
 *   foi digitado e um Salvar único salva todas as abas.
 * - Aba ativa no endereço (?aba=regras ou #regras, e também #id de qualquer
 *   coisa dentro de um painel, como /admin#chaves-ia) e lembrada no
 *   localStorage (com try/catch). Ordem: endereço, depois o lembrado, depois
 *   a primeira aba.
 * - Selo: `badge` da aba (texto curto ou só o ponto) e, sozinho, um ponto
 *   quando uma seção dentro do painel pede atenção ou um campo é inválido
 *   (nesse caso a aba com o erro abre sozinha).
 * Nada aqui muda lógica de tela: só organização.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/components/lang-provider";
import { REVEAL_TAB_EVENT, TabPanelContext, type SectionTone, type TabPanelInfo, type TabReport } from "@/components/ui/collapsible-section";

/* ------------------------------------ armazenamento ------------------------------------ */

const PREFIX = "lead-engine:abas:";

export function tabStorageKey(page: string): string {
  return `${PREFIX}${page}`;
}

/** Aba lembrada da página. Qualquer erro (sem localStorage) vira null. */
export function readSavedTab(page: string): string | null {
  try {
    const v = window.localStorage.getItem(tabStorageKey(page));
    return v && /^[\w-]{1,64}$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

function writeSavedTab(page: string, id: string) {
  try {
    window.localStorage.setItem(tabStorageKey(page), id);
  } catch {
    // Sem localStorage (aba anônima, bloqueado): só não lembra depois de recarregar.
  }
}

/* ------------------------------------ tipos ------------------------------------ */

/** Selo da aba: com `text` vira um chip curto; sem texto é só o ponto. `label` é o que o leitor de tela fala. */
export type TabBadge = { text?: string; tone?: SectionTone; label?: string };
export type TabItem = {
  id: string;
  label: string;
  badge?: TabBadge | null;
  /** Âncoras antigas que também abrem esta aba (ex.: "chaves-ia"). */
  aliases?: string[];
};

const TONE_CHIP: Record<SectionTone, string> = {
  default: "bg-surface-hover text-muted",
  success: "bg-success/10 text-success",
  warning: "bg-warning/15 text-foreground",
  error: "bg-error/10 text-error",
  accent: "bg-accent/10 text-accent",
};
const TONE_DOT: Record<SectionTone, string> = {
  default: "bg-muted",
  success: "bg-success",
  warning: "bg-warning",
  error: "bg-error",
  accent: "bg-accent",
};
const TONE_RANK: Record<SectionTone, number> = { error: 4, warning: 3, accent: 2, success: 1, default: 0 };

export const tabButtonId = (id: string) => `aba-${id}`;
export const tabPanelId = (id: string) => `aba-${id}-painel`;

/**
 * Qual aba o endereço pede: ?aba=x, #x (id ou âncora antiga da aba) ou #id
 * de um elemento que está dentro do painel de uma aba.
 */
export function tabFromLocation(tabs: Pick<TabItem, "id" | "aliases">[], loc: { search: string; hash: string }, doc?: Document | null): string | null {
  const byKey = (key: string) => tabs.find((tb) => tb.id === key || tb.aliases?.includes(key))?.id ?? null;
  try {
    const q = new URLSearchParams(loc.search).get("aba");
    if (q && byKey(q)) return byKey(q);
  } catch {
    // search estranho: segue pro hash
  }
  const hash = decodeURIComponent(loc.hash.replace(/^#/, ""));
  if (!hash) return null;
  const direct = byKey(hash);
  if (direct) return direct;
  const panel = doc?.getElementById(hash)?.closest<HTMLElement>("[data-aba-painel]");
  const id = panel?.dataset.abaPainel;
  return id && tabs.some((tb) => tb.id === id) ? id : null;
}

/* ------------------------------------ componente ------------------------------------ */

type Reports = Record<string, Record<string, TabReport>>;

type TabsCtxValue = {
  active: string;
  page: string;
  report: (tabId: string, sectionId: string, value: TabReport | null) => void;
  markInvalid: (tabId: string, value: boolean) => void;
};

const TabsCtx = createContext<TabsCtxValue | null>(null);

export function Tabs({
  page,
  label,
  tabs,
  children,
  className = "",
  sticky = true,
}: {
  /** Chave do localStorage (ex.: "whatsapp-agentes"). */
  page: string;
  /** Nome da barra pro leitor de tela. */
  label: string;
  tabs: TabItem[];
  children?: React.ReactNode;
  className?: string;
  sticky?: boolean;
}) {
  const t = useT();
  const [requested, setRequested] = useState<string | null>(null);
  const [reports, setReports] = useState<Reports>({});
  const [invalid, setInvalid] = useState<Record<string, boolean>>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef(tabs);
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  const active = requested && tabs.some((tb) => tb.id === requested) ? requested : (tabs[0]?.id ?? "");

  // Primeira carga: endereço, depois o lembrado. Depois disso, o #hash que mudar.
  useEffect(() => {
    function fromUrl(scroll: boolean) {
      const id = tabFromLocation(tabsRef.current, window.location, document);
      if (!id) return false;
      setRequested(id);
      const hash = decodeURIComponent(window.location.hash.replace(/^#/, ""));
      if (scroll && hash && document.getElementById(hash)?.closest("[data-aba-painel]")) {
        const go = () => document.getElementById(hash)?.scrollIntoView?.({ block: "start" });
        if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(go);
        else go();
      }
      return true;
    }
    if (!fromUrl(true)) {
      const saved = readSavedTab(page);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- aba lembrada, só no navegador
      if (saved) setRequested(saved);
    }
    const onHash = () => void fromUrl(true);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [page]);

  const select = useCallback(
    (id: string, opts: { remember?: boolean; url?: boolean } = {}) => {
      setRequested(id);
      if (opts.remember !== false) writeSavedTab(page, id);
      if (opts.url !== false) {
        try {
          const url = new URL(window.location.href);
          url.searchParams.set("aba", id);
          url.hash = "";
          window.history.replaceState(window.history.state, "", url.toString());
        } catch {
          // Sem history (teste, iframe estranho): só troca a aba.
        }
      }
    },
    [page]
  );

  // Pedido de dentro da página (link do resumo, campo inválido): abre a aba do painel.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onReveal = (e: Event) => {
      const id = (e as CustomEvent<{ id?: string }>).detail?.id;
      if (id && tabsRef.current.some((tb) => tb.id === id)) select(id, { url: false });
    };
    root.addEventListener(REVEAL_TAB_EVENT, onReveal);
    return () => root.removeEventListener(REVEAL_TAB_EVENT, onReveal);
  }, [select]);

  // A aba ativa sempre à vista na barra (no celular ela rola).
  useEffect(() => {
    // Rola só a barra: scrollIntoView também empurrava a página pro lado no celular.
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>(`[data-aba="${active}"]`);
    if (!list || !el) return;
    const left = el.offsetLeft; // a barra é "relative": offsetLeft já é dentro dela
    const right = left + el.offsetWidth;
    if (left < list.scrollLeft) list.scrollLeft = Math.max(0, left - 16);
    else if (right > list.scrollLeft + list.clientWidth) list.scrollLeft = right - list.clientWidth + 16;
  }, [active]);

  const report = useCallback((tabId: string, sectionId: string, value: TabReport | null) => {
    setReports((cur) => {
      const tab = { ...(cur[tabId] ?? {}) };
      if (value) {
        const old = tab[sectionId];
        if (old && old.tone === value.tone && old.text === value.text) return cur;
        tab[sectionId] = value;
      } else {
        if (!(sectionId in tab)) return cur;
        delete tab[sectionId];
      }
      return { ...cur, [tabId]: tab };
    });
  }, []);

  const markInvalid = useCallback(
    (tabId: string, value: boolean) => {
      setInvalid((cur) => (Boolean(cur[tabId]) === value ? cur : { ...cur, [tabId]: value }));
      if (value) select(tabId, { url: false });
    },
    [select]
  );

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) return;
    const i = tabs.findIndex((tb) => tb.id === active);
    if (i < 0 || tabs.length === 0) return;
    e.preventDefault();
    const next = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    const id = tabs[next].id;
    select(id);
    document.getElementById(tabButtonId(id))?.focus();
  }

  const ctx = useMemo<TabsCtxValue>(() => ({ active, report, markInvalid, page }), [active, report, markInvalid, page]);

  return (
    <div ref={rootRef} className={`min-w-0 ${className}`} data-abas={page}>
      <div className={`${sticky ? "sticky top-0 z-20" : ""} -mx-1 bg-background/95 px-1 backdrop-blur`}>
        <div
          ref={listRef}
          role="tablist"
          aria-label={label}
          aria-orientation="horizontal"
          onKeyDown={onKeyDown}
          className="relative flex min-w-0 gap-1 overflow-x-auto border-b border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {tabs.map((tb) => {
            const selected = tb.id === active;
            const auto = autoBadge(reports[tb.id], invalid[tb.id], t);
            const badge = invalid[tb.id] ? auto : (tb.badge ?? auto);
            const tone = badge?.tone ?? "default";
            return (
              <button
                key={tb.id}
                type="button"
                role="tab"
                id={tabButtonId(tb.id)}
                aria-selected={selected}
                aria-controls={tabPanelId(tb.id)}
                tabIndex={selected ? 0 : -1}
                data-aba={tb.id}
                onClick={() => select(tb.id)}
                className={`-mb-px inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-t-md border-b-2 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${
                  selected ? "border-accent font-semibold text-foreground" : "border-transparent text-muted hover:bg-surface-hover/60 hover:text-foreground"
                }`}
              >
                <span>{tb.label}</span>
                {badge &&
                  (badge.text ? (
                    <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none ${TONE_CHIP[tone]}`} data-aba-selo="">
                      {badge.text}
                      {badge.label && badge.label !== badge.text && <span className="sr-only"> ({badge.label})</span>}
                    </span>
                  ) : (
                    <span className="inline-flex items-center" data-aba-selo="">
                      <span className={`h-2 w-2 rounded-full ${TONE_DOT[tone]}`} aria-hidden="true" />
                      <span className="sr-only">{badge.label ?? t("Needs attention")}</span>
                    </span>
                  ))}
              </button>
            );
          })}
        </div>
      </div>
      <TabsCtx.Provider value={ctx}>
        <div className="pt-4">{children}</div>
      </TabsCtx.Provider>
    </div>
  );
}

function autoBadge(reports: Record<string, TabReport> | undefined, invalid: boolean | undefined, t: (s: string) => string): TabBadge | null {
  if (invalid) return { tone: "error", label: t("Has a field to fix") };
  const list = Object.values(reports ?? {});
  if (list.length === 0) return null;
  const top = list.reduce((a, b) => (TONE_RANK[b.tone] > TONE_RANK[a.tone] ? b : a));
  return { tone: top.tone, label: top.text ?? t("Needs attention") };
}

/* ------------------------------------ painel ------------------------------------ */


/** Primeiro campo inválido dentro de `root` (sem disparar o aviso). */
function firstInvalid(root: ParentNode | null | undefined): HTMLInputElement | null {
  if (!root) return null;
  for (const el of Array.from(root.querySelectorAll<HTMLInputElement>("input, textarea, select"))) {
    if (el.willValidate !== false && el.validity && !el.validity.valid) return el;
  }
  return null;
}

export function TabPanel({ id, children, className = "" }: { id: string; children?: React.ReactNode; className?: string }) {
  const ctx = useContext(TabsCtx);
  const ref = useRef<HTMLDivElement>(null);
  const selected = ctx ? ctx.active === id : true;
  const markInvalid = ctx?.markInvalid;

  // Campo inválido (no Salvar ou no envio de um formulário): a aba abre sozinha
  // e ganha o selo até o campo ficar certo.
  useEffect(() => {
    const el = ref.current;
    if (!el || !markInvalid) return;
    const onInvalid = () => markInvalid(id, true);
    const onEdit = () => {
      if (!firstInvalid(el)) markInvalid(id, false);
    };
    el.addEventListener("invalid", onInvalid, true);
    el.addEventListener("input", onEdit, true);
    el.addEventListener("change", onEdit, true);
    return () => {
      el.removeEventListener("invalid", onInvalid, true);
      el.removeEventListener("input", onEdit, true);
      el.removeEventListener("change", onEdit, true);
    };
  }, [id, markInvalid]);

  const report = ctx?.report;
  const info = useMemo<TabPanelInfo>(() => ({ tabId: id, report: (sectionId, value) => report?.(id, sectionId, value) }), [id, report]);

  return (
    <div
      ref={ref}
      role="tabpanel"
      id={tabPanelId(id)}
      aria-labelledby={tabButtonId(id)}
      data-aba-painel={id}
      data-abas={ctx?.page}
      hidden={!selected}
      tabIndex={-1}
      className={`space-y-4 outline-none ${className}`}
    >
      <TabPanelContext.Provider value={info}>{children}</TabPanelContext.Provider>
    </div>
  );
}

/**
 * Antes de salvar: se algum campo da página está inválido, abre a aba dele,
 * mostra o aviso do navegador e devolve false (não salva).
 */
export function checkFieldsInTabs(root: HTMLElement | null): boolean {
  const bad = firstInvalid(root);
  if (!bad) return true;
  // checkValidity dispara o "invalid" que abre a aba (TabPanel).
  bad.checkValidity();
  const go = () => {
    bad.focus?.();
    try {
      bad.reportValidity?.();
    } catch {
      // happy-dom / navegador antigo
    }
  };
  if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(go);
  else go();
  return false;
}
