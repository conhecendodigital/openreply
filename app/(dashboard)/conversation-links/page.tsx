"use client";

/**
 * Conversation links (2026-10-04, Etapa 2)
 *
 * Links that open your Direct (ig.me/m/<you>?ref=<code>) for a story, the bio
 * or a page. When someone opens a conversation through one, the contact gets
 * the origin tag ("veio:story") and the linked campaign can fire. Each link
 * shows clicks (through our /c/ redirect), conversations opened and people.
 * The QR is drawn here in the browser; the link is never sent to a QR service.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AccountSelect, { type AccountOption } from "@/components/account-select";
import { Switch, useTimeAgo } from "@/components/contact-ui";
import { useT } from "@/components/lang-provider";
import { LINK_ORIGINS } from "@/lib/conversation-links/links";
import { encodeQr, qrSvgPath } from "@/lib/qr";

interface ConversationLink {
  id: string;
  code: string;
  origin: string;
  tag: string;
  automation: { id: string; name: string; isActive: boolean } | null;
  isActive: boolean;
  createdAt: string;
  account: { id: string; username: string };
  igMeUrl: string;
  clickUrl: string;
  clicks: number;
  opens: number;
  contacts: number;
}

interface CampaignOption {
  id: string;
  name: string;
  isActive: boolean;
  instagramAccountId: string;
}

const ORIGIN_LABELS: Record<string, string> = {
  story: "Story",
  bio: "Bio",
  pagina: "Page",
  reels: "Reels",
  anuncio: "Ad",
  outro: "Other",
};

function QrCode({ text, label }: { text: string; label: string }) {
  const t = useT();
  const { path, size } = useMemo(() => qrSvgPath(encodeQr(text)), [text]);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
  const href = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return (
    <div className="flex flex-col items-center gap-2">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        shapeRendering="crispEdges"
        className="h-44 w-44 rounded-xl border border-border"
        role="img"
        aria-label={t("QR code for {label}", { label })}
      >
        <rect width="100%" height="100%" fill="#fff" />
        <path d={path} fill="#000" />
      </svg>
      <a href={href} download={`qr-${label}.svg`} className="text-xs font-semibold text-accent hover:text-accent-hover">
        {t("Download QR (SVG)")}
      </a>
    </div>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="shrink-0 rounded-lg bg-surface-hover px-3 py-1 text-xs font-semibold hover:bg-border"
    >
      {copied ? t("Copied") : label}
    </button>
  );
}

export default function ConversationLinksPage() {
  const t = useT();
  const timeAgo = useTimeAgo();
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [accountId, setAccountId] = useState("");
  const [links, setLinks] = useState<ConversationLink[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [qrFor, setQrFor] = useState<string | null>(null);

  // New link form
  const [code, setCode] = useState("");
  const [origin, setOrigin] = useState<string>("story");
  const [customOrigin, setCustomOrigin] = useState("");
  const [automationId, setAutomationId] = useState("");
  const [tagName, setTagName] = useState("");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/instagram/accounts")
      .then((r) => r.json())
      .then((payload) => {
        if (!payload.success) return;
        const list: AccountOption[] = payload.data.instagramAccounts ?? [];
        setAccounts(list);
        setAccountId((prev) => prev || payload.data.selectedInstagramAccountId || list[0]?.id || "");
      })
      .catch(() => setAccounts([]));
  }, []);

  const load = useCallback(async () => {
    if (!accountId) return;
    try {
      const [linksRes, campaignsRes] = await Promise.all([
        fetch(`/api/conversation-links?instagramAccountId=${encodeURIComponent(accountId)}`, { cache: "no-store" }).then((r) =>
          r.json()
        ),
        fetch(`/api/automations?instagramAccountId=${encodeURIComponent(accountId)}`, { cache: "no-store" }).then((r) =>
          r.json()
        ),
      ]);
      if (linksRes.success) {
        setLinks(linksRes.data.links);
        setError(null);
      } else {
        setError(linksRes.error ?? "Failed to load links");
      }
      if (campaignsRes.success) setCampaigns(campaignsRes.data as CampaignOption[]);
    } catch {
      setError("Failed to load links");
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const finalOrigin = origin === "outro" ? customOrigin.trim() || "outro" : origin;
  const previewTag = `veio:${finalOrigin
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")}`;
  const codeInvalid = code !== "" && !/^[A-Za-z0-9_=-]{1,64}$/.test(code);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (creating || codeInvalid || !accountId) return;
    setCreating(true);
    setFormError(null);
    try {
      const res = await fetch("/api/conversation-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instagramAccountId: accountId,
          origin: finalOrigin,
          ...(code ? { code } : {}),
          ...(automationId ? { automationId } : {}),
          ...(tagName.trim() ? { tagName: tagName.trim() } : {}),
        }),
      });
      const payload = await res.json();
      if (payload.success) {
        setLinks((prev) => [payload.data as ConversationLink, ...prev]);
        setCode("");
        setTagName("");
        setQrFor((payload.data as ConversationLink).id);
      } else {
        setFormError(payload.details?.code === "code_taken" ? "This code is already in use" : payload.error ?? "Could not create the link");
      }
    } catch {
      setFormError("Could not create the link");
    } finally {
      setCreating(false);
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/conversation-links/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await res.json().catch(() => null);
    if (payload?.success) setLinks((prev) => prev.map((l) => (l.id === id ? (payload.data as ConversationLink) : l)));
    else setError(payload?.error ?? "Could not save");
  }

  async function remove(link: ConversationLink) {
    if (!window.confirm(t("Delete the link {code}? Anyone who opens it later won't be tagged.", { code: link.code }))) return;
    const res = await fetch(`/api/conversation-links/${encodeURIComponent(link.id)}`, { method: "DELETE" });
    const payload = await res.json().catch(() => null);
    if (payload?.success) setLinks((prev) => prev.filter((l) => l.id !== link.id));
    else setError(payload?.error ?? "Could not delete");
  }

  const inputClass =
    "w-full rounded-lg border border-border bg-surface-hover px-3 py-2 text-sm outline-none focus:border-border-hover";

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold">{t("Conversation links")}</h2>
          <p className="text-sm text-muted">
            {t("A link that opens your Direct. Put it in a story, the bio or a page and see who came from where.")}
          </p>
        </div>
        {accounts.length > 1 && (
          <AccountSelect accounts={accounts} value={accountId} onChange={setAccountId} includeAll={false} />
        )}
      </div>

      {/* New link */}
      <form onSubmit={create} className="panel space-y-4 rounded-2xl p-4">
        <h3 className="text-sm font-semibold">{t("New link")}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="text-xs font-semibold text-muted">{t("Where it goes")}</span>
            <select value={origin} onChange={(e) => setOrigin(e.target.value)} className={inputClass}>
              {LINK_ORIGINS.map((o) => (
                <option key={o} value={o}>
                  {t(ORIGIN_LABELS[o] ?? o)}
                </option>
              ))}
            </select>
          </label>
          {origin === "outro" ? (
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold text-muted">{t("Origin name")}</span>
              <input
                value={customOrigin}
                onChange={(e) => setCustomOrigin(e.target.value)}
                maxLength={30}
                placeholder={t("e.g. live, whatsapp, youtube")}
                className={inputClass}
              />
            </label>
          ) : (
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold text-muted">{t("Name / code (optional)")}</span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\s+/g, "-"))}
                maxLength={64}
                placeholder={t("e.g. story-october (blank = random)")}
                className={`${inputClass} ${codeInvalid ? "border-error" : ""}`}
              />
            </label>
          )}
          {origin === "outro" && (
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold text-muted">{t("Name / code (optional)")}</span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\s+/g, "-"))}
                maxLength={64}
                placeholder={t("e.g. story-october (blank = random)")}
                className={`${inputClass} ${codeInvalid ? "border-error" : ""}`}
              />
            </label>
          )}
          <label className="space-y-1 text-sm">
            <span className="text-xs font-semibold text-muted">{t("Campaign that fires (optional)")}</span>
            <select value={automationId} onChange={(e) => setAutomationId(e.target.value)} className={inputClass}>
              <option value="">{t("None, just tag the person")}</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.isActive ? "" : ` (${t("off")})`}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-xs font-semibold text-muted">{t("Tag (optional)")}</span>
            <input
              value={tagName}
              onChange={(e) => setTagName(e.target.value)}
              maxLength={60}
              placeholder={previewTag}
              className={inputClass}
            />
          </label>
        </div>
        {codeInvalid && <p className="text-xs text-error">{t("Use only letters, numbers, - _ = (up to 64)")}</p>}
        {formError && <p className="text-xs text-error">{t(formError)}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted">
            {t("Whoever opens it gets the tag {tag}.", { tag: tagName.trim() || previewTag })}
          </p>
          <button
            type="submit"
            disabled={creating || codeInvalid || !accountId}
            className="rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-40"
          >
            {creating ? t("Creating…") : t("Create link")}
          </button>
        </div>
      </form>

      {error && <p className="text-sm text-error">{t(error)}</p>}

      {/* Links */}
      {loading ? (
        <div className="panel h-32 animate-pulse rounded-2xl" />
      ) : links.length === 0 ? (
        <p className="panel rounded-2xl px-4 py-10 text-center text-sm text-muted">{t("No links yet.")}</p>
      ) : (
        <ul className="space-y-3">
          {links.map((l) => (
            <li key={l.id} className={`panel space-y-3 rounded-2xl p-4 ${l.isActive ? "" : "opacity-70"}`}>
              <div className="flex flex-wrap items-center gap-3">
                <span className="rounded-full bg-surface-hover px-2.5 py-0.5 text-xs font-semibold">
                  {t(ORIGIN_LABELS[l.origin] ?? l.origin)}
                </span>
                <span className="min-w-0 truncate font-mono text-sm font-semibold">{l.code}</span>
                <span className="text-xs text-muted">{timeAgo(l.createdAt)}</span>
                <span className="ml-auto flex items-center gap-2 text-xs">
                  <span className="text-muted">{l.isActive ? t("Link active") : t("Link paused")}</span>
                  <Switch
                    checked={l.isActive}
                    label={t("Turn the link on or off")}
                    onChange={(next) => void patch(l.id, { isActive: next })}
                  />
                </span>
              </div>

              <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                <li>
                  <span className="font-semibold">{l.clicks.toLocaleString()}</span> {t("clicks")}
                </li>
                <li>
                  <span className="font-semibold">{l.opens.toLocaleString()}</span> {t("conversations opened")}
                </li>
                <li>
                  <Link
                    href={`/contacts?tag=${encodeURIComponent(l.tag)}`}
                    className="hover:underline"
                  >
                    <span className="font-semibold">{l.contacts.toLocaleString()}</span> {t("people")}
                  </Link>
                </li>
              </ul>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-lg bg-surface-hover px-3 py-1.5 text-xs">{l.clickUrl}</code>
                  <CopyButton value={l.clickUrl} label={t("Copy link")} />
                </div>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-lg px-3 py-1.5 text-xs text-muted">{l.igMeUrl}</code>
                  <CopyButton value={l.igMeUrl} label={t("Copy ig.me")} />
                </div>
                <p className="text-[11px] text-muted">
                  {t("The first link counts clicks and then opens the ig.me link. Use the ig.me link where a redirect isn't allowed.")}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-sm">
                <label className="flex items-center gap-2">
                  <span className="text-xs text-muted">{t("Campaign")}</span>
                  <select
                    value={l.automation?.id ?? ""}
                    onChange={(e) => void patch(l.id, { automationId: e.target.value || null })}
                    className="rounded-lg border border-border bg-surface-hover px-2 py-1 text-xs outline-none"
                  >
                    <option value="">{t("None, just tag the person")}</option>
                    {campaigns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.isActive ? "" : ` (${t("off")})`}
                      </option>
                    ))}
                  </select>
                </label>
                <span className="text-xs text-muted">
                  {t("Tag")}: <span className="font-semibold text-foreground">{l.tag}</span>
                </span>
                <span className="ml-auto flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setQrFor((prev) => (prev === l.id ? null : l.id))}
                    className="text-xs font-semibold text-accent hover:text-accent-hover"
                  >
                    {qrFor === l.id ? t("Hide QR") : t("Show QR")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(l)}
                    className="text-xs font-semibold text-error hover:opacity-80"
                  >
                    {t("Delete")}
                  </button>
                </span>
              </div>
              {l.automation && !l.automation.isActive && (
                <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs">
                  {t("The linked campaign is off: people get tagged, but no message goes out.")}
                </p>
              )}
              {qrFor === l.id && <QrCode text={l.clickUrl} label={l.code} />}
            </li>
          ))}
        </ul>
      )}

      <section className="panel space-y-1 rounded-2xl p-4 text-xs text-muted">
        <p className="font-semibold text-foreground">{t("Good to know")}</p>
        <p>{t("The link opens in the Instagram app (not on Instagram Web).")}</p>
        <p>{t("For a brand new conversation to carry the code, the account needs Ice Breakers set up (Meta's rule).")}</p>
        <p>{t("Any message the campaign sends follows the 24-hour rule: it only goes out after the person opened the conversation.")}</p>
      </section>
    </div>
  );
}
