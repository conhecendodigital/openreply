"use client";

/**
 * WhatsApp > Conversas (06/10/2026). Inbox estilo WhatsApp Web:
 * - à esquerda: busca (nome, número ou texto), filtros Todas / Não lidas /
 *   Rascunhos, última mensagem, hora e bolinha de não lidas;
 * - à direita: bolhas, mídia (buscada no gateway na hora), tiques de enviado,
 *   entregue e lido, resposta humana, pausar e retomar o agente de IA nessa
 *   conversa, rascunho do agente (aprovar, editar, recusar) e aviso quando a
 *   janela de 24 horas fechou;
 * - no celular vira lista -> conversa.
 *
 * Tempo real por polling curto (lista a cada 5 s, conversa aberta a cada 3 s):
 * é o que funciona com a infraestrutura de hoje, sem SSE nem buffering no Traefik.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/components/lang-provider";
import { api, btnPrimary, btnSecondary, ConfirmBox, formatPhone, ServerNotice, shortTime, useServerStatus, WhatsAppTabs } from "@/components/whatsapp/ui";

type Contact = { id: string; name: string | null; pushName: string | null; phoneE164: string | null; isGroup: boolean };
type Conversation = {
  id: string;
  sessionId: string;
  contact: Contact;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  hasDraft: boolean;
  paused: boolean;
};
type Message = {
  id: string;
  fromMe: boolean;
  sentBy: string;
  type: string;
  body: string | null;
  ack: string;
  sentAt: string;
  media: { mime: string | null; filename: string | null } | null;
  revoked: boolean;
};
type Draft = { runId: string; bubbles: string[]; alert: string | null; agente: string | null; createdAt: string };
type Thread = {
  conversation: Conversation & { agentMode: string; humanTakeoverUntil: string | null };
  session: { id: string; status: string; phoneE164: string | null; displayName: string | null; agentMode: string };
  messages: Message[];
  window: { open: boolean; closesAt: string | null };
  draft: Draft | null;
};

const LIST_POLL_MS = 5_000;
const THREAD_POLL_MS = 3_000;

function contactName(c: Contact): string {
  return c.name || c.pushName || formatPhone(c.phoneE164) || "WhatsApp";
}

function initials(c: Contact): string {
  const n = (c.name || c.pushName || "").trim();
  if (!n) return "#";
  const parts = n.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

function Ticks({ ack }: { ack: string }) {
  const t = useT();
  if (ack === "failed") return <span className="text-[11px] text-error" title={t("Not sent")}>!</span>;
  const double = ack === "delivered" || ack === "read";
  const color = ack === "read" ? "text-[#53bdeb]" : "text-zinc-400";
  const label = ack === "read" ? t("Read") : ack === "delivered" ? t("Delivered") : ack === "sent" ? t("Sent") : t("Sending");
  return (
    <span className={`inline-flex ${color}`} title={label} aria-label={label}>
      <svg viewBox="0 0 18 12" className="h-3 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {ack === "pending" ? <circle cx="9" cy="6" r="4" /> : <path d="M1.5 6.5 5 10l7-8" />}
        {double && <path d="M7.5 9.5 8 10l7-8" />}
      </svg>
    </span>
  );
}

function MediaView({ m }: { m: Message }) {
  const t = useT();
  const src = `/api/whatsapp/media/${m.id}`;
  const mime = m.media?.mime ?? "";
  if (m.type === "image" || m.type === "sticker" || mime.startsWith("image/")) {
    return (
      <a href={src} target="_blank" rel="noreferrer" className="block">
        {/* eslint-disable-next-line @next/next/no-img-element -- mídia buscada no gateway na hora */}
        <img src={src} alt={t("Photo sent in the conversation")} loading="lazy" className={`${m.type === "sticker" ? "h-32 w-32 object-contain" : "max-h-72 w-auto max-w-[260px] rounded-lg object-cover"}`} />
      </a>
    );
  }
  if (m.type === "video" || mime.startsWith("video/")) {
    return <video src={src} controls playsInline preload="metadata" className="max-h-80 w-[240px] rounded-lg bg-black" />;
  }
  if (m.type === "audio" || mime.startsWith("audio/")) {
    return <audio src={src} controls preload="metadata" className="h-10 w-60 max-w-full" />;
  }
  return (
    <a href={src} className="inline-flex items-center gap-2 rounded-md bg-black/5 px-3 py-2 text-sm underline">
      {m.media?.filename || t("File")} ↓
    </a>
  );
}

