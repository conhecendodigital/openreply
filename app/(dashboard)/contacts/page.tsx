"use client";

/**
 * Contacts (CRM, 2026-10-03)
 *
 * Everyone who commented, sent a DM or clicked a link, laid out like the
 * Instagram followers list: avatar, @username, last interaction and tags.
 * Search by @username or name, filter by tag (chips), simple pagination.
 * ?tag=<name> opens the list already filtered (tag chips on a contact link here).
 */

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import AccountSelect, { type AccountOption } from "@/components/account-select";
import { ContactAvatar, contactDisplayName, inboxHref, isUnnamedContact, TagChip, useTimeAgo } from "@/components/contact-ui";
import { useT } from "@/components/lang-provider";

interface ContactRow {
  id: string;
  igUserId: string;
  username: string | null;
  name: string | null;
  profilePicUrl?: string | null;
  instagramAccountId: string;
  lastSeenAt: string;
  commentsCount: number;
  dmsInCount: number;
  clicksCount: number;
  tags: { name: string; source: string }[];
  instagramAccount: { username: string };
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalCapped: boolean;
  totalPages: number;
}

const PAGE_SIZE = 30;
const VISIBLE_TAGS = 4;
const VISIBLE_CHIPS = 16;

export default function ContactsPage() {
  return (
    <Suspense fallback={null}>
      <ContactsList />
    </Suspense>
  );
}

