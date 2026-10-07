"use client";

/**
 * Seções recolhíveis do painel (06/10/2026). Pedido do dono: "organizar
 * melhor as informações e ter abas recolhíveis, isso em todo app, até nas
 * configurações, pra não ficar tendo que descer muito pra ver as infos".
 *
 * - <CollapsibleSection>: cabeçalho clicável (título, seta, resumo de uma
 *   linha quando fechada e selo de status). Botão com aria-expanded e
 *   aria-controls; seta pra cima e pra baixo passa pro cabeçalho vizinho.
 *   O conteúdo fica sempre montado (campos não perdem o que foi digitado),
 *   só some da tela e do teclado (inert) quando fechado.
 * - <SectionsProvider page="...">: lembra o aberto/fechado por página e por
 *   seção no localStorage (com try/catch; sem localStorage funciona igual,
 *   só não lembra depois de recarregar) e alimenta o índice.
 * - <SectionIndex>: chips no topo (clicar rola até a seção e abre) e os
 *   botões "Abrir tudo" e "Fechar tudo". No celular rola na horizontal.
 *
 * Seção com `attention` (erro, pendência, algo pra conferir) abre sozinha
 * quando o aviso aparece. Campo inválido dentro de uma seção fechada também
 * abre a seção. Nada aqui muda lógica de tela: só organização.
 */

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useT } from "@/components/lang-provider";

/* ------------------------------------ armazenamento ------------------------------------ */

const PREFIX = "lead-engine:secoes:";

export function storageKey(page: string): string {
  return `${PREFIX}${page}`;
}

/** Lê o mapa salvo da página. Qualquer erro (sem localStorage, JSON ruim) vira {}. */
export function readSaved(page: string): Record<string, boolean> {
  try {
    const raw = window.localStorage.getItem(storageKey(page));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) if (typeof v === "boolean") out[k] = v;
    return out;
  } catch {
    return {};
  }
}

function writeSaved(page: string, map: Record<string, boolean>) {
  try {
    window.localStorage.setItem(storageKey(page), JSON.stringify(map));
  } catch {
    // Sem localStorage (aba anônima, bloqueado): fica só na memória.
  }
}

export type SectionTone = "default" | "success" | "warning" | "error" | "accent";
export type SectionBadge = { text: string; tone?: SectionTone };

type Snapshot = { open: Record<string, boolean>; entries: Entry[] };
type Entry = { id: string; title: string; tone?: SectionTone; el: () => HTMLElement | null; defaultOpen: boolean };

/** Estado de uma página: o que está aberto e quais seções existem (pro índice). */
export class SectionsStore {
  private open: Record<string, boolean> = {};
  private loaded = false;
  private entries: Entry[] = [];
  private listeners = new Set<() => void>();
  private snapshot: Snapshot = { open: {}, entries: [] };

  constructor(readonly page: string | null) {
    this.load();
  }

  /** Lê o localStorage uma vez (só no navegador). No servidor fica tudo no padrão. */
  private load() {
    if (this.loaded || typeof window === "undefined") return;
    this.loaded = true;
    if (this.page) this.open = { ...readSaved(this.page), ...this.open };
    this.snapshot = { open: { ...this.open }, entries: [...this.entries] };
  }

  private emit() {
    this.snapshot = { open: { ...this.open }, entries: [...this.entries] };
    for (const l of this.listeners) l();
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };

  getSnapshot = () => this.snapshot;

  isOpen(id: string, fallback: boolean): boolean {
    return this.snapshot.open[id] ?? fallback;
  }

  set(id: string, value: boolean) {
    this.setMany({ [id]: value });
  }

  setMany(values: Record<string, boolean>) {
    this.open = { ...this.open, ...values };
    if (this.page) writeSaved(this.page, this.open);
    this.emit();
  }

  setAll(value: boolean) {
    this.setMany(Object.fromEntries(this.entries.map((e) => [e.id, value])));
  }

