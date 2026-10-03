"use client";

/**
 * Inbox
 *
 * Instagram DM conversations for the selected account, with live message
 * history and a reply composer. Messages are read from the Conversations API
 * (Meta only exposes the 20 most recent per thread) and refreshed by polling.
 * Sending is subject to Instagram's 24-hour messaging window — Meta's error is
 * surfaced verbatim when it applies.
 *
 * 2026-10-04 (Etapa 2): a pending AI draft shows as a card above the composer
 * (edit, approve and send, discard), the list marks people with a draft, and
 * the thread header has "Take over" / "Hand back to automation" plus the
 * 24-hour window. Nothing the AI wrote is sent without that click.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import AccountSelect, { type AccountOption } from "@/components/account-select";
import { readCache, writeCache } from "@/lib/client-cache";
import type { ConversationListItem } from "@/app/api/instagram/conversations/route";
import type { ThreadMessage } from "@/app/api/instagram/conversations/[id]/route";

import { useT } from "@/components/lang-provider";
import {
  DraftCard,
  TakeoverToggle,
  WindowBadge,
  type Draft,
  type MessagingWindow,
  type TakeoverState,
} from "@/components/messaging-ui";

// The person behind the open thread, as the CRM knows them.
type ThreadContact = { id: string; window: MessagingWindow | null; takeover: TakeoverState | null };

const POLL_MS = 12_000;
// Cached list/threads are shown instantly on revisit, then revalidated in the
// background. The Instagram Conversations API is slow (often several seconds),
// so this is what makes the inbox feel fast after the first load.
const CACHE_MAX_AGE_MS = 60_000;
const convCacheKey = (accountId: string) => `inbox:convs:${accountId}`;
const msgCacheKey = (conversationId: string) => `inbox:msgs:${conversationId}`;

// Photos, videos and audio the person sent, plus shared posts and story
// replies. Meta's media URLs are short-lived, so they are only rendered.
function MessageMediaList({
  media,
  fromMe,
}: {
  media: NonNullable<ThreadMessage["media"]>;
  fromMe: boolean;
}) {
  const t = useT();
  const linkClass = `underline ${fromMe ? "text-white" : "text-accent"}`;
  return (
    <div className={`flex flex-col gap-1.5 ${fromMe ? "items-end" : "items-start"}`}>
      {media.map((item, index) => {
        const key = `${item.url}-${index}`;
        if (item.type === "image") {
          return (
            <a key={key} href={item.url} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element -- saved DM media / Meta CDN, not optimizable */}
              <img
                src={item.url}
                alt={t("Photo sent in the conversation")}
                className="max-h-80 w-auto max-w-[260px] rounded-2xl border border-border object-cover"
                loading="lazy"
              />
            </a>
          );
        }
        if (item.type === "video") {
          return (
            <video
              key={key}
              src={item.url}
              poster={item.previewUrl}
              controls
              playsInline
              preload="metadata"
              className="max-h-96 w-[240px] rounded-2xl border border-border bg-black"
            />
          );
        }
        if (item.type === "audio") {
          return (
            <div key={key} className={`rounded-full px-2 py-1 ${fromMe ? "bg-accent" : "bg-surface border border-border"}`}>
              <audio src={item.url} controls preload="metadata" className="h-9 w-56" />
            </div>
          );
        }
        if (item.type === "story") {
          return <StoryMedia key={key} url={item.url} />;
        }
        const label = item.type === "share" ? t("Shared post") : t("File");
        return (
          <a key={key} href={item.url} target="_blank" rel="noreferrer" className={linkClass}>
            {label} ↗
          </a>
        );
      })}
    </div>
  );
}