export default function WhatsAppInboxPage() {
  const t = useT();
  const server = useServerStatus();
  const [filter, setFilter] = useState<"all" | "unread" | "drafts">("all");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [list, setList] = useState<Conversation[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [thread, setThread] = useState<Thread | null>(null);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ id: string; text: string; at: string }[]>([]);
  const [confirmAuto, setConfirmAuto] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastCount = useRef(0);

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query.trim()), 300);
    return () => window.clearTimeout(id);
  }, [query]);

  const loadList = useCallback(async () => {
    const params = new URLSearchParams();
    if (filter !== "all") params.set("filter", filter);
    if (debounced) params.set("q", debounced);
    const r = await api<{ conversations: Conversation[] }>(`/api/whatsapp/conversations?${params}`);
    if (r.ok) {
      setList(r.data.conversations);
      setListError(null);
    } else setListError(t(r.error));
  }, [filter, debounced, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga e polling da lista
    void loadList();
    const timer = window.setInterval(() => void loadList(), LIST_POLL_MS);
    return () => window.clearInterval(timer);
  }, [loadList]);

  const loadThread = useCallback(
    async (id: string) => {
      const r = await api<Thread>(`/api/whatsapp/conversations/${id}`);
      if (r.ok) {
        setThread((cur) => (cur?.conversation.id === id || !cur ? r.data : cur));
        setThreadError(null);
        // O que já voltou do servidor sai da lista de "enviando".
        setPending((cur) => cur.filter((p) => !r.data.messages.some((m) => m.fromMe && m.body === p.text)));
        if (r.data.conversation.unreadCount > 0) {
          void api(`/api/whatsapp/conversations/${id}/read`, { method: "POST" });
        }
      } else setThreadError(t(r.error));
    },
    [t]
  );

  useEffect(() => {
    if (!activeId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga e polling da conversa aberta
    void loadThread(activeId);
    const timer = window.setInterval(() => void loadThread(activeId), THREAD_POLL_MS);
    return () => window.clearInterval(timer);
  }, [activeId, loadThread]);

  // Rola pro fim quando chega mensagem nova.
  const messageCount = (thread?.messages.length ?? 0) + pending.length;
  useEffect(() => {
    if (messageCount !== lastCount.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    lastCount.current = messageCount;
  }, [messageCount]);

  function open(id: string) {
    setActiveId(id);
    setThread(null);
    setThreadError(null);
    setSendError(null);
    setPending([]);
    setText("");
    setList((cur) => (cur ?? []).map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c)));
  }

  async function send() {
    const body = text.trim();
    if (!body || !activeId || sending) return;
    setSending(true);
    setSendError(null);
    const tempId = `tmp-${Date.now()}`;
    setPending((cur) => [...cur, { id: tempId, text: body, at: new Date().toISOString() }]);
    setText("");
    const r = await api<{ queued: true; pausedUntil: string }>(`/api/whatsapp/conversations/${activeId}/messages`, {
      method: "POST",
      body: JSON.stringify({ text: body }),
    });
    setSending(false);
    if (!r.ok) {
      setPending((cur) => cur.filter((p) => p.id !== tempId));
      setText(body);
      setSendError(t(r.error));
      return;
    }
    void loadThread(activeId);
  }

  async function agent(action: "pause" | "resume" | "auto_on" | "auto_off") {
    if (!activeId) return;
    const r = await api<{ humanTakeoverUntil: string | null; agentMode: string }>(`/api/whatsapp/conversations/${activeId}/agent`, {
      method: "POST",
      body: JSON.stringify({ action }),
    });
    if (!r.ok) return setSendError(t(r.error));
    setConfirmAuto(false);
    void loadThread(activeId);
    void loadList();
  }

  const active = thread && thread.conversation.id === activeId ? thread : null;
  const activeItem = useMemo(() => list?.find((c) => c.id === activeId) ?? null, [list, activeId]);
  const paused = Boolean(active?.conversation.humanTakeoverUntil && new Date(active.conversation.humanTakeoverUntil) > new Date());
  const agentOnForNumber = active ? active.session.agentMode !== "OFF" && active.session.agentMode !== "INHERIT" : false;

  return (
    <div className="space-y-3">
      <div className="space-y-3">
        <h1 className="text-lg font-semibold text-foreground">{t("WhatsApp")}</h1>
        <WhatsAppTabs active="inbox" />
      </div>
      <ServerNotice status={server} />

      <div className="grid h-[calc(100dvh-13rem)] min-h-[420px] grid-cols-1 overflow-hidden rounded-xl border border-border sm:grid-cols-[340px_1fr]">
        {/* Lista. No celular some quando uma conversa está aberta. */}
        <div className={`min-h-0 flex-col border-border sm:flex sm:border-r ${activeId ? "hidden" : "flex"}`}>
          <div className="shrink-0 space-y-2 border-b border-border p-3">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("Search name, number or message")}
              aria-label={t("Search conversations")}
              className="h-9 w-full rounded-lg border border-border bg-surface-hover px-3 text-sm placeholder:text-zinc-500 focus:border-accent/40 focus:bg-white focus:outline-none"
            />
            <div className="flex gap-1.5" role="group" aria-label={t("Filter")}>
              {(
                [
                  ["all", t("All chats")],
                  ["unread", t("Unread")],
                  ["drafts", t("Drafts")],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilter(key)}
                  aria-pressed={filter === key}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${filter === key ? "bg-[#25d366]/15 text-[#0a7c3b]" : "bg-surface-hover text-muted hover:text-foreground"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {list === null && !listError ? (
              <p className="px-4 py-6 text-sm text-muted">{t("Loading…")}</p>
            ) : listError ? (
              <p className="px-4 py-6 text-sm text-error">{listError}</p>
            ) : list && list.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted">
                {debounced || filter !== "all" ? t("Nothing found.") : t("No WhatsApp conversations yet. When someone writes to your number, it shows up here.")}
              </p>
            ) : (
              (list ?? []).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => open(c.id)}
                  className={`flex w-full items-center gap-3 border-b border-border px-3 py-3 text-left ${c.id === activeId ? "bg-surface-hover" : "hover:bg-surface-hover"}`}
                >
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-zinc-200 text-sm font-semibold text-zinc-600" aria-hidden="true">
                    {initials(c.contact)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className={`truncate text-sm ${c.unreadCount > 0 ? "font-bold" : "font-medium"} text-foreground`}>{contactName(c.contact)}</span>
                      <span className={`shrink-0 text-[11px] ${c.unreadCount > 0 ? "font-semibold text-[#1fa855]" : "text-zinc-500"}`}>{shortTime(c.lastMessageAt)}</span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-xs text-muted">{c.lastMessagePreview || " "}</span>
                      {c.hasDraft && (
                        <span className="shrink-0 rounded-full bg-accent px-1.5 py-px text-[10px] font-semibold text-white" title={t("AI draft waiting for your approval")}>
                          {t("Draft")}
                        </span>
                      )}
                      {c.paused && <span className="shrink-0 text-[10px] font-semibold text-muted">{t("Paused")}</span>}
                      {c.unreadCount > 0 && (
                        <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-[#25d366] px-1.5 text-[11px] font-bold text-white" aria-label={t("{n} unread", { n: c.unreadCount })}>
                          {c.unreadCount > 99 ? "99+" : c.unreadCount}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Conversa */}
        <div className={`min-h-0 flex-col bg-[#efeae2] ${activeId ? "flex" : "hidden sm:flex"}`}>
          {!activeId ? (
            <div className="flex flex-1 items-center justify-center bg-surface p-6 text-center text-sm text-muted">
              {t("Select a conversation to read and reply.")}
            </div>
          ) : (
            <>
              <div className="flex shrink-0 items-center gap-2 border-b border-border bg-surface px-3 py-2.5">
                <button type="button" onClick={() => setActiveId(null)} className="rounded px-2 py-1 text-sm text-muted hover:text-foreground sm:hidden" aria-label={t("Back to conversations")}>
                  {t("Back")}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{activeItem ? contactName(activeItem.contact) : active ? contactName(active.conversation.contact) : ""}</p>
                  <p className="truncate text-xs text-muted">
                    {formatPhone(active?.conversation.contact.phoneE164 ?? activeItem?.contact.phoneE164 ?? null)}
                    {active?.window.open && active.window.closesAt ? ` · ${t("You can answer until {time}", { time: shortTime(active.window.closesAt) })}` : ""}
                  </p>
                </div>
                {active && agentOnForNumber && (
                  <div className="flex shrink-0 items-center gap-1.5">
                    {paused ? (
                      <button type="button" className={`${btnSecondary} px-3 py-1.5 text-xs`} onClick={() => void agent("resume")}>
                        {t("Resume agent")}
                      </button>
                    ) : (
                      <button type="button" className={`${btnSecondary} px-3 py-1.5 text-xs`} onClick={() => void agent("pause")}>
                        {t("Pause agent")}
                      </button>
                    )}
                    {active.conversation.agentMode === "AUTO" ? (
                      <button type="button" className={`${btnSecondary} px-3 py-1.5 text-xs`} onClick={() => void agent("auto_off")} title={t("Back to drafts: you approve each answer")}>
                        {t("Automatic on")}
                      </button>
                    ) : (
                      <button type="button" className={`${btnSecondary} hidden px-3 py-1.5 text-xs md:inline-flex`} onClick={() => setConfirmAuto(true)}>
                        {t("Send by itself")}
                      </button>
                    )}
                  </div>
                )}
              </div>
              {active && paused && (
                <p className="shrink-0 border-b border-border bg-surface-hover px-4 py-2 text-xs text-muted">
                  {t("The AI agent is paused in this conversation until {time}. You answer.", { time: shortTime(active.conversation.humanTakeoverUntil) })}
                </p>
              )}

              <div ref={scrollRef} className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 py-4 sm:px-8">
                {!active && !threadError && <p className="text-center text-sm text-muted">{t("Loading…")}</p>}
                {threadError && <p className="text-center text-sm text-error">{threadError}</p>}
                {active?.messages.length === 0 && pending.length === 0 && <p className="text-center text-sm text-muted">{t("No messages.")}</p>}
                {active?.messages.map((m) => (
                  <div key={m.id} className={`flex ${m.fromMe ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[85%] rounded-lg px-2.5 py-1.5 text-sm shadow-sm sm:max-w-[65%] ${m.fromMe ? "bg-[#d9fdd3] text-foreground" : "bg-white text-foreground"}`}>
                      {m.fromMe && m.sentBy !== "USER_APP" && (
                        <p className="mb-0.5 text-[10px] font-semibold text-[#0a7c3b]">
                          {m.sentBy === "AGENT" ? t("AI agent") : t("From the phone")}
                        </p>
                      )}
                      {m.revoked ? (
                        <p className="italic text-muted">{t("Message deleted")}</p>
                      ) : (
                        <>
                          {m.media && <div className="mb-1"><MediaView m={m} /></div>}
                          {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                          {!m.body && !m.media && <p className="italic text-muted">{t("Message type not shown here (sticker, location or reaction)")}</p>}
                        </>
                      )}
                      <p className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-zinc-500">
                        {shortTime(m.sentAt)}
                        {m.fromMe && <Ticks ack={m.ack} />}
                      </p>
                    </div>
                  </div>
                ))}
                {pending.map((p) => (
                  <div key={p.id} className="flex justify-end">
                    <div className="max-w-[85%] rounded-lg bg-[#d9fdd3]/70 px-2.5 py-1.5 text-sm shadow-sm sm:max-w-[65%]">
                      <p className="whitespace-pre-wrap break-words">{p.text}</p>
                      <p className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-zinc-500">
                        {t("Sending…")} <Ticks ack="pending" />
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="shrink-0 border-t border-border bg-surface p-3">
                {active?.draft && (
                  <DraftCard
                    key={active.draft.runId}
                    draft={active.draft}
                    windowOpen={active.window.open}
                    onDone={() => {
                      void loadThread(active.conversation.id);
                      void loadList();
                    }}
                  />
                )}
                {active && !active.window.open ? (
                  <p className="rounded-lg bg-warning/10 px-3 py-2 text-sm text-foreground" role="status">
                    {t("The 24 hour window is closed. WhatsApp only lets you answer within 24 hours of the contact's last message. When they write again, you can answer.")}
                  </p>
                ) : active && active.session.status !== "CONNECTED" ? (
                  <p className="rounded-lg bg-error/10 px-3 py-2 text-sm text-error" role="status">
                    {t("This number is disconnected. Reconnect it in Connections to answer.")}
                  </p>
                ) : (
                  <>
                    {sendError && <p className="mb-2 text-xs text-error">{sendError}</p>}
                    <div className="flex items-end gap-2">
                      <textarea
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            void send();
                          }
                        }}
                        rows={1}
                        maxLength={4000}
                        placeholder={t("Write a message (Enter sends, Shift+Enter breaks the line)")}
                        aria-label={t("Message")}
                        className="max-h-32 min-h-[42px] flex-1 resize-none rounded-lg border border-border bg-white px-3 py-2.5 text-sm placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
                      />
                      <button type="button" onClick={() => void send()} disabled={sending || !text.trim() || !active} className={`${btnPrimary} h-[42px]`}>
                        {t("Send")}
                      </button>
                    </div>
                    {agentOnForNumber && !paused && <p className="mt-1.5 text-[11px] text-muted">{t("When you answer here, the AI agent pauses in this conversation for 24 hours.")}</p>}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {confirmAuto && (
        <ConfirmBox
          title={t("Let the agent send by itself in this conversation?")}
          confirmLabel={t("Turn on")}
          onCancel={() => setConfirmAuto(false)}
          onConfirm={() => void agent("auto_on")}
          body={
            <>
              <p>{t("The agent answers without waiting for your approval, with a human delay before each message.")}</p>
              <p>{t("It still stops when you answer, pauses at quiet hours and respects the 24 hour window and the daily AI spending cap.")}</p>
            </>
          }
        />
      )}
    </div>
  );
}

function DraftCard({ draft, windowOpen, onDone }: { draft: Draft; windowOpen: boolean; onDone: () => void }) {
  const t = useT();
  const [bubbles, setBubbles] = useState(draft.bubbles);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(action: "approve" | "reject") {
    setBusy(true);
    setError(null);
    const r = await api(`/api/whatsapp/drafts/${draft.runId}`, {
      method: "POST",
      body: JSON.stringify(action === "approve" ? { action, bubbles: bubbles.map((b) => b.trim()).filter(Boolean) } : { action }),
    });
    setBusy(false);
    if (!r.ok) return setError(t(r.error));
    onDone();
  }

  return (
    <div className="mb-3 max-h-[45dvh] space-y-2 overflow-y-auto rounded-lg border border-accent/30 bg-accent/5 p-3">
      <p className="text-xs font-semibold text-accent">{t("AI draft: nothing is sent until you approve")}</p>
      {draft.alert && <p className="rounded-md bg-warning/10 px-2 py-1 text-xs text-foreground">{t(draft.alert)}</p>}
      {bubbles.map((b, i) => (
        <textarea
          key={i}
          value={b}
          onChange={(e) => setBubbles((cur) => cur.map((x, j) => (j === i ? e.target.value : x)))}
          rows={Math.min(5, Math.max(2, Math.ceil(b.length / 60)))}
          aria-label={t("Message {n} of the draft", { n: i + 1 })}
          className="w-full resize-y rounded-md border border-border bg-white px-2.5 py-2 text-sm focus:border-accent/40 focus:outline-none"
        />
      ))}
      {error && <p className="text-xs text-error">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={`${btnSecondary} px-3 py-1.5 text-xs`} onClick={() => void decide("reject")} disabled={busy}>
          {t("Discard")}
        </button>
        <button type="button" className={`${btnPrimary} px-3 py-1.5 text-xs`} onClick={() => void decide("approve")} disabled={busy || !windowOpen || !bubbles.some((b) => b.trim())}>
          {busy ? t("Wait…") : t("Approve and send")}
        </button>
      </div>
    </div>
  );
}
