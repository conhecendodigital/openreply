"use client";

/**
 * Campaign Builder
 *
 * Two-pane campaign editor: a control panel on the left and a live phone
 * preview on the right. Used for both creating and editing a campaign.
 *
 * Turn 1 wires the fully-functional pieces: trigger scope (specific / any /
 * next post), match mode (specific words / any word), the opening + reveal DM
 * text, public reply, and the tracked link. Button-driven delivery and the
 * follow / email / follow-up steps arrive in later turns.
 *
 * 2026-10-06: the campaign starts with "what fires it" (Automation.trigger):
 * comment on a post, message in the Direct, reply to a story (one story or
 * any), mention in someone's story, or comment during a live. Each trigger
 * only shows the steps that apply to it (same rules as
 * lib/automations/trigger.ts, which the API enforces anyway).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CampaignAbPanel } from "@/components/ab-test";
import { CollapsibleSection, SectionIndex, SectionsProvider } from "@/components/ui/collapsible-section";
import AccountSelect, { type AccountOption } from "@/components/account-select";
import PostPicker from "@/components/post-picker";
import CampaignPreview, { previewTabsFor, type PreviewTab, type PreviewTrigger } from "@/components/campaign-preview";
import { readCache, writeCache } from "@/lib/client-cache";
import {
  IMPORT_QUEUE_KEY,
  IMPORT_ACCOUNT_KEY,
  type ImportRow,
} from "@/lib/import-queue";

import { useT } from "@/components/lang-provider";
import { MediaUploadControl, MediaUploadProvider } from "@/components/funnels/media-upload";
import { getMediaUploader, type MediaUploadConfig, type MediaUploader } from "@/lib/funnels/media";
type TriggerScope = "specific" | "any" | "next";
/** Automation.dmFormat: card with buttons or the link inside the text. */
type DmFormat = "BUTTON" | "TEXT";
type MatchMode = "specific" | "any";
type Trigger = PreviewTrigger;

interface StoryItem {
  id: string;
  media_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp?: string;
}

/** The five triggers, in the order the owner reads them. */
const TRIGGERS: { value: Trigger; label: string; hint: string }[] = [
  { value: "COMMENT", label: "Comment on a post", hint: "Someone comments a word on a post or reel." },
  { value: "DM", label: "Message in the Direct", hint: "Someone sends you a DM with the word." },
  { value: "STORY_REPLY", label: "Story reply", hint: "Someone replies to your story with the word." },
  { value: "STORY_MENTION", label: "Story mention", hint: "Someone mentions you in their story." },
  { value: "LIVE_COMMENT", label: "Comment on a live", hint: "Someone comments the word during any of your lives." },
];

const usesPost = (t: Trigger) => t === "COMMENT";
const usesKeywords = (t: Trigger) => t !== "STORY_MENTION";
const allowsPublicReply = (t: Trigger) => t === "COMMENT";
const allowsOpeningDm = (t: Trigger) => t === "COMMENT" || t === "LIVE_COMMENT";

interface LoadedCampaign {
  id: string;
  name: string;
  trigger?: Trigger | null;
  storyId?: string | null;
  storyUrl?: string | null;
  postId: string | null;
  postUrl: string | null;
  pendingNextReel: boolean;
  matchAnyPost: boolean;
  keywords: string[];
  matchAnyWord: boolean;
  dmTriggerEnabled: boolean;
  dmMessage: string;
  dmFormat?: DmFormat | null;
  openingDmEnabled: boolean;
  openingDmMessage: string | null;
  openingDmButtonLabel: string | null;
  linkButtonLabel: string | null;
  requireFollow: boolean;
  followPromptMessage: string | null;
  followPromptButtonLabel: string | null;
  followUpEnabled: boolean;
  followUpMessage: string | null;
  followUpDelayMinutes: number | null;
  publicReplyEnabled: boolean;
  publicReplyMessage: string | null;
  publicReplyMessages: string[];
  isActive: boolean;
  instagramAccountId: string;
  trackedLinks?: {
    destinationUrl: string;
    label?: string | null;
    previewTitle?: string | null;
    previewDescription?: string | null;
    previewImageUrl?: string | null;
  }[];
}

interface CampaignBuilderProps {
  mode: "new" | "edit";
  campaignId?: string;
}

/** Bloco do editor: recolhível, com resumo de uma linha quando fechado. */
function Section({
  id,
  title,
  summary,
  defaultOpen = true,
  children,
}: {
  id: string;
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <CollapsibleSection id={id} title={title} summary={summary} defaultOpen={defaultOpen} variant="group" headingLevel={2}>
      {children}
    </CollapsibleSection>
  );
}

function Radio({
  checked,
  onSelect,
  children,
}: {
  checked: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
        checked ? "border-accent bg-accent/5" : "border-border hover:border-border-hover"
      }`}
    >
      <span
        className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border ${
          checked ? "border-accent" : "border-zinc-500"
        }`}
      >
        {checked && <span className="h-2 w-2 rounded-full bg-accent" />}
      </span>
      <span className="flex-1 text-foreground">{children}</span>
    </button>
  );
}

function Toggle({
  on,
  onToggle,
}: {
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
        on ? "bg-accent" : "bg-zinc-300"
      }`}
    >
      <span
        className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-transform ${
          on ? "left-6" : "left-1"
        }`}
      />
    </button>
  );
}