function ContactsList() {
  const t = useT();
  const timeAgo = useTimeAgo();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [accountId, setAccountId] = useState("all");
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [debounced, setDebounced] = useState(query);
  const [tag, setTag] = useState(searchParams.get("tag") ?? "");
  const [tags, setTags] = useState<{ name: string; count: number }[]>([]);
  const [showAllTags, setShowAllTags] = useState(false);
  const [page, setPage] = useState(1);

  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/instagram/accounts")
      .then((r) => r.json())
      .then((p) => {
        if (p.success) setAccounts(p.data.instagramAccounts ?? []);
      })
      .catch(() => setAccounts([]));
  }, []);

  // Wait for the person to stop typing before hitting the API.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(query.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (accountId !== "all") params.set("instagramAccountId", accountId);
    fetch(`/api/contacts/tags?${params}`)
      .then((r) => r.json())
      .then((p) => {
        if (p.success) setTags(p.data);
      })
      .catch(() => setTags([]));
  }, [accountId]);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
    if (debounced) params.set("q", debounced);
    if (tag) params.set("tag", tag);
    if (accountId !== "all") params.set("instagramAccountId", accountId);
    try {
      const res = await fetch(`/api/contacts?${params}`, { cache: "no-store" });
      const data = await res.json();
      if (data.success) {
        setContacts(data.data.contacts);
        setPagination(data.data.pagination);
        setError(null);
      } else {
        setError(data.error ?? "Failed to load contacts");
      }
    } catch {
      setError("Failed to load contacts");
    } finally {
      setLoading(false);
    }
  }, [page, debounced, tag, accountId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  function chooseTag(next: string) {
    setLoading(true);
    setTag(next);
    setPage(1);
    const params = new URLSearchParams(searchParams.toString());
    if (next) params.set("tag", next);
    else params.delete("tag");
    router.replace(`/contacts${params.toString() ? `?${params}` : ""}`, { scroll: false });
  }

  function chooseAccount(next: string) {
    setLoading(true);
    setAccountId(next);
    setTag("");
    setPage(1);
  }

  const chips = showAllTags ? tags : tags.slice(0, VISIBLE_CHIPS);
  // A tag from the URL that is not in the top list still shows as selected.
  const tagMissing = tag && !chips.some((c) => c.name === tag);
  const totalLabel = pagination
    ? pagination.totalCapped
      ? t("{n}+ contacts", { n: pagination.total.toLocaleString() })
      : pagination.total === 1
        ? t("1 contact")
        : t("{n} contacts", { n: pagination.total.toLocaleString() })
    : "";

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="relative block flex-1">
          <span className="sr-only">{t("Search")}</span>
          <svg
            viewBox="0 0 24 24"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("Search by @username or name")}
            className="w-full rounded-lg border border-border bg-surface-hover py-2 pl-9 pr-3 text-sm outline-none focus:border-border-hover"
          />
        </label>
        {accounts.length > 1 && (
          <AccountSelect accounts={accounts} value={accountId} onChange={chooseAccount} />
        )}
      </div>

      {tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <TagChip name={t("All")} active={!tag} onClick={() => chooseTag("")} />
          {tagMissing && <TagChip name={tag} active onClick={() => chooseTag("")} />}
          {chips.map((c) => (
            <TagChip
              key={c.name}
              name={c.name}
              count={c.count}
              active={tag === c.name}
              onClick={() => chooseTag(tag === c.name ? "" : c.name)}
            />
          ))}
          {tags.length > VISIBLE_CHIPS && (
            <button
              type="button"
              onClick={() => setShowAllTags((v) => !v)}
              className="text-xs font-semibold text-accent hover:text-accent-hover"
            >
              {showAllTags ? t("Show less") : t("See all ({n})", { n: tags.length })}
            </button>
          )}
        </div>
      )}

      <div className="panel overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="text-sm font-semibold">{t("Contacts")}</p>
          <p className="text-xs text-muted">{totalLabel}</p>
        </div>

        {error && <p className="px-4 py-6 text-sm text-error">{t(error)}</p>}

        {!error && loading && contacts.length === 0 && (
          <ul className="divide-y divide-border">
            {Array.from({ length: 6 }).map((_, i) => (
              <li key={i} className="flex items-center gap-3 px-4 py-3">
                <span className="h-11 w-11 animate-pulse rounded-full bg-surface-hover" />
                <span className="h-3 w-40 animate-pulse rounded bg-surface-hover" />
              </li>
            ))}
          </ul>
        )}

        {!error && !loading && contacts.length === 0 && (
          <div className="px-4 py-12 text-center">
            <p className="text-sm font-semibold">{t("No contacts yet")}</p>
            <p className="mt-1 text-sm text-muted">
              {debounced || tag
                ? t("Nobody matches this search.")
                : t("Everyone who comments, sends a DM or clicks a link shows up here.")}
            </p>
          </div>
        )}

        {contacts.length > 0 && (
          <ul className={`divide-y divide-border ${loading ? "opacity-60" : ""}`}>
            {contacts.map((c) => {
              const extra = c.tags.length - VISIBLE_TAGS;
              return (
                <li key={c.id} className="relative flex items-center transition-colors hover:bg-surface-hover">
                  <Link
                    href={`/contacts/${c.id}`}
                    className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3"
                  >
                    <ContactAvatar username={c.username} name={c.name} src={c.profilePicUrl} />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-baseline gap-2">
                        <p className="truncate text-sm font-semibold">{contactDisplayName(t, c)}</p>
                        {c.username && c.name && <p className="hidden truncate text-sm text-muted sm:block">{c.name}</p>}
                      </div>
                      <p className="truncate text-xs text-muted">
                        {t("Last interaction {time}", { time: timeAgo(c.lastSeenAt) })}
                        {accounts.length > 1 && ` · @${c.instagramAccount.username}`}
                      </p>
                      {c.tags.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {c.tags.slice(0, VISIBLE_TAGS).map((tg) => (
                            <TagChip key={tg.name} name={tg.name} source={tg.source} />
                          ))}
                          {extra > 0 && <span className="text-xs text-muted">+{extra}</span>}
                        </div>
                      )}
                    </div>
                    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="m9 6 6 6-6 6" />
                    </svg>
                  </Link>
                  {isUnnamedContact(c) && (
                    <Link
                      href={inboxHref(c.instagramAccountId, c.igUserId)}
                      className="mr-3 shrink-0 rounded-lg border border-border px-2.5 py-1 text-xs font-semibold hover:border-border-hover"
                    >
                      {t("Open conversation")}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-border px-4 py-3">
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => {
                setLoading(true);
                setPage((p) => Math.max(1, p - 1));
              }}
              className="rounded-lg border border-border px-3 py-1.5 text-sm font-semibold disabled:opacity-40"
            >
              {t("Previous")}
            </button>
            <span className="text-xs text-muted">
              {t("Page {page} of {total}", { page, total: pagination.totalPages })}
            </span>
            <button
              type="button"
              disabled={page >= pagination.totalPages || loading}
              onClick={() => {
                setLoading(true);
                setPage((p) => p + 1);
              }}
              className="rounded-lg border border-border px-3 py-1.5 text-sm font-semibold disabled:opacity-40"
            >
              {t("Next")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
