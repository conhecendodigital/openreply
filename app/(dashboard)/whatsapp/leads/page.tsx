"use client";

/**
 * WhatsApp > Leads (06/10/2026, pedido do dono: "classificação do lead no CRM
 * automática, se é qualificado ou não, de acordo com as regras do agente").
 *
 * Quadro em colunas por estágio (Novo, Em qualificação, Qualificado, Para
 * analisar, Fora do perfil, Cliente, Sem resposta), com contagem, filtros
 * (número, estágio, período, busca), cartão com a ficha resumida e link pra
 * conversa. Arrastar o cartão (ou escolher no select do cartão) muda o
 * estágio na mão: vence o agente e fica marcado como manual até chegar fato
 * novo. Exporta os leads e o histórico de estágio em CSV.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useT } from "@/components/lang-provider";
import { STAGE_KEYS, StageBadge, useStageName, type LeadStage } from "@/components/whatsapp/lead";
import { api, btnPrimary, btnSecondary, formatPhone, INPUT, ServerNotice, shortTime, useServerStatus, WhatsAppTabs } from "@/components/whatsapp/ui";

type Card = {
  conversationId: string;
  sessionId: string;
  contact: { name: string | null; pushName: string | null; phoneE164: string | null };
  stage: LeadStage;
  reason: string | null;
  manual: boolean;
  summary: string;
  lastMessageAt: string | null;
  stageAt: string | null;
};
type Board = {
  sessions: Array<{ id: string; label: string }>;
  sessionId: string | null;
  columns: Array<{ stage: LeadStage; name: string; count: number; cards: Card[] }>;
  total: number;
};

const POLL_MS = 15_000;

function cardName(c: Card): string {
  return c.contact.name || c.contact.pushName || formatPhone(c.contact.phoneE164) || "WhatsApp";
}

export default function WhatsAppLeadsPage() {
  const t = useT();
  const server = useServerStatus();
  const stageName = useStageName();
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState("");
  const [stage, setStage] = useState<LeadStage | "">("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<LeadStage | null>(null);
  const [move, setMove] = useState<{ card: Card; to: LeadStage } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query.trim()), 300);
    return () => window.clearTimeout(id);
  }, [query]);

  const params = useCallback(() => {
    const p = new URLSearchParams();
    if (sessionId) p.set("sessionId", sessionId);
    if (stage) p.set("stage", stage);
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (debounced) p.set("q", debounced);
    return p;
  }, [sessionId, stage, from, to, debounced]);

  const load = useCallback(async () => {
    const r = await api<Board>(`/api/whatsapp/leads?${params()}`);
    if (r.ok) {
      setBoard(r.data);
      setError(null);
    } else setError(t(r.error));
  }, [params, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga e atualização do quadro
    void load();
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  function findCard(id: string): Card | null {
    for (const col of board?.columns ?? []) {
      const c = col.cards.find((x) => x.conversationId === id);
      if (c) return c;
    }
    return null;
  }

  function askMove(card: Card, toStage: LeadStage) {
    if (card.stage === toStage) return;
    setMove({ card, to: toStage });
    setReason("");
    setMoveError(null);
  }

  async function confirmMove() {
    if (!move) return;
    setBusy(true);
    setMoveError(null);
    const r = await api(`/api/whatsapp/conversations/${move.card.conversationId}/lead`, {
      method: "POST",
      body: JSON.stringify({ action: "stage", stage: move.to, reason: reason.trim() || undefined }),
    });
    setBusy(false);
    if (!r.ok) return setMoveError(t(r.error));
    setMove(null);
    void load();
  }

  const exportHref = (kind: "leads" | "history") => {
    const p = params();
    p.set("kind", kind);
    return `/api/whatsapp/leads/export?${p}`;
  };

  return (
    <div className="space-y-4 pb-10">
      <div className="space-y-3">
        <h1 className="text-lg font-semibold text-foreground">{t("WhatsApp")}</h1>
        <WhatsAppTabs active="leads" />
      </div>
      <ServerNotice status={server} />
      <p className="text-sm text-muted">{t("The agent sets the stage by the rules of this number. A change you make wins and stays marked as manual until a new fact comes in.")}</p>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <select value={sessionId} onChange={(e) => setSessionId(e.target.value)} aria-label={t("Number")} className={`${INPUT} h-9 py-0`}>
          <option value="">{t("All numbers")}</option>
          {(board?.sessions ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.label.startsWith("+") ? formatPhone(s.label) : s.label}
            </option>
          ))}
        </select>
        <select value={stage} onChange={(e) => setStage(e.target.value as LeadStage | "")} aria-label={t("Stage")} className={`${INPUT} h-9 py-0`}>
          <option value="">{t("Any stage")}</option>
          {STAGE_KEYS.map((k) => (
            <option key={k} value={k}>
              {stageName(k, board?.columns.find((c) => c.stage === k)?.name)}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-xs text-muted">
          <span className="shrink-0">{t("From")}</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={`${INPUT} h-9 py-0`} />
        </label>
        <label className="flex items-center gap-2 text-xs text-muted">
          <span className="shrink-0">{t("To")}</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={`${INPUT} h-9 py-0`} />
        </label>
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Search name or number")} aria-label={t("Search leads")} className={`${INPUT} h-9 py-0`} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm text-muted">{board ? t("{n} leads", { n: board.total }) : ""}</p>
        <a href={exportHref("leads")} className={`${btnSecondary} px-3 py-1.5 text-xs`}>
          {t("Export CSV")}
        </a>
        <a href={exportHref("history")} className={`${btnSecondary} px-3 py-1.5 text-xs`}>
          {t("Export stage history")}
        </a>
      </div>

      {error && <div className="rounded-xl border border-error/20 bg-error/10 p-4 text-sm text-error">{error}</div>}
      {!board && !error && <div className="panel h-56 animate-pulse rounded-xl" />}

      {board && (
        <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 lg:mx-0 lg:px-0">
          {board.columns.map((col) => (
            <section
              key={col.stage}
              aria-label={stageName(col.stage, col.name)}
              onDragOver={(e) => {
                if (!dragging) return;
                e.preventDefault();
                setOver(col.stage);
              }}
              onDragLeave={() => setOver((cur) => (cur === col.stage ? null : cur))}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData("text/plain") || dragging;
                setOver(null);
                setDragging(null);
                const card = id ? findCard(id) : null;
                if (card) askMove(card, col.stage);
              }}
              className={`flex w-[80vw] max-w-[300px] shrink-0 snap-start flex-col rounded-xl border p-2 sm:w-[280px] ${over === col.stage ? "border-accent bg-accent/5" : "border-border bg-surface-hover/50"}`}
            >
              <header className="flex items-center justify-between gap-2 px-1 pb-2">
                <StageBadge stage={col.stage} name={col.name} />
                <span className="text-xs font-semibold text-muted">{col.count}</span>
              </header>
              <div className="min-h-[60px] space-y-2">
                {col.cards.length === 0 && <p className="px-1 py-3 text-center text-xs text-muted">{t("No lead here.")}</p>}
                {col.cards.map((c) => (
                  <article
                    key={c.conversationId}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", c.conversationId);
                      e.dataTransfer.effectAllowed = "move";
                      setDragging(c.conversationId);
                    }}
                    onDragEnd={() => {
                      setDragging(null);
                      setOver(null);
                    }}
                    className={`cursor-grab space-y-1.5 rounded-lg border border-border bg-white p-2.5 text-sm shadow-sm ${dragging === c.conversationId ? "opacity-50" : ""}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{cardName(c)}</p>
                        <p className="truncate text-xs text-muted">{formatPhone(c.contact.phoneE164)}</p>
                      </div>
                      <span className="shrink-0 text-[11px] text-zinc-500">{shortTime(c.lastMessageAt)}</span>
                    </div>
                    {c.manual && <StageBadge stage={c.stage} name={col.name} manual />}
                    {c.reason && <p className="line-clamp-2 text-xs text-muted">{c.reason}</p>}
                    {c.summary && <p className="line-clamp-3 text-xs text-foreground">{c.summary}</p>}
                    <div className="flex items-center gap-2 pt-1">
                      <select
                        value=""
                        onChange={(e) => e.target.value && askMove(c, e.target.value as LeadStage)}
                        aria-label={t("Move {name} to another stage", { name: cardName(c) })}
                        className="h-7 min-w-0 flex-1 rounded-md border border-border bg-surface-hover px-1.5 text-xs"
                      >
                        <option value="">{t("Move to…")}</option>
                        {board.columns
                          .filter((x) => x.stage !== c.stage)
                          .map((x) => (
                            <option key={x.stage} value={x.stage}>
                              {stageName(x.stage, x.name)}
                            </option>
                          ))}
                      </select>
                      <Link href={`/whatsapp/inbox?c=${encodeURIComponent(c.conversationId)}`} className="shrink-0 text-xs font-semibold text-accent hover:underline">
                        {t("Open conversation")}
                      </Link>
                    </div>
                  </article>
                ))}
                {col.count > col.cards.length && <p className="px-1 text-center text-[11px] text-muted">{t("Showing {n} of {total}. Use the filters to see the rest.", { n: col.cards.length, total: col.count })}</p>}
              </div>
            </section>
          ))}
        </div>
      )}

      {move && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label={t("Change the stage")}>
          <div className="w-full max-w-sm space-y-3 rounded-xl bg-white p-4 shadow-lg">
            <p className="text-sm font-semibold">
              {t("Move {name} to {stage}?", { name: cardName(move.card), stage: stageName(move.to, board?.columns.find((c) => c.stage === move.to)?.name) })}
            </p>
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder={t("Reason (optional)")} aria-label={t("Reason (optional)")} className={INPUT} autoFocus />
            <p className="text-xs text-muted">{t("It stays marked as manual: the agent only changes it again when a new fact comes in.")}</p>
            {moveError && <p className="text-xs text-error">{moveError}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className={`${btnSecondary} px-3 py-1.5 text-xs`} onClick={() => setMove(null)} disabled={busy}>
                {t("Cancel")}
              </button>
              <button type="button" className={`${btnPrimary} px-3 py-1.5 text-xs`} onClick={() => void confirmMove()} disabled={busy}>
                {busy ? t("Wait…") : t("Change")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