export default function CampaignBuilder({ mode, campaignId }: CampaignBuilderProps) {
  const t = useT();
  const router = useRouter();

  const [loading, setLoading] = useState(mode === "edit");
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");

  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(true);

  const [trigger, setTrigger] = useState<Trigger>("COMMENT");
  const [storyId, setStoryId] = useState<string | null>(null);
  const [storyUrl, setStoryUrl] = useState<string | null>(null);
  const [stories, setStories] = useState<StoryItem[] | null>(null);
  const [storiesError, setStoriesError] = useState(false);
  const [triggerScope, setTriggerScope] = useState<TriggerScope>("specific");
  const [postId, setPostId] = useState<string | null>(null);
  const [postUrl, setPostUrl] = useState<string | null>(null);
  const [postThumb, setPostThumb] = useState<string | null>(null);
  const [postCaption, setPostCaption] = useState("");

  // Post IDs already tied to another automation on this account, so the picker
  // can flag them and the user knows not to double-assign. Maps postId ->
  // the campaign name using it (for the tooltip).
  const [usedPosts, setUsedPosts] = useState<Record<string, string>>({});

  const [matchMode, setMatchMode] = useState<MatchMode>("specific");
  const matchModeBeforeMention = useRef<MatchMode>("specific");
  const [keywordText, setKeywordText] = useState("");
  const [dmTriggerEnabled, setDmTriggerEnabled] = useState(false);

  const [publicReplyEnabled, setPublicReplyEnabled] = useState(false);
  const [publicReplyMessages, setPublicReplyMessages] = useState<string[]>([""]);

  const [openingDmEnabled, setOpeningDmEnabled] = useState(false);
  const [openingDmMessage, setOpeningDmMessage] = useState("");
  const [openingDmButtonLabel, setOpeningDmButtonLabel] = useState("");

  const [dmMessage, setDmMessage] = useState("");
  // A NEW campaign starts as text with the link (shows in every Instagram,
  // Requests included). Editing loads what is saved (old ones are BUTTON).
  const [dmFormat, setDmFormat] = useState<DmFormat>(mode === "new" ? "TEXT" : "BUTTON");
  const [linkOpen, setLinkOpen] = useState(false);
  const [trackedDestinationUrl, setTrackedDestinationUrl] = useState("");
  const [linkButtonLabel, setLinkButtonLabel] = useState("Open link");
  const [secondLinkOpen, setSecondLinkOpen] = useState(false);
  const [secondaryDestinationUrl, setSecondaryDestinationUrl] = useState("");
  const [secondaryButtonLabel, setSecondaryButtonLabel] = useState("Open link");
  // Preview of the link (07/10/2026): the card Instagram/WhatsApp show.
  const [linkPreviewOpen, setLinkPreviewOpen] = useState(false);
  const [linkPreviewTitle, setLinkPreviewTitle] = useState("");
  const [linkPreviewDescription, setLinkPreviewDescription] = useState("");
  const [linkPreviewImageUrl, setLinkPreviewImageUrl] = useState("");
  const [previewUploader, setPreviewUploader] = useState<MediaUploader | null>(null);
  const [requireFollow, setRequireFollow] = useState(false);
  const [followPromptMessage, setFollowPromptMessage] = useState("");
  const [followPromptButtonLabel, setFollowPromptButtonLabel] =
    useState("i'm following");
  const [followUpEnabled, setFollowUpEnabled] = useState(false);
  const [followUpMessage, setFollowUpMessage] = useState("");
  const [followUpDelayMinutes, setFollowUpDelayMinutes] = useState(0);

  const [previewTab, setPreviewTab] = useState<PreviewTab>("dm");

  // CSV import queue. When present, each save advances to the next row instead
  // of returning to the campaigns list.
  const [importQueue, setImportQueue] = useState<ImportRow[] | null>(null);
  const [importTotal, setImportTotal] = useState(0);

  const keywords = useMemo(
    () =>
      keywordText
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean),
    [keywordText]
  );

  // Fetch the connected account's real avatar for the preview (cache-first so
  // it shows instantly on a return visit instead of a blank circle).
  useEffect(() => {
    if (!selectedAccountId) return;
    let cancelled = false;
    const cacheKey = `ig-avatar:${selectedAccountId}`;
    const cached = readCache<string | null>(cacheKey, 30 * 60 * 1000);
    // Hydrating state from cache is a legitimate effect use here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (cached.data !== null) setAvatarUrl(cached.data);

    const params = new URLSearchParams({ instagramAccountId: selectedAccountId });
    fetch(`/api/instagram/profile?${params}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const url = d.success ? d.data.profilePictureUrl ?? null : null;
        setAvatarUrl(url);
        writeCache(cacheKey, url);
      })
      .catch(() => {
        if (!cancelled && cached.data === null) setAvatarUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedAccountId]);

  // Load accounts (both modes need them for the preview username + selector).
  useEffect(() => {
    fetch("/api/dashboard/stats")
      .then((r) => r.json())
      .then((payload) => {
        if (!payload.success) return;
        const next: AccountOption[] = payload.data.instagramAccounts ?? [];
        setAccounts(next);
        setSelectedAccountId(
          (prev) => prev || payload.data.selectedInstagramAccountId || next[0]?.id || ""
        );
      })
      .catch(() => setAccounts([]));
  }, []);

  // Upload of the preview image: only when the server has the storage on.
  useEffect(() => {
    if (!linkPreviewOpen || previewUploader) return;
    let cancelled = false;
    fetch("/api/links/preview-image", { cache: "no-store" })
      .then((r) => r.json())
      .then((payload) => {
        if (cancelled || !payload?.success) return;
        const config = payload.data as MediaUploadConfig;
        setPreviewUploader(getMediaUploader({ ...config, funnelId: "", endpoint: "/api/links/preview-image" }));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [linkPreviewOpen, previewUploader]);

  // Prefill when editing.
  useEffect(() => {
    if (mode !== "edit" || !campaignId) return;
    fetch("/api/automations", { cache: "no-store" })
      .then((r) => r.json())
      .then((payload) => {
        if (!payload.success) return setNotFound(true);
        const c = (payload.data as LoadedCampaign[]).find((x) => x.id === campaignId);
        if (!c) return setNotFound(true);
        setName(c.name);
        setSelectedAccountId(c.instagramAccountId);
        const loadedTrigger: Trigger = c.trigger ?? "COMMENT";
        setTrigger(loadedTrigger);
        setStoryId(c.storyId ?? null);
        setStoryUrl(c.storyUrl ?? null);
        setPreviewTab(previewTabsFor(loadedTrigger, c.dmTriggerEnabled ?? false)[0]);
        setTriggerScope(
          c.matchAnyPost ? "any" : c.pendingNextReel ? "next" : "specific"
        );
        setPostId(c.postId);
        setPostUrl(c.postUrl);
        setMatchMode(c.matchAnyWord ? "any" : "specific");
        setKeywordText(c.keywords.join(", "));
        setDmTriggerEnabled(c.dmTriggerEnabled ?? false);
        setPublicReplyEnabled(c.publicReplyEnabled);
        setPublicReplyMessages(
          c.publicReplyMessages?.length
            ? c.publicReplyMessages
            : c.publicReplyMessage
              ? [c.publicReplyMessage]
              : [""]
        );
        setOpeningDmEnabled(c.openingDmEnabled);
        setOpeningDmMessage(c.openingDmMessage ?? "");
        setOpeningDmButtonLabel(c.openingDmButtonLabel ?? "");
        setDmMessage(c.dmMessage);
        setDmFormat(c.dmFormat === "TEXT" ? "TEXT" : "BUTTON");
        setLinkButtonLabel(c.linkButtonLabel ?? "Open link");
        setIsActive(c.isActive);
        const link = c.trackedLinks?.[0]?.destinationUrl ?? "";
        setTrackedDestinationUrl(link);
        setLinkOpen(Boolean(link));
        const first = c.trackedLinks?.[0];
        setLinkPreviewTitle(first?.previewTitle ?? "");
        setLinkPreviewDescription(first?.previewDescription ?? "");
        setLinkPreviewImageUrl(first?.previewImageUrl ?? "");
        setLinkPreviewOpen(Boolean(first?.previewTitle || first?.previewDescription || first?.previewImageUrl));
        const secondLink = c.trackedLinks?.[1];
        setSecondaryDestinationUrl(secondLink?.destinationUrl ?? "");
        setSecondaryButtonLabel(secondLink?.label ?? "Open link");
        setSecondLinkOpen(Boolean(secondLink?.destinationUrl));
        setRequireFollow(c.requireFollow ?? false);
        setFollowPromptMessage(c.followPromptMessage ?? "");
        setFollowPromptButtonLabel(
          c.followPromptButtonLabel ?? "i'm following"
        );
        setFollowUpEnabled(c.followUpEnabled ?? false);
        setFollowUpMessage(c.followUpMessage ?? "");
        setFollowUpDelayMinutes(c.followUpDelayMinutes ?? 0);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [mode, campaignId]);

  // Track which posts on the selected account are already assigned to an
  // automation, so the picker can highlight them. The campaign being edited is
  // excluded — its own post should read as selected, not "taken".
  useEffect(() => {
    if (!selectedAccountId) return;
    let cancelled = false;
    fetch("/api/automations", { cache: "no-store" })
      .then((r) => r.json())
      .then((payload) => {
        if (cancelled || !payload.success) return;
        const map: Record<string, string> = {};
        for (const a of payload.data as LoadedCampaign[]) {
          if (!a.postId) continue;
          if ((a.trigger ?? "COMMENT") !== "COMMENT") continue;
          if (a.instagramAccountId !== selectedAccountId) continue;
          if (mode === "edit" && a.id === campaignId) continue;
          map[a.postId] = a.name;
        }
        setUsedPosts(map);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedAccountId, mode, campaignId]);

  // Stories that are still up (24 h), for the "one story" picker. Loaded only
  // when the story-reply trigger is picked.
  useEffect(() => {
    if (trigger !== "STORY_REPLY" || !selectedAccountId) return;
    let cancelled = false;
    const params = new URLSearchParams({ instagramAccountId: selectedAccountId });
    fetch(`/api/instagram/stories?${params}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((payload) => {
        if (cancelled) return;
        if (payload.success) {
          setStories(payload.data as StoryItem[]);
          setStoriesError(false);
        } else {
          setStories([]);
          setStoriesError(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStories([]);
          setStoriesError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [trigger, selectedAccountId]);

  function chooseTrigger(next: Trigger) {
    setTrigger(next);
    setError(null);
    setPreviewTab(previewTabsFor(next, dmTriggerEnabled)[0]);
    // A story mention has no word; the other triggers keep what was typed.
    // Leaving it restores the match mode the owner had before.
    if (!usesKeywords(next)) {
      if (usesKeywords(trigger)) matchModeBeforeMention.current = matchMode;
      setMatchMode("any");
    } else if (!usesKeywords(trigger)) {
      setMatchMode(matchModeBeforeMention.current);
    }
  }

  // Prefill the editable fields from one queued import row. The reel is left
  // unset so the user picks it per row.
  function prefillFromRow(row: ImportRow) {
    setName(row.name ?? "");
    setTrigger("COMMENT");
    setStoryId(null);
    setStoryUrl(null);
    setTriggerScope("specific");
    setPostId(null);
    setPostUrl(null);
    setPostThumb(null);
    setPostCaption("");
    setMatchMode("specific");
    setKeywordText((row.keywords ?? []).join(", "));
    setDmMessage(row.dmMessage ?? "");
    setPublicReplyEnabled(Boolean(row.publicReply));
    setPublicReplyMessages(row.publicReply ? [row.publicReply] : [""]);
    const hasOpening = Boolean(row.openingDmMessage);
    setOpeningDmEnabled(hasOpening);
    setOpeningDmMessage(row.openingDmMessage ?? "");
    setOpeningDmButtonLabel(
      row.openingDmButtonLabel || (hasOpening ? "Send link" : "")
    );
    const link = row.trackedUrl ?? "";
    setTrackedDestinationUrl(link);
    setLinkOpen(Boolean(link));
    setError(null);
  }

  // Pick up a staged CSV import (new mode only) and prefill the first row.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (mode !== "new") return;
    try {
      const raw = window.localStorage.getItem(IMPORT_QUEUE_KEY);
      const acct = window.localStorage.getItem(IMPORT_ACCOUNT_KEY);
      if (!raw) return;
      const queue = JSON.parse(raw) as ImportRow[];
      if (!Array.isArray(queue) || queue.length === 0) return;
      setImportQueue(queue);
      setImportTotal(queue.length);
      if (acct) setSelectedAccountId(acct);
      prefillFromRow(queue[0]);
    } catch {
      // ignore a malformed queue
    }
  }, [mode]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const username =
    accounts.find((a) => a.id === selectedAccountId)?.username ?? "yourbrand";

  function handlePostSelect(
    id: string,
    url?: string,
    thumb?: string,
    caption?: string
  ) {
    setPostId(id);
    setPostUrl(url ?? null);
    setPostThumb(thumb ?? null);
    setPostCaption(caption ?? "");
  }

  function ensureLinkToken() {
    setDmMessage((cur) => (cur.includes("{link}") ? cur : `${cur.trim()} {link}`.trim()));
  }

  async function handleSubmit(activeValue: boolean) {
    setError(null);

    if (!selectedAccountId) return setError("Connect an Instagram account first.");
    if (usesPost(trigger) && triggerScope === "specific" && !postId)
      return setError("Pick a post or reel to trigger the campaign.");
    if (usesKeywords(trigger) && matchMode === "specific" && keywords.length === 0)
      return setError("Add at least one keyword, or switch to any word.");
    if (trigger === "STORY_REPLY" && storyId === "")
      return setError("Pick a story, or choose any of your stories.");
    if (!dmMessage.trim()) return setError("Add the DM with the link.");
    const withOpeningDm = allowsOpeningDm(trigger) && openingDmEnabled;
    const withPublicReply = allowsPublicReply(trigger) && publicReplyEnabled;
    if (withOpeningDm && (!openingDmMessage.trim() || !openingDmButtonLabel.trim()))
      return setError("Your opening DM needs a message and a button label.");

    setSaving(true);

    const payload = {
      name: name.trim() || `Campaign for @${username}`,
      instagramAccountId: selectedAccountId,
      trigger,
      storyId: trigger === "STORY_REPLY" ? storyId : null,
      storyUrl: trigger === "STORY_REPLY" && storyId ? storyUrl : null,
      postId: usesPost(trigger) && triggerScope === "specific" ? postId : null,
      postUrl: usesPost(trigger) && triggerScope === "specific" ? postUrl : null,
      matchAnyPost: usesPost(trigger) && triggerScope === "any",
      pendingNextReel: usesPost(trigger) && triggerScope === "next",
      matchAnyWord: !usesKeywords(trigger) || matchMode === "any",
      keywords: !usesKeywords(trigger) || matchMode === "any" ? [] : keywords,
      dmTriggerEnabled: trigger === "DM" ? true : trigger === "COMMENT" ? dmTriggerEnabled : false,
      dmMessage,
      dmFormat,
      openingDmEnabled: withOpeningDm,
      openingDmMessage: withOpeningDm ? openingDmMessage : null,
      openingDmButtonLabel: withOpeningDm ? openingDmButtonLabel : null,
      publicReplyEnabled: withPublicReply,
      publicReplyMessages: withPublicReply
        ? publicReplyMessages.map((m) => m.trim()).filter(Boolean)
        : [],
      trackedDestinationUrl: trackedDestinationUrl.trim() || "",
      linkPreviewTitle: linkPreviewTitle.trim() || null,
      linkPreviewDescription: linkPreviewDescription.trim() || null,
      linkPreviewImageUrl: linkPreviewImageUrl.trim() || null,
      linkButtonLabel: linkButtonLabel.trim() || "Open link",
      secondaryDestinationUrl: secondaryDestinationUrl.trim() || "",
      secondaryButtonLabel: secondaryButtonLabel.trim() || "Open link",
      requireFollow,
      followPromptMessage: requireFollow ? followPromptMessage.trim() : "",
      followPromptButtonLabel: requireFollow
        ? followPromptButtonLabel.trim() || "i'm following"
        : "",
      followUpEnabled,
      followUpMessage: followUpEnabled ? followUpMessage.trim() : "",
      followUpDelayMinutes: followUpEnabled ? followUpDelayMinutes : 0,
      isActive: activeValue,
    };

    try {
      const res =
        mode === "new"
          ? await fetch("/api/automations", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            })
          : await fetch(`/api/automations?id=${campaignId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });
      const data = await res.json();
      if (data.success) {
        // The post we just assigned is now in use. Reflect it immediately so
        // the picker flags it on the next imported row — the fetch that builds
        // this map doesn't re-run while the builder stays mounted through the
        // import queue.
        if (usesPost(trigger) && triggerScope === "specific" && postId) {
          const assignedPostId = postId;
          setUsedPosts((prev) => ({ ...prev, [assignedPostId]: payload.name }));
        }
        // Importing: advance to the next queued row instead of leaving.
        if (importQueue && importQueue.length > 1) {
          const remaining = importQueue.slice(1);
          try {
            window.localStorage.setItem(
              IMPORT_QUEUE_KEY,
              JSON.stringify(remaining)
            );
          } catch {
            // ignore
          }
          setImportQueue(remaining);
          prefillFromRow(remaining[0]);
          setSaving(false);
          if (typeof window !== "undefined") window.scrollTo({ top: 0 });
          return;
        }
        if (importQueue) {
          try {
            window.localStorage.removeItem(IMPORT_QUEUE_KEY);
            window.localStorage.removeItem(IMPORT_ACCOUNT_KEY);
          } catch {
            // ignore
          }
        }
        // refresh() busts the router cache so the list reflects the save
        // instead of landing on a stale (empty) campaigns page.
        router.push("/campaigns");
        router.refresh();
      } else {
        // Surface the specific field that failed validation instead of a
        // generic "Invalid input".
        const fieldErrors = data.details?.fieldErrors as
          | Record<string, string[]>
          | undefined;
        const firstField = fieldErrors && Object.keys(fieldErrors)[0];
        setError(
          firstField
            ? `${firstField}: ${fieldErrors[firstField][0]}`
            : data.error ?? "Failed to save campaign"
        );
        if (typeof window !== "undefined")
          window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch {
      setError("Failed to save campaign");
    } finally {
      setSaving(false);
    }
  }

  // Skip the current imported row without saving a campaign for it, advancing
  // to the next one (or finishing the import if it was the last).
  function skipRow() {
    if (!importQueue) return;
    setError(null);
    if (importQueue.length > 1) {
      const remaining = importQueue.slice(1);
      try {
        window.localStorage.setItem(IMPORT_QUEUE_KEY, JSON.stringify(remaining));
      } catch {
        // ignore
      }
      setImportQueue(remaining);
      prefillFromRow(remaining[0]);
      if (typeof window !== "undefined") window.scrollTo({ top: 0 });
      return;
    }
    // Last row skipped — finish the import.
    try {
      window.localStorage.removeItem(IMPORT_QUEUE_KEY);
      window.localStorage.removeItem(IMPORT_ACCOUNT_KEY);
    } catch {
      // ignore
    }
    router.push("/campaigns");
    router.refresh();
  }

  if (loading) {
    return <div className="panel h-64 rounded" />;
  }

  if (notFound) {
    return (
      <div className="panel rounded p-8 text-center">
        <p className="text-sm text-muted">{t("Campaign not found.")}</p>
        <button
          onClick={() => router.push("/campaigns")}
          className="mt-4 rounded border border-border px-4 py-2 text-sm text-muted hover:text-foreground"
        >
          {t("Back to campaigns")}
        </button>
      </div>
    );
  }

  const cut = (s: string, n = 60) => (s.trim().length > n ? `${s.trim().slice(0, n)}…` : s.trim());
  const beforeLink = [
    allowsOpeningDm(trigger) && openingDmEnabled ? t("an opening DM") : "",
    requireFollow ? t("a follow requirement first") : "",
  ].filter(Boolean);

  return (
    <SectionsProvider page="campanha">
    <div className="space-y-6">
      {importQueue && (
        <div className="rounded border border-accent/30 bg-accent/5 px-4 py-3 text-sm">
          <span className="font-medium text-foreground">
            {t("Importing")} {importTotal - importQueue.length + 1} {t("of")} {importTotal}.
          </span>{" "}
          <span className="text-muted">
            {t("Fields are prefilled from your CSV. Pick the reel, edit anything, and save to load the next one — or Skip if you don’t want this one.")}
          </span>
        </div>
      )}

      {/* Top bar */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 items-center gap-3">
          {mode === "edit" ? (
            <>
              <span className="truncate text-sm font-semibold text-foreground">
                {name || t("Untitled campaign")}
              </span>
              <span
                className={`rounded px-2 py-0.5 text-xs font-semibold ${
                  isActive ? "bg-success/15 text-success" : "bg-zinc-500/15 text-muted"
                }`}
              >
                {isActive ? t("LIVE") : t("PAUSED")}
              </span>
            </>
          ) : (
            <span className="text-sm text-muted">{t("New campaign")}</span>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {importQueue && (
            <button
              type="button"
              onClick={skipRow}
              disabled={saving}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted hover:text-foreground disabled:opacity-50"
            >
              {importQueue.length > 1 ? t("Skip") : t("Skip & finish")}
            </button>
          )}
          {mode === "edit" &&
            (isActive ? (
              <button
                type="button"
                onClick={() => handleSubmit(false)}
                disabled={saving}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted hover:text-foreground disabled:opacity-50"
              >
                {t("Stop")}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleSubmit(true)}
                disabled={saving}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted hover:text-foreground disabled:opacity-50"
              >
                {t("Go Live")}
              </button>
            ))}
          <button
            type="button"
            onClick={() => handleSubmit(mode === "new" ? true : isActive)}
            disabled={saving}
            className="rounded-lg bg-accent px-5 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {saving ? t("Saving…") : mode === "new" ? t("Go Live") : t("Save changes")}
          </button>
        </div>
      </div>

      {/* min-w-0 on the cells: a grid item defaults to min-width:auto, so a
          long string widens the whole page instead of wrapping. */}
      <SectionIndex />

      <div className="grid gap-6 lg:grid-cols-[300px_1fr] lg:gap-8">
      {/* Left: controls */}
      <div className="space-y-4 min-w-0">
        {error && (
          <div className="rounded border border-error/20 bg-error/10 p-3 text-sm text-error">
            {t(error)}
          </div>
        )}

        <div className="space-y-3">
          <label className="text-sm font-semibold text-foreground">
            {t("Campaign name")}{" "}
            <span className="font-normal text-muted">{t("(optional)")}</span>
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("e.g. YC referral")}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
            maxLength={100}
          />
          {accounts.length > 1 && (
            <div className="pt-2">
              <AccountSelect
                accounts={accounts}
                value={selectedAccountId}
                onChange={(id) => {
                  setSelectedAccountId(id);
                  setPostId(null);
                  setPostUrl(null);
                  setPostThumb(null);
                }}
                includeAll={false}
                label="Instagram account"
              />
            </div>
          )}
        </div>

        <Section id="campanha-gatilho" title={t("What starts the campaign")} summary={t(TRIGGERS.find((x) => x.value === trigger)?.label ?? "Comment on a post")}>
          <div className="grid gap-2" role="radiogroup" aria-label={t("What starts the campaign")}>
            {TRIGGERS.map((opt) => (
              <Radio key={opt.value} checked={trigger === opt.value} onSelect={() => chooseTrigger(opt.value)}>
                <span className="block font-medium">{t(opt.label)}</span>
                <span className="block text-xs text-muted">{t(opt.hint)}</span>
              </Radio>
            ))}
          </div>
        </Section>

        {trigger === "STORY_REPLY" && (
          <Section id="campanha-story" title={t("When someone replies to")} summary={storyId === null ? t("any of your stories") : t("a specific story")}>
            <Radio
              checked={storyId === null}
              onSelect={() => {
                setStoryId(null);
                setStoryUrl(null);
              }}
            >
              {t("any of your stories")}
            </Radio>
            <Radio
              checked={storyId !== null}
              onSelect={() => {
                // "" = specific story, not picked yet.
                if (storyId === null) setStoryId("");
              }}
            >
              {t("a specific story")}
            </Radio>
            {storyId !== null && (
              <div className="rounded-lg border border-border p-2">
                {stories === null ? (
                  <p className="px-1 py-3 text-xs text-muted">{t("Loading...")}</p>
                ) : storiesError ? (
                  <p className="px-1 py-3 text-xs text-error">{t("Could not load your stories. Try again in a moment.")}</p>
                ) : stories.length === 0 ? (
                  <p className="px-1 py-3 text-xs text-muted">
                    {t("No story up right now. Post one, or pick any of your stories.")}
                  </p>
                ) : (
                  <div className="grid grid-cols-4 gap-1.5">
                    {stories.map((st) => {
                      const thumb = st.thumbnail_url || st.media_url || null;
                      const picked = st.id === storyId;
                      return (
                        <button
                          key={st.id}
                          type="button"
                          onClick={() => {
                            setStoryId(st.id);
                            setStoryUrl(st.permalink ?? null);
                          }}
                          aria-pressed={picked}
                          className={`relative aspect-[9/16] overflow-hidden rounded-md bg-surface-hover ring-offset-1 ${
                            picked ? "ring-2 ring-accent" : "hover:opacity-80"
                          }`}
                        >
                          {thumb && (
                            // eslint-disable-next-line @next/next/no-img-element -- Meta CDN story thumbnail
                            <img src={thumb} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
                {storyId && stories && !stories.some((st) => st.id === storyId) && (
                  <p className="mt-2 px-1 text-xs text-muted">
                    {t("The chosen story is no longer up (stories last 24 h), so this campaign will not fire again. Pick another or any story.")}
                  </p>
                )}
              </div>
            )}
          </Section>
        )}

        {trigger === "STORY_MENTION" && (
          <p className="rounded-lg border border-border bg-surface px-3 py-2.5 text-xs text-muted">
            {t("Every time someone mentions you in their story, they get the message below, once per person. No word needed.")}
          </p>
        )}

        {trigger === "LIVE_COMMENT" && (
          <p className="rounded-lg border border-border bg-surface px-3 py-2.5 text-xs text-muted">
            {t("Works on any live you start. Instagram only sends comments while the live is on, and there is no public reply: the message goes straight to their Direct.")}
          </p>
        )}

        {trigger === "COMMENT" && (
        <Section
          id="campanha-post"
          title={t("When someone comments on")}
          summary={triggerScope === "specific" ? t("a specific post or reel") : triggerScope === "any" ? t("any post or reel") : t("next post or reel")}
        >
          <Radio
            checked={triggerScope === "specific"}
            onSelect={() => setTriggerScope("specific")}
          >
            {t("a specific post or reel")}
          </Radio>
          {triggerScope === "specific" && (
            <div className="rounded-lg border border-border p-2">
              <PostPicker
                selectedPostId={postId}
                instagramAccountId={selectedAccountId}
                usedPostIds={usedPosts}
                onSelect={handlePostSelect}
              />
            </div>
          )}
          <Radio
            checked={triggerScope === "any"}
            onSelect={() => setTriggerScope("any")}
          >
            {t("any post or reel")}
          </Radio>
          <Radio
            checked={triggerScope === "next"}
            onSelect={() => setTriggerScope("next")}
          >
            {t("next post or reel")}
          </Radio>
        </Section>
        )}

        {usesKeywords(trigger) && (
        <Section
          id="campanha-palavras"
          summary={matchMode === "specific" ? cut(keywordText) || t("a specific word or words") : t("any word")}
          title={
            trigger === "DM"
              ? t("And the message has")
              : trigger === "STORY_REPLY"
                ? t("And the reply has")
                : t("And this comment has")
          }
        >
          <Radio
            checked={matchMode === "specific"}
            onSelect={() => setMatchMode("specific")}
          >
            {t("a specific word or words")}
          </Radio>
          {matchMode === "specific" && (
            <div className="space-y-1">
              <input
                value={keywordText}
                onChange={(e) => setKeywordText(e.target.value)}
                placeholder={t("Enter a word or multiple")}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
              />
              <p className="text-xs text-muted">{t("Use commas to separate words")}</p>
            </div>
          )}
          <Radio
            checked={matchMode === "any"}
            onSelect={() => setMatchMode("any")}
          >
            {t("any word")}
          </Radio>
          {trigger === "DM" && matchMode === "any" && (
            <p className="text-xs text-muted">{t("Every DM to this account gets the reply below — use with care.")}</p>
          )}
          {trigger === "COMMENT" && (
          <>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
            <span className="text-sm text-foreground">
              {t("also reply when someone DMs")}{" "}
              {matchMode === "any" ? t("anything") : t("these words")}
            </span>
            <Toggle
              on={dmTriggerEnabled}
              onToggle={() => setDmTriggerEnabled(!dmTriggerEnabled)}
            />
          </div>
          {dmTriggerEnabled && (
            <p className="text-xs text-muted">
              {matchMode === "any"
                ? t("Every DM to this account gets the reply below — use with care.")
                : t("A DM containing any of these words gets the same reply, no comment needed.")}
            </p>
          )}
          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
            <span className="text-sm text-foreground">
              {t("reply to their comments under the post")}
            </span>
            <Toggle
              on={publicReplyEnabled}
              onToggle={() => setPublicReplyEnabled(!publicReplyEnabled)}
            />
          </div>
          {publicReplyEnabled && (
            <div className="space-y-2">
              {publicReplyMessages.map((msg, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={msg}
                    onChange={(e) =>
                      setPublicReplyMessages((prev) =>
                        prev.map((m, idx) => (idx === i ? e.target.value : m))
                      )
                    }
                    placeholder={t("Sent you a DM! 📩")}
                    maxLength={1000}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
                  />
                  {publicReplyMessages.length > 1 && (
                    <button
                      type="button"
                      onClick={() =>
                        setPublicReplyMessages((prev) =>
                          prev.filter((_, idx) => idx !== i)
                        )
                      }
                      className="shrink-0 px-2 text-muted hover:text-error"
                      aria-label={t("Remove reply")}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
              {publicReplyMessages.length < 10 && (
                <button
                  type="button"
                  onClick={() =>
                    setPublicReplyMessages((prev) => [...prev, ""])
                  }
                  className="text-xs font-medium text-accent hover:underline"
                >
                  {t("+ Add another reply")}
                </button>
              )}
              <p className="text-xs text-muted">
                {t("One is picked at random each time, so replies don't look identical.")}
              </p>
            </div>
          )}
          </>
          )}
        </Section>
        )}

        <Section id="campanha-antes" title={t("They will get")} summary={beforeLink.join(" · ") || t("a DM with a link")}>
          {allowsOpeningDm(trigger) && (
          <div className="mb-3 rounded-lg border border-border p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground">{t("an opening DM")}</span>
              <Toggle
                on={openingDmEnabled}
                onToggle={() => setOpeningDmEnabled(!openingDmEnabled)}
              />
            </div>
            {openingDmEnabled && (
              <div className="mt-3 space-y-2">
                <textarea
                  value={openingDmMessage}
                  onChange={(e) => setOpeningDmMessage(e.target.value)}
                  placeholder={t("Hey there! I'm so happy you're here 😊")}
                  rows={3}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none resize-none"
                  maxLength={1000}
                />
                <input
                  value={openingDmButtonLabel}
                  onChange={(e) => setOpeningDmButtonLabel(e.target.value)}
                  placeholder={t("Send me the link")}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
                  maxLength={64}
                />
              </div>
            )}
          </div>
          )}
          <div className="rounded-lg border border-border p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground">
                {t("a follow requirement first")}
              </span>
              <Toggle
                on={requireFollow}
                onToggle={() => setRequireFollow(!requireFollow)}
              />
            </div>
            {requireFollow && (
              <div className="mt-3 space-y-2">
                <textarea
                  value={followPromptMessage}
                  onChange={(e) => setFollowPromptMessage(e.target.value)}
                  placeholder={t("quick favor before i send your link. i don't make any money from this, it's free. if you want to support me, just don't unfollow after, and star the repo on github if it helps you. tap the button once you're following and i'll send it over")}
                  rows={3}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none resize-none"
                  maxLength={1000}
                />
                <input
                  value={followPromptButtonLabel}
                  onChange={(e) => setFollowPromptButtonLabel(e.target.value)}
                  placeholder={t("i'm following")}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
                  maxLength={20}
                />
                <p className="text-xs text-muted">
                  {t("We send the link only after they tap the button and Instagram confirms the follow. If it can't be verified, we send it anyway.")}
                </p>
              </div>
            )}
          </div>
        </Section>

        <Section id="campanha-depois" title={t("And then, they will get")} summary={cut(dmMessage) || t("a DM with a link")}>
          <div className="rounded-lg border border-border p-3 space-y-2">
            <span className="text-sm text-foreground">{t("a DM with a link")}</span>
            <textarea
              value={dmMessage}
              onChange={(e) => setDmMessage(e.target.value)}
              placeholder={t("Write a message")}
              rows={3}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none resize-none"
              maxLength={1000}
            />
            {linkOpen ? (
              <div className="space-y-2">
                <input
                  value={trackedDestinationUrl}
                  onChange={(e) => setTrackedDestinationUrl(e.target.value)}
                  onBlur={ensureLinkToken}
                  placeholder="https://yourlink.com/offer"
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
                />
                <input
                  value={linkButtonLabel}
                  onChange={(e) => setLinkButtonLabel(e.target.value)}
                  placeholder={t("Button label (e.g. Open link)")}
                  maxLength={20}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
                />
                {linkPreviewOpen ? (
                  <div className="space-y-2 rounded-lg border border-border p-3">
                    <span className="text-sm text-foreground">{t("Link preview")}</span>
                    <p className="text-xs text-muted">
                      {t("What Instagram and WhatsApp show in the link's card. Empty fields come from the quiz cover or from the page of the link.")}
                    </p>
                    <input
                      value={linkPreviewTitle}
                      onChange={(e) => setLinkPreviewTitle(e.target.value)}
                      placeholder={t("Preview title")}
                      maxLength={120}
                      className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
                    />
                    <textarea
                      value={linkPreviewDescription}
                      onChange={(e) => setLinkPreviewDescription(e.target.value)}
                      placeholder={t("Preview description")}
                      rows={2}
                      maxLength={300}
                      className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none resize-none"
                    />
                    <input
                      value={linkPreviewImageUrl}
                      onChange={(e) => setLinkPreviewImageUrl(e.target.value)}
                      placeholder={t("Preview image link (https://)")}
                      type="url"
                      className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
                    />
                    {linkPreviewImageUrl.trim() && !linkPreviewImageUrl.trim().startsWith("https://") && (
                      <p className="text-xs text-error">{t("Use an https:// image link")}</p>
                    )}
                    <MediaUploadProvider value={{ uploader: previewUploader, files: [], addFile: () => undefined }}>
                      <MediaUploadControl kind="image" onUploaded={setLinkPreviewImageUrl} />
                    </MediaUploadProvider>
                    <p className="text-xs text-muted">{t("Best size: 1200 x 630 pixels.")}</p>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setLinkPreviewOpen(true)}
                    className="w-full rounded-lg border border-border py-2 text-sm text-muted hover:text-foreground"
                  >
                    {t("+ Change the link preview")}
                  </button>
                )}
                {secondLinkOpen ? (
                  <div className="space-y-2 border-t border-border pt-2">
                    <input
                      value={secondaryDestinationUrl}
                      onChange={(e) => setSecondaryDestinationUrl(e.target.value)}
                      placeholder="https://yourlink.com/second"
                      className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
                    />
                    <input
                      value={secondaryButtonLabel}
                      onChange={(e) => setSecondaryButtonLabel(e.target.value)}
                      placeholder={t("Second button label")}
                      maxLength={20}
                      className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setSecondLinkOpen(true)}
                    className="w-full rounded-lg border border-border py-2 text-sm text-muted hover:text-foreground"
                  >
                    {t("+ Add A Second Link")}
                  </button>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setLinkOpen(true)}
                className="w-full rounded-lg border border-border py-2 text-sm text-muted hover:text-foreground"
              >
                {t("+ Add A Link")}
              </button>
            )}
            <p className="text-xs text-muted">
              {t("{link}")} {t("inserts the tracked link;")} {t("{username}")} {t("personalizes.")}
            </p>
            <div className="space-y-2 border-t border-border pt-3">
              <span className="text-sm text-foreground">{t("DM format")}</span>
              <div className="grid gap-2 sm:grid-cols-2">
                <Radio checked={dmFormat === "TEXT"} onSelect={() => setDmFormat("TEXT")}>
                  {t("Text with the link")}
                </Radio>
                <Radio checked={dmFormat === "BUTTON"} onSelect={() => setDmFormat("BUTTON")}>
                  {t("Card with a button")}
                </Radio>
              </div>
              <p className="text-xs text-muted">
                {t("Text with a link shows for everyone, even in Requests. The card with a button looks nicer, but some Instagram versions do not show it.")}
              </p>
              {dmFormat === "TEXT" && (
                <p className="text-xs text-muted">
                  {t("Without {link}, the link goes at the end, on its own line. The second link goes on the line below, with its label. The opening DM and the follow request keep their button.")}
                </p>
              )}
            </div>
          </div>
          <div className="mt-3 rounded-lg border border-border p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground">
                {t("a follow-up thank-you message")}
              </span>
              <Toggle
                on={followUpEnabled}
                onToggle={() => setFollowUpEnabled(!followUpEnabled)}
              />
            </div>
            {followUpEnabled && (
              <div className="mt-3 space-y-2">
                <textarea
                  value={followUpMessage}
                  onChange={(e) => setFollowUpMessage(e.target.value)}
                  placeholder={t("Btw just wanted to say thanks for following me, I appreciate the support 🙌")}
                  rows={3}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none resize-none"
                  maxLength={1000}
                />
                <div className="flex flex-wrap items-center gap-2 text-sm text-foreground">
                  <span className="text-xs text-muted">{t("Send it")}</span>
                  <input
                    type="number"
                    min={0}
                    max={1440}
                    value={followUpDelayMinutes}
                    onChange={(e) =>
                      setFollowUpDelayMinutes(
                        Math.max(0, Math.min(1440, Math.floor(Number(e.target.value) || 0)))
                      )
                    }
                    className="w-20 rounded-lg border border-border bg-surface px-2 py-1 text-sm text-foreground focus:border-accent/40 focus:outline-none"
                  />
                  <span className="text-xs text-muted">
                    {t("minutes after the link")}
                  </span>
                </div>
                <p className="text-xs text-muted">
                  {followUpDelayMinutes > 0
                    ? `Sent ${followUpDelayMinutes} min after they tap through.`
                    : t("Sent right after they tap through.")}
                  {t("{username}")} {t("personalizes it. Max 24 hours, to stay inside Instagram's messaging window.")}
                </p>
              </div>
            )}
          </div>
        </Section>

        {/* 2026-10-08 (Etapa 5): optional A/B test, saved by its own route.
            "Save changes" above never touches it, and with it off the
            campaign sends exactly its own texts. */}
        <Section id="campanha-ab" title={t("A/B test (optional)")} defaultOpen={false} summary={mode === "edit" && campaignId ? undefined : t("Save the campaign first, then test variants of its messages here.")}>
          {mode === "edit" && campaignId ? (
            <CampaignAbPanel campaignId={campaignId} />
          ) : (
            <p className="text-xs text-muted">{t("Save the campaign first, then test variants of its messages here.")}</p>
          )}
        </Section>
      </div>

      {/* Right: preview */}
      <div>
        <p className="mb-4 text-sm text-muted">{t("Preview")}</p>
        <div className="flex min-w-0 justify-center lg:sticky lg:top-6 lg:block">
          <CampaignPreview
            tab={previewTab}
            onTabChange={setPreviewTab}
            trigger={trigger}
            storyThumb={(() => {
              const st = stories?.find((x) => x.id === storyId);
              return st ? st.thumbnail_url || st.media_url || null : null;
            })()}
            username={username}
            avatarUrl={avatarUrl}
            postThumb={postThumb}
            caption={postCaption}
            sampleComment={usesKeywords(trigger) ? keywords[0] ?? "" : ""}
            dmTriggerEnabled={trigger === "COMMENT" && dmTriggerEnabled}
            publicReplyEnabled={allowsPublicReply(trigger) && publicReplyEnabled}
            publicReplyMessage={publicReplyMessages.find((m) => m.trim()) ?? ""}
            openingDmEnabled={allowsOpeningDm(trigger) && openingDmEnabled}
            openingDmMessage={openingDmMessage}
            openingDmButtonLabel={openingDmButtonLabel}
            revealMessage={dmMessage}
            hasLink={Boolean(trackedDestinationUrl.trim())}
            linkButtonLabel={linkButtonLabel || "Open link"}
            linkUrl={trackedDestinationUrl.trim() || undefined}
            hasSecondLink={
              secondLinkOpen && Boolean(secondaryDestinationUrl.trim())
            }
            secondLinkButtonLabel={secondaryButtonLabel || "Open link"}
            secondLinkUrl={secondaryDestinationUrl.trim() || undefined}
            dmFormat={dmFormat}
            requireFollow={requireFollow}
            followPromptMessage={followPromptMessage}
            followPromptButtonLabel={followPromptButtonLabel || "i'm following"}
            followUpEnabled={followUpEnabled}
            followUpMessage={followUpMessage}
            followUpDelayMinutes={followUpDelayMinutes}
          />
        </div>
      </div>
      </div>
    </div>
    </SectionsProvider>
  );
}
