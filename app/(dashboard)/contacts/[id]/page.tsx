"use client";

/**
 * Contact (CRM, 2026-10-03)
 *
 * Profile-style header (avatar, @username, counters like posts/followers),
 * tags you can add and remove, notes, the timeline of everything that happened
 * with the person (comment, DM, campaign, click, tag, moderation) and a button
 * that opens the conversation in the Inbox.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ContactAvatar, TagChip, useDateTime, useTimeAgo } from "@/components/contact-ui";
import { useT } from "@/components/lang-provider";

interface Contact {
  id: string;
  igUserId: string;
  username: string | null;
  name: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  lastInboundAt: string | null;
  commentsCount: number;
  dmsInCount: number;
  dmsOutCount: number;
  campaignsCount: number;
  clicksCount: number;
  hiddenCommentsCount: number;
  notes: string | null;
  tags: { name: string; source: string; createdAt: string }[];
  instagramAccount: { id: string; username: string };
}

interface ContactEvent {
  id: string;
  type: string;
  text: string | null;
  mediaId: string | null;
  meta: Record<string, unknown> | null;
  occurredAt: string;
}

interface Moderation {
  id: string;
  commentText: string;
  verdict: string;
  reason: string | null;
  action: string;
  createdAt: string;
}

interface Payload {
  contact: Contact;
  events: ContactEvent[];
  nextCursor: string | null;
  moderation: Moderation[];
  links: { inbox: string; profile: string | null };
}

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

// Icon and label for each timeline event, same line style as the sidebar.
const EVENT_KINDS: Record<string, { label: string; color: string; icon: React.ReactElement }> = {
  COMMENT: {
    label: "Commented",
    color: "text-foreground",
    icon: <path {...stroke} d="M21 11.5a8.4 8.4 0 0 1-12.3 7.5L3 21l2-5.5A8.4 8.4 0 1 1 21 11.5z" />,
  },
  DM_IN: {
    label: "Sent you a DM",
    color: "text-accent",
    icon: <path {...stroke} d="M20 12H4m0 0 6-6m-6 6 6 6" />,
  },
  DM_OUT: {
    label: "You sent a DM",
    color: "text-foreground",
    icon: <path {...stroke} d="M22 3 9.2 10.1M22 3l-7 18-3.8-8.9L2 8.3z" />,
  },
  CAMPAIGN_SENT: {
    label: "Received campaign",
    color: "text-[#d6249f]",
    icon: <path {...stroke} d="M12 21s-7-4.4-9.3-9C1.1 8.6 3 4.5 6.9 4.5c2.3 0 3.8 1.4 5.1 3.2 1.3-1.8 2.8-3.2 5.1-3.2 3.9 0 5.8 4.1 4.2 7.5C19 16.6 12 21 12 21z" />,
  },
  CLICK: {
    label: "Clicked the link",
    color: "text-success",
    icon: <path {...stroke} d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
  },
  TAG_ADDED: {
    label: "Tag added",
    color: "text-muted",
    icon: <path {...stroke} d="M3 12V4h8l9 9-8 8zM7.5 7.5h.01" />,
  },
  TAG_REMOVED: {
    label: "Tag removed",
    color: "text-muted",
    icon: <path {...stroke} d="M3 12V4h8l9 9-8 8zM7.5 7.5h.01" />,
  },
  COMMENT_HIDDEN: {
    label: "Comment hidden",
    color: "text-error",
    icon: <path {...stroke} d="M3 3l18 18M10.6 5.1A9.6 9.6 0 0 1 12 5c5 0 9 5 10 7a14 14 0 0 1-3 3.8M6.6 6.6C4.4 8 2.8 10.4 2 12c1 2 5 7 10 7 1.8 0 3.4-.6 4.8-1.5M9.9 9.9a3 3 0 0 0 4.2 4.2" />,
  },
  COMMENT_RESTORED: {
    label: "Comment restored",
    color: "text-foreground",
    icon: <path {...stroke} d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />,
  },
};

const MODERATION_LABELS: Record<string, string> = {
  NONE: "Clean",
  WOULD_HIDE: "Would hide",
  HIDDEN: "Hidden",
  RESTORED: "Restored",
  SKIPPED_PROTECTED: "Protected",
  FAILED: "Failed",
};

export default function ContactPage() {
  const t = useT();
  const timeAgo = useTimeAgo();
  const dateTime = useDateTime();
  const { id } = useParams<{ id: string }>();

  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [olderLoading, setOlderLoading] = useState(false);

  const [newTag, setNewTag] = useState("");
  const [tagBusy, setTagBusy] = useState(false);
  const [tagError, setTagError] = useState<string | null>(null);

  const [notes, setNotes] = useState("");
  const [notesSaved, setNotesSaved] = useState(true);
  const [notesBusy, setNotesBusy] = useState(false);
  // Instagram's 24-hour window: replies are only possible after a recent DM.
  const [windowOpen, setWindowOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/contacts/${encodeURIComponent(id)}`, { cache: "no-store" });
      const payload = await res.json();
      if (payload.success) {
        setData(payload.data);
        setNotes(payload.data.contact.notes ?? "");
        const lastIn = payload.data.contact.lastInboundAt;
        setWindowOpen(Boolean(lastIn) && Date.now() - new Date(lastIn).getTime() < 24 * 3600 * 1000);
        setNotesSaved(true);
        setError(null);
      } else {
        setError(res.status === 404 ? "Contact not found" : payload.error ?? "Failed to load contact");
      }
    } catch {
      setError("Failed to load contact");
    }
  }, [id]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function loadOlder() {
    if (!data?.nextCursor || olderLoading) return;
    setOlderLoading(true);
    try {
      const res = await fetch(
        `/api/contacts/${encodeURIComponent(id)}?before=${encodeURIComponent(data.nextCursor)}`,
        { cache: "no-store" }
      );
      const payload = await res.json();
      if (payload.success) {
        setData((prev) =>
          prev
            ? {
                ...prev,
                events: [...prev.events, ...payload.data.events],
                nextCursor: payload.data.nextCursor,
              }
            : prev
        );
      }
    } finally {
      setOlderLoading(false);
    }
  }

  async function changeTags(body: { add?: string[]; remove?: string[] }) {
    setTagBusy(true);
    setTagError(null);
    try {
      const res = await fetch(`/api/contacts/${encodeURIComponent(id)}/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await res.json();
      if (!payload.success) {
        setTagError(payload.error ?? "Could not change the tags");
        return false;
      }
      // Reload so the timeline shows the tag event too.
      await load();
      return true;
    } catch {
      setTagError("Could not change the tags");
      return false;
    } finally {
      setTagBusy(false);
    }
  }

  async function addTag(e: React.FormEvent) {
    e.preventDefault();
    const name = newTag.trim();
    if (!name || tagBusy) return;
    if (await changeTags({ add: [name] })) setNewTag("");
  }

  async function saveNotes() {
    setNotesBusy(true);
    try {
      const res = await fetch(`/api/contacts/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: notes.trim() || null }),
      });
      const payload = await res.json();
      if (payload.success) setNotesSaved(true);
    } finally {
      setNotesBusy(false);
    }
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Link href="/contacts" className="text-sm font-semibold text-accent">
          ← {t("Contacts")}
        </Link>
        <p className="panel px-4 py-8 text-center text-sm text-muted">{t(error)}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center gap-6 py-6">
          <span className="h-20 w-20 animate-pulse rounded-full bg-surface-hover sm:h-36 sm:w-36" />
          <span className="h-4 w-48 animate-pulse rounded bg-surface-hover" />
        </div>
      </div>
    );
  }

  const { contact, events, moderation, links } = data;
  const counters = [
    { value: contact.commentsCount, label: "comments" },
    { value: contact.dmsInCount, label: "DMs received" },
    { value: contact.dmsOutCount, label: "DMs sent" },
    { value: contact.campaignsCount, label: "campaigns" },
    { value: contact.clicksCount, label: "clicks" },
    ...(contact.hiddenCommentsCount > 0 ? [{ value: contact.hiddenCommentsCount, label: "hidden" }] : []),
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/contacts" className="inline-flex text-sm font-semibold text-accent hover:text-accent-hover">
        ← {t("Contacts")}
      </Link>

      {/* Profile header */}
      <section className="flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-10">
        <div className="sm:hidden">
          <ContactAvatar username={contact.username} name={contact.name} size={84} />
        </div>
        <div className="hidden sm:block">
          <ContactAvatar username={contact.username} name={contact.name} size={144} />
        </div>
        <div className="min-w-0 flex-1 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="truncate text-xl font-normal">
              {contact.username ? contact.username : t("Unknown user")}
            </h2>
            <Link
              href={links.inbox}
              className="rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover"
            >
              {t("Open in Direct")}
            </Link>
            {links.profile && (
              <a
                href={links.profile}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg bg-surface-hover px-4 py-1.5 text-sm font-semibold hover:bg-border"
              >
                {t("View profile")}
              </a>
            )}
          </div>

          <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            {counters.map((c) => (
              <li key={c.label}>
                <span className="font-semibold">{c.value.toLocaleString()}</span> {t(c.label)}
              </li>
            ))}
          </ul>

          <div className="space-y-0.5 text-sm">
            {contact.name && <p className="font-semibold">{contact.name}</p>}
            <p className="text-muted">
              {t("First seen {date}", { date: dateTime(contact.firstSeenAt) })} ·{" "}
              {t("Last interaction {time}", { time: timeAgo(contact.lastSeenAt) })}
            </p>
            <p className="text-muted">
              {t("On @{account}", { account: contact.instagramAccount.username })}
              {windowOpen && <span className="ml-2 font-semibold text-success">{t("DM window open (24h)")}</span>}
            </p>
          </div>
        </div>
      </section>

      {/* Tags */}
      <section className="panel space-y-3 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">{t("Tags")}</h3>
          <p className="text-xs text-muted">{t("Blue = added by you · gray = automatic")}</p>
        </div>
        {contact.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {contact.tags.map((tg) => (
              <TagChip
                key={tg.name}
                name={tg.name}
                source={tg.source}
                removeLabel={t("Remove tag {name}", { name: tg.name })}
                onRemove={tagBusy ? undefined : () => void changeTags({ remove: [tg.name] })}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">{t("No tags yet")}</p>
        )}
        <form onSubmit={addTag} className="flex gap-2">
          <input
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            maxLength={60}
            placeholder={t("New tag, e.g. hot lead")}
            className="min-w-0 flex-1 rounded-lg border border-border bg-surface-hover px-3 py-1.5 text-sm outline-none focus:border-border-hover"
          />
          <button
            type="submit"
            disabled={!newTag.trim() || tagBusy}
            className="rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-40"
          >
            {t("Add")}
          </button>
        </form>
        {tagError && <p className="text-xs text-error">{t(tagError)}</p>}
      </section>

      {/* Notes */}
      <section className="panel space-y-3 p-4">
        <h3 className="text-sm font-semibold">{t("Notes")}</h3>
        <textarea
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            setNotesSaved(false);
          }}
          rows={3}
          maxLength={5000}
          placeholder={t("Anything you want to remember about this person")}
          className="w-full resize-y rounded-lg border border-border bg-surface-hover px-3 py-2 text-sm outline-none focus:border-border-hover"
        />
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => void saveNotes()}
            disabled={notesSaved || notesBusy}
            className="rounded-lg border border-border px-4 py-1.5 text-sm font-semibold disabled:opacity-40"
          >
            {notesSaved ? t("Notes saved") : t("Save")}
          </button>
        </div>
      </section>

      {/* Moderation of this person's comments */}
      {moderation.some((m) => m.action !== "NONE") && (
        <section className="panel space-y-2 p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">{t("Moderation")}</h3>
            <Link href="/moderation" className="text-xs font-semibold text-accent">
              {t("See all")}
            </Link>
          </div>
          <ul className="divide-y divide-border">
            {moderation
              .filter((m) => m.action !== "NONE")
              .map((m) => (
                <li key={m.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="break-words">{m.commentText}</p>
                    {m.reason && <p className="text-xs text-muted">{m.reason}</p>}
                  </div>
                  <div className="shrink-0 text-right text-xs">
                    <p className={m.action === "HIDDEN" ? "font-semibold text-error" : "text-muted"}>
                      {t(MODERATION_LABELS[m.action] ?? m.action)}
                    </p>
                    <p className="text-muted">{timeAgo(m.createdAt)}</p>
                  </div>
                </li>
              ))}
          </ul>
        </section>
      )}

      {/* Timeline */}
      <section className="panel overflow-hidden">
        <h3 className="border-b border-border px-4 py-3 text-sm font-semibold">{t("Timeline")}</h3>
        {events.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">{t("No events yet")}</p>
        ) : (
          <ol className="divide-y divide-border">
            {events.map((ev) => {
              const kind = EVENT_KINDS[ev.type];
              const storyReply = ev.type === "DM_IN" && ev.meta?.storyReply === true;
              return (
                <li key={ev.id} className="flex gap-3 px-4 py-3">
                  <span
                    className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border ${kind?.color ?? "text-muted"}`}
                  >
                    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" aria-hidden>
                      {kind?.icon ?? <circle {...stroke} cx="12" cy="12" r="3" />}
                    </svg>
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-sm font-semibold">
                        {kind ? t(kind.label) : ev.type}
                        {storyReply && <span className="ml-1 font-normal text-muted">({t("story reply")})</span>}
                      </p>
                      <time className="shrink-0 text-xs text-muted" title={dateTime(ev.occurredAt)} dateTime={ev.occurredAt}>
                        {timeAgo(ev.occurredAt)}
                      </time>
                    </div>
                    {ev.text && (
                      <p
                        className={`mt-0.5 break-words text-sm ${
                          ev.type.startsWith("TAG_") || ev.type === "CAMPAIGN_SENT" ? "text-muted" : ""
                        }`}
                      >
                        {ev.text}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        {data.nextCursor && (
          <div className="border-t border-border px-4 py-3 text-center">
            <button
              type="button"
              onClick={() => void loadOlder()}
              disabled={olderLoading}
              className="text-sm font-semibold text-accent hover:text-accent-hover disabled:opacity-50"
            >
              {olderLoading ? t("Loading...") : t("Load older")}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