// A story can be a photo or a video and the payload does not say which: try
// as an image, fall back to video, then to a plain link (expired story).
function StoryMedia({ url }: { url: string }) {
  const t = useT();
  const [modo, setModo] = useState<"img" | "video" | "link">("img");
  if (modo === "link") {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="text-xs text-accent underline">
        {t("Story (may have expired) ↗")}
      </a>
    );
  }
  if (modo === "video") {
    return (
      <video
        src={url}
        controls
        playsInline
        preload="metadata"
        onError={() => setModo("link")}
        className="max-h-80 w-[180px] rounded-2xl border border-border bg-black"
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- saved DM media / Meta CDN, not optimizable
    <img
      src={url}
      alt={t("Story")}
      onError={() => setModo("video")}
      className="max-h-80 w-[180px] rounded-2xl border border-border object-cover"
      loading="lazy"
    />
  );
}

function formatTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function InboxPage() {
  const t = useT();
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  // Seed from the last-used account so a revisit can paint the cached
  // conversation list immediately, before the account list even loads.
  const [selectedAccountId, setSelectedAccountId] = useState(() => {
    if (typeof window === "undefined") return "";
    return window.sessionStorage.getItem("inbox:selectedAccount") ?? "";
  });

  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [convLoading, setConvLoading] = useState(true);
  const [convError, setConvError] = useState<string | null>(null);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Pending AI drafts of this account, by the person's Instagram id.
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  const [threadContact, setThreadContact] = useState<ThreadContact | null>(null);

  const active = conversations.find((c) => c.id === activeId) ?? null;
  // conversation id → the other person's id, so the thread can load the saved history
  const contactsRef = useRef<Record<string, string>>({});
  useEffect(() => {
    for (const c of conversations) if (c.contact.id) contactsRef.current[c.id] = c.contact.id;
  }, [conversations]);

  // Deep link from a contact (/inbox?account=<id>&contact=<igsid>): pick that
  // account and open the person's conversation once the list loads.
  const deepLinkRef = useRef<{ account: string | null; contact: string } | null>(null);
  const [deepLinkMissing, setDeepLinkMissing] = useState(false);

  // Accounts for the selector; default to the first connected account. Uses the
  // lightweight accounts endpoint (one query) rather than the heavy dashboard
  // stats aggregation, so the inbox isn't gated on analytics before it can load.
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const contact = query.get("contact");
    if (contact) deepLinkRef.current = { account: query.get("account"), contact };
    fetch("/api/instagram/accounts")
      .then((r) => r.json())
      .then((payload) => {
        if (!payload.success) return;
        const next: AccountOption[] = payload.data.instagramAccounts ?? [];
        setAccounts(next);
        const linked = deepLinkRef.current?.account;
        if (linked && next.some((a) => a.id === linked)) {
          setSelectedAccountId(linked);
          return;
        }
        setSelectedAccountId((prev) => {
          // Keep the seeded account only if it's still connected; otherwise
          // fall back to the default so a removed account can't wedge the inbox.
          const stillValid = prev && next.some((a) => a.id === prev);
          return stillValid
            ? prev
            : payload.data.selectedInstagramAccountId || next[0]?.id || "";
        });
      })
      .catch(() => setAccounts([]));
  }, []);

  // Remember the chosen account for the next visit.
  useEffect(() => {
    if (typeof window === "undefined" || !selectedAccountId) return;
    window.sessionStorage.setItem("inbox:selectedAccount", selectedAccountId);
  }, [selectedAccountId]);

  const loadConversations = useCallback(
    async (silent: boolean) => {
      if (!selectedAccountId) return;
      if (!silent) setConvLoading(true);
      try {
        const res = await fetch(
          `/api/instagram/conversations?instagramAccountId=${selectedAccountId}`,
          { cache: "no-store" }
        );
        const data = await res.json();
        if (data.success) {
          setConversations(data.data.conversations);
          writeCache(convCacheKey(selectedAccountId), data.data.conversations);
          setConvError(null);
        } else if (!silent) {
          setConvError(data.error ?? "Failed to load conversations");
        }
      } catch {
        if (!silent) setConvError("Failed to load conversations");
      } finally {
        if (!silent) setConvLoading(false);
      }
    },
    [selectedAccountId]
  );

  const loadDrafts = useCallback(async () => {
    if (!selectedAccountId) return;
    try {
      const res = await fetch(
        `/api/drafts?status=PENDING&limit=100&instagramAccountId=${encodeURIComponent(selectedAccountId)}`,
        { cache: "no-store" }
      );
      const payload = await res.json();
      if (!payload.success) return;
      const next: Record<string, Draft> = {};
      for (const d of payload.data.drafts as Draft[]) {
        // Newest first: keep the newest one per person.
        if (!next[d.contact.igUserId]) next[d.contact.igUserId] = d;
      }
      setDrafts(next);
    } catch {
      // keep whatever is shown
    }
  }, [selectedAccountId]);

  useEffect(() => {
    if (!selectedAccountId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- account changed: drop the old account's drafts
    setDrafts({});
    void loadDrafts();
    const timer = window.setInterval(() => void loadDrafts(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [selectedAccountId, loadDrafts]);

  // Load + poll conversations for the selected account. A cached list is shown
  // immediately (so revisits are instant) while a fresh copy loads silently.
  useEffect(() => {
    if (!selectedAccountId) return;
    // Reset the open thread when switching accounts. This is an intentional
    // synchronous reset on a dependency change, not derived render state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveId(null);
    setMessages([]);
    const cached = readCache<ConversationListItem[]>(
      convCacheKey(selectedAccountId),
      CACHE_MAX_AGE_MS
    );
    if (cached.data) {
      setConversations(cached.data);
      setConvLoading(false);
    } else {
      setConversations([]);
      setConvLoading(true);
    }
    void loadConversations(Boolean(cached.data));
    const timer = window.setInterval(() => void loadConversations(true), POLL_MS);
    return () => window.clearInterval(timer);
  }, [selectedAccountId, loadConversations]);

  const loadMessages = useCallback(
    async (conversationId: string, silent: boolean) => {
      if (!selectedAccountId) return;
      if (!silent) setThreadLoading(true);
      try {
        const res = await fetch(
          `/api/instagram/conversations/${conversationId}?instagramAccountId=${selectedAccountId}&contactId=${encodeURIComponent(contactsRef.current[conversationId] ?? "")}`,
          { cache: "no-store" }
        );
        const data = await res.json();
        if (data.success) {
          setMessages(data.data.messages);
          writeCache(msgCacheKey(conversationId), data.data.messages);
        }
      } catch {
        // keep whatever is shown
      } finally {
        if (!silent) setThreadLoading(false);
      }
    },
    [selectedAccountId]
  );

  // Load + poll the open thread. Cached messages render instantly while a fresh
  // copy loads silently; opening a thread never shows a blank pane on revisit.
  useEffect(() => {
    if (!activeId) return;
    const cached = readCache<ThreadMessage[]>(
      msgCacheKey(activeId),
      CACHE_MAX_AGE_MS
    );
    if (cached.data) {
      // Paint cached messages instantly on thread change; intentional reset.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMessages(cached.data);
      setThreadLoading(false);
    } else {
      setMessages([]);
      setThreadLoading(true);
    }
    void loadMessages(activeId, Boolean(cached.data));
    const timer = window.setInterval(
      () => void loadMessages(activeId, true),
      POLL_MS
    );
    return () => window.clearInterval(timer);
  }, [activeId, loadMessages]);

  // The open person's CRM record: takeover state and 24-hour window.
  const activeIgId = active?.contact.id ?? "";
  const loadThreadContact = useCallback(async () => {
    if (!activeIgId || !selectedAccountId) return;
    try {
      const search = await fetch(
        `/api/contacts?instagramAccountId=${encodeURIComponent(selectedAccountId)}&q=${encodeURIComponent(activeIgId)}&limit=5`,
        { cache: "no-store" }
      ).then((r) => r.json());
      const found = (search.data?.contacts ?? []).find((c: { igUserId: string }) => c.igUserId === activeIgId) as
        | { id: string }
        | undefined;
      if (!found) {
        setThreadContact(null);
        return;
      }
      const detail = await fetch(`/api/contacts/${encodeURIComponent(found.id)}?limit=1`, { cache: "no-store" }).then((r) =>
        r.json()
      );
      setThreadContact({
        id: found.id,
        window: detail.data?.messaging?.window ?? null,
        takeover: detail.data?.messaging?.takeover ?? null,
      });
    } catch {
      // keep whatever is shown
    }
  }, [activeIgId, selectedAccountId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- new thread: forget the previous person
    setThreadContact(null);
    setDraftNotice(null);
    if (!activeIgId) return;
    void loadThreadContact();
    const timer = window.setInterval(() => void loadThreadContact(), POLL_MS * 3);
    return () => window.clearInterval(timer);
  }, [activeIgId, loadThreadContact]);

  const activeDraft = active?.contact.id ? drafts[active.contact.id] ?? null : null;
  // The draft carries fresh context too, so the header works before the CRM lookup returns.
  const headerContact: ThreadContact | null =
    threadContact ??
    (activeDraft
      ? { id: activeDraft.contact.id, window: activeDraft.contact.window, takeover: activeDraft.contact.takeover }
      : null);

  function handleDraftDone(result: { id: string; status: string; message?: string }) {
    setDrafts((prev) => {
      const next = { ...prev };
      for (const [k, d] of Object.entries(next)) if (d.id === result.id) delete next[k];
      return next;
    });
    if (result.status === "SENT") {
      setDraftNotice(t("Draft approved and sent."));
      if (active) void loadMessages(active.id, true);
      void loadConversations(true);
    } else if (result.status === "REJECTED") {
      setDraftNotice(t("Draft discarded. Nothing was sent."));
    } else if (result.message) {
      setDraftNotice(t(result.message));
    }
    void loadThreadContact();
  }

  // Keep the thread pinned to the latest message.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  function openConversation(id: string) {
    setActiveId(id);
    setSendError(null);
    // Paint any cached thread synchronously so the pane never flashes empty
    // or shows the previously open conversation while the fetch runs.
    const cached = readCache<ThreadMessage[]>(msgCacheKey(id), CACHE_MAX_AGE_MS);
    setMessages(cached.data ?? []);
    setThreadLoading(!cached.data);
  }

  // Open the deep-linked conversation as soon as the fresh list has it.
  useEffect(() => {
    const link = deepLinkRef.current;
    if (!link || convLoading || !selectedAccountId) return;
    if (link.account && link.account !== selectedAccountId) return;
    const match = conversations.find((c) => c.contact.id === link.contact);
    if (!match) {
      // The list may still be the cached copy; wait for the fresh fetch.
      if (conversations.length === 0) return;
      deepLinkRef.current = null;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-off notice for a deep link
      setDeepLinkMissing(true);
      return;
    }
    deepLinkRef.current = null;
    openConversation(match.id);
  }, [conversations, convLoading, selectedAccountId]);

  async function handleSend() {
    const text = draft.trim();
    if (!text || !active?.contact.id || sending) return;
    setSending(true);
    setSendError(null);

    // Optimistically show the reply immediately, then confirm with the server.
    const optimistic: ThreadMessage = {
      id: `optimistic-${Date.now()}`,
      text,
      fromMe: true,
      fromUsername: null,
      createdTime: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setDraft("");

    try {
      const res = await fetch("/api/instagram/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instagramAccountId: selectedAccountId,
          recipientId: active.contact.id,
          text,
        }),
      });
      const data = await res.json();
      if (data.success) {
        // A manual reply means you took over: automations pause for this person.
        if (data.data?.takeoverUntil) {
          setThreadContact((prev) =>
            prev ? { ...prev, takeover: { active: true, until: data.data.takeoverUntil, reason: "inbox_send" } } : prev
          );
        }
        void loadThreadContact();
        await loadMessages(active.id, true);
        void loadConversations(true);
      } else {
        // Roll the optimistic message back and restore the draft so it's not lost.
        setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
        setDraft(text);
        setSendError(data.error ?? "Failed to send message");
      }
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setDraft(text);
      setSendError("Failed to send message");
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <h1 className="text-lg font-semibold text-foreground">{t("Inbox")}</h1>
        {accounts.length > 1 && (
          <AccountSelect
            accounts={accounts}
            value={selectedAccountId}
            onChange={setSelectedAccountId}
            includeAll={false}
          />
        )}
      </div>

      <div className="grid h-[calc(100dvh-11rem)] grid-cols-1 overflow-hidden rounded border border-border sm:grid-cols-[300px_1fr]">
        {/* Conversation list. On mobile it takes the full pane and is hidden
            once a thread is open (ManyChat-style); on sm+ it is always shown. */}
        <div
          className={`min-h-0 flex-col border-b border-border sm:flex sm:border-b-0 sm:border-r ${
            active ? "hidden" : "flex"
          }`}
        >
          <div className="shrink-0 border-b border-border px-4 py-3 text-sm font-semibold text-foreground">
            {t("Conversations")}
          </div>
          {deepLinkMissing && (
            <p className="shrink-0 border-b border-border bg-surface-hover px-4 py-2 text-xs text-muted">
              {t("This person's conversation is not among the recent ones Instagram returns.")}
            </p>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {convLoading ? (
              <p className="px-4 py-6 text-sm text-muted">{t("Loading…")}</p>
            ) : convError ? (
              <p className="px-4 py-6 text-sm text-error">{convError}</p>
            ) : conversations.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted">{t("No conversations yet.")}</p>
            ) : (
              conversations.map((c) => {
                const isActive = c.id === activeId;
                const hasDraft = Boolean(c.contact.id && drafts[c.contact.id]);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => openConversation(c.id)}
                    className={`block w-full border-b border-border px-4 py-3 text-left ${
                      isActive ? "bg-surface-hover" : "hover:bg-surface-hover"
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-sm font-medium text-foreground">
                          @{c.contact.username ?? t("unknown")}
                        </span>
                        {hasDraft && (
                          <span
                            className="shrink-0 rounded-full bg-accent px-1.5 py-px text-[10px] font-semibold text-white"
                            title={t("AI draft waiting for your approval")}
                          >
                            {t("Draft")}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-[11px] text-zinc-500">
                        {formatTime(c.updatedTime)}
                      </span>
                    </div>
                    {c.lastMessage && (
                      <p className="mt-0.5 truncate text-xs text-muted">
                        {c.lastMessage.fromMe ? t("You:") : ""}
                        {c.lastMessage.text || t("(no text)")}
                      </p>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Thread. On mobile it is only shown once a conversation is open and
            fills the pane; on sm+ it always sits beside the list. */}
        <div
          className={`min-h-0 flex-col ${active ? "flex" : "hidden sm:flex"}`}
        >
          {!active ? (
            <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted">
              {t("Select a conversation to read and reply.")}
            </div>
          ) : (
            <>
              <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3 text-sm font-semibold text-foreground">
                <button
                  type="button"
                  onClick={() => setActiveId(null)}
                  className="-ml-1 rounded px-2 py-1 text-muted hover:text-foreground sm:hidden"
                  aria-label={t("Back to conversations")}
                >
                  {t("Back")}
                </button>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">
                    @{active.contact.username ?? t("unknown")}
                  </span>
                  {headerContact?.window && (
                    <span className="mt-0.5 font-normal">
                      <WindowBadge window={headerContact.window} />
                    </span>
                  )}
                </div>
                {headerContact && (
                  <TakeoverToggle
                    size="sm"
                    contactId={headerContact.id}
                    takeover={headerContact.takeover}
                    onChange={(next) =>
                      setThreadContact((prev) => ({ ...(prev ?? headerContact), takeover: next }))
                    }
                  />
                )}
              </div>
              {headerContact?.takeover?.active && (
                <p className="shrink-0 border-b border-border bg-surface-hover px-4 py-2 text-xs text-muted">
                  {t("You're answering this person. Campaigns, follow-ups, sequences and the AI stay quiet until you hand it back.")}
                </p>
              )}

              <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
                {threadLoading && messages.length === 0 ? (
                  <p className="text-sm text-muted">{t("Loading…")}</p>
                ) : messages.length === 0 ? (
                  <p className="text-sm text-muted">{t("No messages.")}</p>
                ) : (
                  messages.map((m) => {
                    const midias = (m.media ?? []).filter((x) => x.type !== "share");
                    const links = (m.media ?? []).filter((x) => x.type === "share");
                    const vazia = !m.text && !m.template && midias.length === 0 && links.length === 0;
                    return (
                      <div
                        key={m.id}
                        className={`flex flex-col gap-1 ${m.fromMe ? "items-end" : "items-start"}`}
                      >
                        {m.storyReply && (
                          <p className="px-1 text-[11px] text-zinc-500">
                            {m.fromMe ? t("You replied to their story") : t("Replied to your story")}
                          </p>
                        )}
                        {/* Like the Instagram app: photos/videos/audio sit outside the bubble */}
                        {midias.length > 0 && <MessageMediaList media={midias} fromMe={m.fromMe} />}
                        {m.template && (
                          <div className="w-64 max-w-[75%] overflow-hidden rounded-2xl border border-border bg-surface text-sm">
                            <p className="whitespace-pre-wrap break-words px-3 py-2 text-foreground">
                              {m.template.title}
                            </p>
                            {m.template.subtitle && (
                              <p className="px-3 pb-2 text-xs text-muted">{m.template.subtitle}</p>
                            )}
                            {m.template.buttons.map((b, i) =>
                              b.url ? (
                                <a
                                  key={i}
                                  href={b.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="block border-t border-border px-3 py-2 text-center font-semibold text-accent hover:bg-accent/10"
                                >
                                  {b.title}
                                </a>
                              ) : (
                                <p key={i} className="border-t border-border px-3 py-2 text-center font-semibold text-accent">
                                  {b.title}
                                </p>
                              )
                            )}
                          </div>
                        )}
                        {(m.text || links.length > 0 || vazia) && (
                          <div
                            className={`max-w-[75%] rounded-3xl px-4 py-2 text-sm ${
                              m.fromMe ? "bg-accent text-white" : "bg-surface text-foreground border border-border"
                            }`}
                          >
                            {m.deleted ? (
                              <p className="italic opacity-70">{t("Message deleted")}</p>
                            ) : m.text ? (
                              <p className="whitespace-pre-wrap break-words">{m.text}</p>
                            ) : vazia ? (
                              <p className="italic opacity-70">{t("Message without text (sticker, reaction or a format Meta doesn't deliver)")}</p>
                            ) : null}
                            {links.length > 0 && <MessageMediaList media={links} fromMe={m.fromMe} />}
                          </div>
                        )}
                        <p className="px-1 text-[10px] text-zinc-500">{formatTime(m.createdTime)}</p>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="shrink-0 border-t border-border p-3">
                {activeDraft && (
                  <DraftCard
                    key={activeDraft.id}
                    draft={activeDraft}
                    onDone={handleDraftDone}
                    className="mb-3 max-h-[45dvh] overflow-y-auto"
                  />
                )}
                {draftNotice && !activeDraft && (
                  <p className="mb-2 text-xs text-muted">{draftNotice}</p>
                )}
                {sendError && (
                  <p className="mb-2 text-xs text-error">{sendError}</p>
                )}
                <div className="flex items-end gap-2">
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={handleKeyDown}
                    rows={1}
                    placeholder={t("Write a reply… (Enter to send, Shift+Enter for a new line)")}
                    className="max-h-32 min-h-[40px] flex-1 resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => void handleSend()}
                    disabled={sending || !draft.trim()}
                    className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
                  >
                    {sending ? t("Sending…") : t("Send")}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