  register(entry: Entry) {
    this.entries = [...this.entries.filter((e) => e.id !== entry.id), entry];
    // Ordem da tela, não a ordem em que cada seção montou.
    this.entries.sort((a, b) => {
      const x = a.el();
      const y = b.el();
      if (!x || !y) return 0;
      return x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
    this.emit();
    return () => {
      this.entries = this.entries.filter((e) => e !== entry);
      this.emit();
    };
  }
}

const SERVER_SNAPSHOT: Snapshot = { open: {}, entries: [] };
const Ctx = createContext<SectionsStore | null>(null);

function useStoreSnapshot(store: SectionsStore) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, () => SERVER_SNAPSHOT);
}

/** Envolve a página. `page` é a chave do localStorage (ex.: "whatsapp-agentes"). */
export function SectionsProvider({ page, children }: { page: string; children?: React.ReactNode }) {
  const [store] = useState(() => new SectionsStore(page));
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** Abre a seção e rola até ela. */
export function openAndScroll(store: SectionsStore | null, id: string) {
  // Abre também as seções em volta (um grupo dentro de um cartão fechado).
  const ids = [id];
  let parent = document.getElementById(id)?.parentElement?.closest<HTMLElement>("[data-secao]");
  while (parent) {
    ids.push(parent.id);
    parent = parent.parentElement?.closest<HTMLElement>("[data-secao]");
  }
  store?.setMany(Object.fromEntries(ids.map((x) => [x, true])));
  const go = () => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView?.({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
    document.getElementById(`${id}-botao`)?.focus({ preventScroll: true });
  };
  if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(go);
  else go();
}

/* ------------------------------------ cores do selo ------------------------------------ */

const TONE: Record<SectionTone, string> = {
  default: "bg-surface-hover text-muted",
  success: "bg-success/10 text-success",
  warning: "bg-warning/15 text-foreground",
  error: "bg-error/10 text-error",
  accent: "bg-accent/10 text-accent",
};

const DOT: Record<SectionTone, string> = {
  default: "bg-muted",
  success: "bg-success",
  warning: "bg-warning",
  error: "bg-error",
  accent: "bg-accent",
};

export function StatusBadgeChip({ badge }: { badge: SectionBadge }) {
  return (
    <span className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE[badge.tone ?? "default"]}`}>
      {badge.text}
    </span>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
      className={`h-4 w-4 shrink-0 text-muted transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
    >
      <path d="m5 8 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ------------------------------------ a seção ------------------------------------ */

export type CollapsibleSectionProps = {
  /** id do elemento na página (âncora do índice e chave do que fica lembrado). */
  id: string;
  title: React.ReactNode;
  /** Texto do chip no índice quando o título não é texto puro. */
  indexLabel?: string;
  /** Uma linha que aparece quando está fechada. Ex.: "2 cidades atendidas · 4 serviços". */
  summary?: React.ReactNode;
  /** Texto curto embaixo do título, só quando aberta. */
  description?: React.ReactNode;
  badge?: SectionBadge | null;
  /** Coisa usada sempre começa aberta; configuração rara começa fechada. */
  defaultOpen?: boolean;
  /** Erro, pendência ou algo pra conferir: abre sozinha quando aparece. */
  attention?: boolean;
  /** Botões ao lado do cabeçalho (ficam fora do botão de abrir). */
  actions?: React.ReactNode;
  /** "panel" (cartão da página) ou "group" (grupo dentro de um cartão). */
  variant?: "panel" | "group";
  className?: string;
  /** Fica fora do índice da página (ex.: grupos internos). */
  hideFromIndex?: boolean;
  headingLevel?: 2 | 3;
  children?: React.ReactNode;
};

export function CollapsibleSection({
  id,
  title,
  indexLabel,
  summary,
  description,
  badge,
  defaultOpen = true,
  attention = false,
  actions,
  variant = "panel",
  className = "",
  hideFromIndex = false,
  headingLevel,
  children,
}: CollapsibleSectionProps) {
  const ctx = useContext(Ctx);
  // Sem provider: estado só desta seção, na memória.
  const [local] = useState(() => ctx ?? new SectionsStore(null));
  const store = ctx ?? local;
  const snap = useStoreSnapshot(store);
  const open = snap.open[id] ?? defaultOpen;
  const rootRef = useRef<HTMLElement>(null);
  const contentId = `${id}-conteudo`;
  const buttonId = `${id}-botao`;
  const label = indexLabel ?? (typeof title === "string" ? title : id);
  const tone = attention ? (badge?.tone && badge.tone !== "default" ? badge.tone : "warning") : badge?.tone;

  // Aviso apareceu (ou já estava lá ao abrir a página): abre sozinha.
  const hadAttention = useRef(false);
  useEffect(() => {
    if (attention && !hadAttention.current) store.set(id, true);
    hadAttention.current = attention;
  }, [attention, id, store]);

  // Link com #id (ex.: /admin#chaves-ia) abre a seção.
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash === `#${id}`) store.set(id, true);
  }, [id, store]);

  useEffect(() => {
    if (hideFromIndex) return;
    return store.register({ id, title: label, tone, el: () => rootRef.current, defaultOpen });
  }, [store, id, label, tone, hideFromIndex, defaultOpen]);

  const toggle = useCallback(() => store.set(id, !open), [store, id, open]);

  function onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    const all = Array.from(document.querySelectorAll<HTMLButtonElement>("button[data-secao-botao]"));
    const i = all.indexOf(e.currentTarget);
    if (i < 0 || all.length < 2) return;
    e.preventDefault();
    const next = e.key === "Home" ? 0 : e.key === "End" ? all.length - 1 : (i + (e.key === "ArrowDown" ? 1 : -1) + all.length) % all.length;
    all[next].focus();
  }

  const H = (headingLevel ?? (variant === "group" ? 3 : 2)) === 2 ? "h2" : "h3";
  const shell =
    variant === "panel"
      ? `panel rounded-xl ${attention ? "border-warning/50" : ""}`
      : `rounded-lg border ${attention ? "border-warning/40 bg-warning/5" : "border-border"}`;
  const pad = variant === "panel" ? "px-4 sm:px-5" : "px-3";

  return (
    <section
      ref={rootRef}
      id={id}
      data-secao={id}
      data-aberta={open ? "sim" : "nao"}
      aria-labelledby={buttonId}
      className={`scroll-mt-20 ${shell} ${className}`}
      onInvalidCapture={() => {
        if (!open) store.set(id, true);
      }}
    >
      <div className={`flex items-start gap-2 ${pad} ${variant === "panel" ? "py-3.5 sm:py-4" : "py-2.5"}`}>
        <H className={`min-w-0 flex-1 ${variant === "panel" ? "text-base" : "text-sm"} font-semibold`}>
          <button
            type="button"
            id={buttonId}
            data-secao-botao=""
            aria-expanded={open}
            aria-controls={contentId}
            onClick={toggle}
            onKeyDown={onKeyDown}
            className="group flex w-full min-w-0 items-start gap-2 rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="min-w-0">{title}</span>
                {badge && <StatusBadgeChip badge={{ ...badge, tone }} />}
              </span>
              {!open && summary && (
                <span className="mt-0.5 block truncate text-xs font-normal text-muted" data-secao-resumo="">
                  {summary}
                </span>
              )}
            </span>
            <span className="mt-0.5 flex items-center">
              <Chevron open={open} />
            </span>
          </button>
        </H>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      <div
        id={contentId}
        role="region"
        aria-labelledby={buttonId}
        inert={!open}
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className={`space-y-3 ${pad} ${variant === "panel" ? "pb-4 sm:pb-5" : "pb-3"}`}>
            {description && <div className="text-sm text-muted">{description}</div>}
            {children}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------ índice ------------------------------------ */

/** Chips no topo da página + "Abrir tudo" / "Fechar tudo". Precisa do SectionsProvider. */
export function SectionIndex({ className = "", sticky = true }: { className?: string; sticky?: boolean }) {
  const t = useT();
  const ctx = useContext(Ctx);
  const [fallback] = useState(() => new SectionsStore(null));
  const store = ctx ?? fallback;
  const snap = useStoreSnapshot(store);
  const entries = snap.entries;
  const allOpen = useMemo(() => entries.length > 0 && entries.every((e) => snap.open[e.id] ?? e.defaultOpen), [entries, snap.open]);
  const allClosed = useMemo(() => entries.length > 0 && entries.every((e) => !(snap.open[e.id] ?? e.defaultOpen)), [entries, snap.open]);
  if (!ctx) return null;

  return (
    <div
      className={`${sticky ? "sticky top-0 z-20 bg-background/95 backdrop-blur" : ""} flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border py-2 sm:flex-nowrap ${className}`}
      data-secao-indice=""
    >
      <nav aria-label={t("On this page")} className="min-w-0 flex-1 basis-full sm:basis-auto">
        <ul className="flex min-w-0 gap-1.5 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {entries.map((e) => (
            <li key={e.id} className="shrink-0">
              <a
                href={`#${e.id}`}
                onClick={(ev) => {
                  ev.preventDefault();
                  openAndScroll(store, e.id);
                }}
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-surface-hover"
              >
                {e.tone && e.tone !== "default" && <span className={`h-1.5 w-1.5 rounded-full ${DOT[e.tone]}`} aria-hidden="true" />}
                {e.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => store.setAll(true)}
          disabled={allOpen}
          className="rounded-md px-2 py-1 text-xs font-semibold text-accent hover:bg-accent/10 disabled:text-muted disabled:hover:bg-transparent"
        >
          {t("Open all")}
        </button>
        <button
          type="button"
          onClick={() => store.setAll(false)}
          disabled={allClosed}
          className="rounded-md px-2 py-1 text-xs font-semibold text-accent hover:bg-accent/10 disabled:text-muted disabled:hover:bg-transparent"
        >
          {t("Close all")}
        </button>
      </div>
    </div>
  );
}

/** Pra telas que querem abrir uma seção por código (ex.: link "ver grupo" de um resumo). */
export function useSections(): SectionsStore | null {
  return useContext(Ctx);
}

/* ------------------------------------ chips de lista ------------------------------------ */

/**
 * Lista como chips editáveis (cidades, serviços). O valor continua sendo o
 * texto "um por linha" da tela, então nada muda na hora de salvar.
 */
export function ChipListInput({
  value,
  onChange,
  label,
  placeholder,
  hint,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  placeholder?: string;
  hint?: string;
  id?: string;
}) {
  const t = useT();
  const autoId = useId();
  const inputId = id ?? `chips-${autoId}`;
  const [draft, setDraft] = useState("");
  const items = value
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  function commit(raw: string) {
    const novos = raw
      .split(/\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (novos.length === 0) return;
    onChange([...items, ...novos].join("\n"));
    setDraft("");
  }

  function remove(i: number) {
    onChange(items.filter((_, j) => j !== i).join("\n"));
  }

  return (
    <div className="space-y-1">
      <label htmlFor={inputId} className="block text-sm font-medium">
        {label} <span className="font-normal text-muted">({items.length})</span>
      </label>
      <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-md border border-border bg-[#fafafa] px-2 py-1.5 focus-within:border-accent focus-within:bg-white">
        {items.map((item, i) => (
          <span key={`${item}-${i}`} className="inline-flex max-w-full items-center gap-1 rounded-full bg-surface-hover px-2.5 py-0.5 text-xs">
            <span className="truncate">{item}</span>
            <button
              type="button"
              onClick={() => remove(i)}
              aria-label={t("Remove {item}", { item })}
              className="-mr-1 rounded-full px-1 text-muted hover:bg-border hover:text-foreground"
            >
              ×
            </button>
          </span>
        ))}
        <input
          id={inputId}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit(draft);
            } else if (e.key === "Backspace" && draft === "" && items.length > 0) {
              remove(items.length - 1);
            }
          }}
          onBlur={() => commit(draft)}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text");
            if (text.includes("\n")) {
              e.preventDefault();
              commit(text);
            }
          }}
          placeholder={items.length === 0 && placeholder ? placeholder : t("Type and press Enter")}
          className="min-w-[8rem] flex-1 bg-transparent px-1 py-0.5 text-sm outline-none placeholder:text-zinc-500"
        />
      </div>
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </div>
  );
}
