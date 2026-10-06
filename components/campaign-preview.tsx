"use client";

import { useT } from "@/components/lang-provider";
import { composeLinkText } from "@/lib/tracking/message";

/* eslint-disable @next/next/no-img-element */

/**
 * Campaign Preview
 *
 * Fixed-size iPhone 17 Pro mockup that simulates how a campaign appears on
 * Instagram across three screens (Post, Comments, DM). Every screen renders in
 * the identical frame so switching tabs never resizes the phone.
 *
 * 2026-10-06: the preview follows the campaign trigger. Story replies and
 * mentions get a Story screen, live comments a Live screen, and the DM thread
 * starts the way the conversation really starts (reply to the story, mention
 * card, or the person's own message).
 */

export type PreviewTab = "post" | "comments" | "dm" | "dmTrigger" | "story" | "live";

/** Same values as Automation.trigger (lib/automations/trigger.ts). */
export type PreviewTrigger = "COMMENT" | "DM" | "STORY_REPLY" | "STORY_MENTION" | "LIVE_COMMENT";

/** Tabs shown for each trigger, in order. The first one is the default. */
export function previewTabsFor(trigger: PreviewTrigger, dmTriggerEnabled = false): PreviewTab[] {
  switch (trigger) {
    case "DM":
      return ["dmTrigger"];
    case "STORY_REPLY":
    case "STORY_MENTION":
      return ["story", "dm"];
    case "LIVE_COMMENT":
      return ["live", "dm"];
    default:
      return ["post", "comments", "dm", ...(dmTriggerEnabled ? (["dmTrigger"] as const) : [])];
  }
}

const TAB_LABELS: Record<PreviewTab, string> = {
  post: "Post",
  comments: "Comments",
  dm: "DM",
  dmTrigger: "DM trigger",
  story: "Story",
  live: "Live",
};

interface CampaignPreviewProps {
  tab: PreviewTab;
  /** What starts the campaign. Defaults to a post comment. */
  trigger?: PreviewTrigger;
  /** Thumbnail of the chosen story (story reply on one story). */
  storyThumb?: string | null;
  onTabChange: (tab: PreviewTab) => void;
  username: string;
  avatarUrl: string | null;
  postThumb: string | null;
  caption: string;
  sampleComment: string;
  // The DM keyword trigger gets its own thread: the user messages first, and
  // the opening DM is skipped because the conversation is already open.
  dmTriggerEnabled: boolean;
  publicReplyEnabled: boolean;
  publicReplyMessage: string;
  openingDmEnabled: boolean;
  openingDmMessage: string;
  openingDmButtonLabel: string;
  revealMessage: string;
  hasLink: boolean;
  linkButtonLabel: string;
  linkUrl?: string;
  hasSecondLink: boolean;
  secondLinkButtonLabel: string;
  secondLinkUrl?: string;
  /** BUTTON = card with buttons (default); TEXT = the link inside the text. */
  dmFormat?: "BUTTON" | "TEXT";
  requireFollow: boolean;
  followPromptMessage: string;
  followPromptButtonLabel: string;
  followUpEnabled: boolean;
  followUpMessage: string;
  followUpDelayMinutes?: number;
}

const SAMPLE_USER = "username";

/* ----------------------------- icons ----------------------------- */

const S = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

const Ico = {
  back: (c = "") => (
    <svg viewBox="0 0 24 24" className={c} {...S}><path d="M15 18l-6-6 6-6" /></svg>
  ),
  heart: (c = "") => (
    <svg viewBox="0 0 24 24" className={c} {...S}><path d="M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.6l-1-1a5.5 5.5 0 10-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 000-7.8z" /></svg>
  ),
  comment: (c = "") => (
    <svg viewBox="0 0 24 24" className={c} {...S}><path d="M21 11.5a8.4 8.4 0 01-9 8.4 9.9 9.9 0 01-4-.8L3 21l1.9-4.5A8.4 8.4 0 013 11.5 8.4 8.4 0 0112 3a8.4 8.4 0 019 8.5z" /></svg>
  ),
  share: (c = "") => (
    <svg viewBox="0 0 24 24" className={c} {...S}><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" /></svg>
  ),
  bookmark: (c = "") => (
    <svg viewBox="0 0 24 24" className={c} {...S}><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" /></svg>
  ),
  home: (c = "") => (
    <svg viewBox="0 0 24 24" className={c} {...S}><path d="M3 10l9-7 9 7v9a2 2 0 01-2 2h-4v-6H9v6H5a2 2 0 01-2-2z" /></svg>
  ),
  search: (c = "") => (
    <svg viewBox="0 0 24 24" className={c} {...S}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
  ),
  plus: (c = "") => (
    <svg viewBox="0 0 24 24" className={c} {...S}><rect x="3" y="3" width="18" height="18" rx="5" /><path d="M12 8v8M8 12h8" /></svg>
  ),
  reels: (c = "") => (
    <svg viewBox="0 0 24 24" className={c} {...S}><rect x="3" y="3" width="18" height="18" rx="4" /><path d="M3 8h18M8 3l2.5 5M14 3l2.5 5M10 12l5 3-5 3z" /></svg>
  ),
  phone: (c = "") => (
    <svg viewBox="0 0 24 24" className={c} {...S}><path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3 19.5 19.5 0 01-6-6 19.8 19.8 0 01-3-8.6A2 2 0 014.1 2h3a2 2 0 012 1.7c.1.9.4 1.8.7 2.7a2 2 0 01-.5 2.1L8.1 9.6a16 16 0 006 6l1.1-1.1a2 2 0 012.1-.5c.9.3 1.8.6 2.7.7a2 2 0 011.7 2z" /></svg>
  ),
  video: (c = "") => (
    <svg viewBox="0 0 24 24" className={c} {...S}><rect x="2" y="6" width="14" height="12" rx="2" /><path d="M16 10l6-3v10l-6-3z" /></svg>
  ),
  camera: (c = "") => (
    <svg viewBox="0 0 24 24" className={c} {...S}><path d="M3 8a2 2 0 012-2h1.2a2 2 0 001.7-1l.5-.8a2 2 0 011.7-1h3.8a2 2 0 011.7 1l.5.8a2 2 0 001.7 1H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z" /><circle cx="12" cy="13" r="3.2" /></svg>
  ),
  link: (c = "") => (
    <svg viewBox="0 0 24 24" className={c} {...S}><path d="M10.5 13.5a4 4 0 005.7 0l2.3-2.3a4 4 0 00-5.7-5.7L11.5 6.8" /><path d="M13.5 10.5a4 4 0 00-5.7 0l-2.3 2.3a4 4 0 005.7 5.7l1.3-1.3" /></svg>
  ),
};

/* ----------------------------- helpers ----------------------------- */

function renderMessage(text: string, hasLink: boolean, linkUrl: string | undefined, tr: (s: string) => string) {
  const withName = text.replace(/\{username\}/g, SAMPLE_USER);
  return withName.split(/(\{link\})/g).map((part, i) =>
    part === "{link}" ? (
      <span
        key={i}
        className={
          linkUrl || hasLink
            ? "text-sky-400 underline break-all"
            : "text-zinc-500 italic"
        }
      >
        {/* Show the actual link being sent, not a placeholder token. */}
        {linkUrl || (hasLink ? tr("your link") : tr("{link}"))}
      </span>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

function Avatar({
  url,
  size = 28,
}: {
  url: string | null;
  size?: number;
}) {
  return url ? (
    <img
      src={url}
      alt=""
      referrerPolicy="no-referrer"
      className="shrink-0 rounded-full object-cover"
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      className="shrink-0 rounded-full bg-zinc-600"
      style={{ width: size, height: size }}
    />
  );
}

function StatusBar() {
  return (
    <div className="flex items-center justify-between px-6 pt-2.5 text-[11px] font-semibold text-white">
      <span>12:13</span>
      <div className="flex items-center gap-1">
        <svg viewBox="0 0 20 12" className="h-2.5 w-4 fill-white"><rect x="0" y="7" width="3" height="5" rx="1" /><rect x="5" y="4" width="3" height="8" rx="1" /><rect x="10" y="1.5" width="3" height="10.5" rx="1" /><rect x="15" y="0" width="3" height="12" rx="1" /></svg>
        <svg viewBox="0 0 20 14" className="h-3 w-4 fill-white"><path d="M10 3c2.7 0 5.2 1 7 2.7l-1.4 1.5A7.9 7.9 0 0010 5c-2.1 0-4 .8-5.6 2.2L3 5.7A10 10 0 0110 3z" /><path d="M10 8c1.3 0 2.5.5 3.4 1.3L10 12.8 6.6 9.3A5 5 0 0110 8z" /></svg>
        <svg viewBox="0 0 26 13" className="h-3 w-5"><rect x="0.5" y="0.5" width="22" height="12" rx="3" className="fill-none stroke-white/60" /><rect x="2" y="2" width="18" height="9" rx="1.5" className="fill-white" /><rect x="23.5" y="4" width="1.8" height="5" rx="1" className="fill-white/60" /></svg>
      </div>
    </div>
  );
}

function Phone({ children }: { children: React.ReactNode }) {
  const btn = "absolute w-[3px] rounded-sm bg-gradient-to-r from-zinc-500 to-zinc-700";
  return (
    // max-w-full so the fixed 300px frame cannot overflow a narrow screen
    <div className="relative w-[300px] max-w-full">
      {/* Left side buttons: action, volume up, volume down */}
      <span className={`${btn} -left-[2px] top-[96px] h-7`} />
      <span className={`${btn} -left-[2px] top-[140px] h-12`} />
      <span className={`${btn} -left-[2px] top-[200px] h-12`} />
      {/* Right side buttons: side/power, camera control */}
      <span className={`${btn} -right-[2px] left-auto top-[150px] h-20 bg-gradient-to-l`} />
      <span className={`${btn} -right-[2px] left-auto top-[250px] h-9 bg-gradient-to-l`} />

      {/* Titanium frame → black bezel → screen */}
      <div className="relative rounded-[3rem] bg-gradient-to-br from-zinc-500 via-zinc-700 to-zinc-600 p-[3px] shadow-2xl">
        <div className="rounded-[2.85rem] bg-black p-[9px]">
          <div className="relative h-[640px] overflow-hidden rounded-[2.3rem] bg-black">
            {/* Dynamic Island */}
            <div className="absolute left-1/2 top-2 z-20 h-6 w-24 -translate-x-1/2 rounded-full bg-black" />
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- screens ----------------------------- */

function PostScreen({
  username,
  avatarUrl,
  postThumb,
  caption,
}: {
  username: string;
  avatarUrl: string | null;
  postThumb: string | null;
  caption: string;
}) {
  const tr = useT();
  return (
    <div className="flex h-full flex-col text-white">
      <StatusBar />
      <div className="flex items-center px-3 py-2">
        <span className="w-6">{Ico.back("h-5 w-5")}</span>
        <div className="flex-1 text-center">
          <p className="text-[9px] uppercase tracking-wide text-zinc-400">{username}</p>
          <p className="text-sm font-semibold">{tr("Posts")}</p>
        </div>
        <span className="w-6" />
      </div>
      <div className="flex items-center gap-2 px-3 py-1.5">
        <Avatar url={avatarUrl} size={30} />
        <span className="text-sm font-semibold">{username}</span>
        <span className="ml-auto tracking-widest">···</span>
      </div>
      <div className="min-h-0 flex-1 bg-zinc-800">
        {postThumb && (
          <img src={postThumb} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
        )}
      </div>
      <div className="flex shrink-0 items-center gap-4 px-3 py-2.5">
        <span className="flex items-center gap-1">{Ico.heart("h-6 w-6")}<span className="text-sm">59</span></span>
        <span className="flex items-center gap-1">{Ico.comment("h-6 w-6")}<span className="text-sm">1</span></span>
        {Ico.share("h-6 w-6")}
        <span className="ml-auto">{Ico.bookmark("h-6 w-6")}</span>
      </div>
      <div className="shrink-0 px-3 text-xs leading-relaxed">
        <p className="line-clamp-2">
          <span className="font-semibold">{username}</span>{" "}
          <span className="text-zinc-200">
            {caption || tr("Applications close rly soon!!")}
          </span>
        </p>
        <p className="mt-1 text-zinc-500">{tr("View all comments")}</p>
      </div>
      <div className="flex shrink-0 items-center justify-around border-t border-zinc-800 px-2 py-3 text-white">
        {Ico.home("h-6 w-6")}
        {Ico.search("h-6 w-6")}
        {Ico.plus("h-6 w-6")}
        {Ico.reels("h-6 w-6")}
        <Avatar url={avatarUrl} size={24} />
      </div>
    </div>
  );
}

function CommentsScreen({
  username,
  avatarUrl,
  sampleComment,
  publicReplyEnabled,
  publicReplyMessage,
}: {
  username: string;
  avatarUrl: string | null;
  sampleComment: string;
  publicReplyEnabled: boolean;
  publicReplyMessage: string;
}) {
  const tr = useT();
  const reactions = ["❤️", "🙌", "🔥", "👏", "😢", "😍", "😮", "😂"];
  return (
    <div className="flex h-full flex-col text-white">
      <StatusBar />
      <div className="h-20 bg-zinc-800/70" />
      <div className="flex flex-1 flex-col rounded-t-2xl bg-[#0b0b0b] px-4 pt-3">
        <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-zinc-600" />
        <p className="text-center text-sm font-semibold">{tr("Comments")}</p>

        <div className="mt-5 flex gap-3">
          <Avatar url={null} size={32} />
          <div className="flex-1">
            <p className="text-xs">
              <span className="font-semibold">{SAMPLE_USER}</span>{" "}
              <span className="text-zinc-500">{tr("Now")}</span>
            </p>
            <p className="text-sm">{sampleComment || tr("yc")}</p>
            <p className="mt-0.5 text-xs text-zinc-500">{tr("Reply")}</p>
          </div>
          <span className="mt-1">{Ico.heart("h-3.5 w-3.5 text-zinc-500")}</span>
        </div>

        {publicReplyEnabled && (
          <div className="mt-4 flex gap-3 pl-10">
            <Avatar url={avatarUrl} size={28} />
            <div className="flex-1">
              <p className="text-xs">
                <span className="font-semibold">{username}</span>{" "}
                <span className="text-zinc-500">{tr("Now")}</span>
              </p>
              <p className="text-sm">{publicReplyMessage || tr("Sent you a DM! 📩")}</p>
              <p className="mt-0.5 text-xs text-zinc-500">{tr("Reply")}</p>
            </div>
            <span className="mt-1">{Ico.heart("h-3.5 w-3.5 text-zinc-500")}</span>
          </div>
        )}

        <div className="mt-auto">
          <div className="flex items-center justify-between px-1 pb-2 text-lg">
            {reactions.map((r) => (
              <span key={r}>{r}</span>
            ))}
          </div>
          <div className="mb-3 flex items-center gap-2">
            <Avatar url={avatarUrl} size={28} />
            <div className="flex-1 rounded-full bg-zinc-800 px-3 py-2 text-xs text-zinc-500">
              {tr("Add a comment for")} {username}…
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DmScreen({
  username,
  avatarUrl,
  openingDmEnabled,
  openingDmMessage,
  openingDmButtonLabel,
  revealMessage,
  hasLink,
  linkButtonLabel,
  hasSecondLink,
  secondLinkButtonLabel,
  secondLinkUrl,
  dmFormat = "BUTTON",
  requireFollow,
  followPromptMessage,
  followPromptButtonLabel,
  followUpEnabled,
  followUpMessage,
  followUpDelayMinutes = 0,
  linkUrl,
  inboundMessage,
  inboundKind = "text",
  storyThumb = null,
}: {
  username: string;
  avatarUrl: string | null;
  openingDmEnabled: boolean;
  openingDmMessage: string;
  openingDmButtonLabel: string;
  revealMessage: string;
  hasLink: boolean;
  linkButtonLabel: string;
  linkUrl?: string;
  hasSecondLink: boolean;
  secondLinkButtonLabel: string;
  secondLinkUrl?: string;
  dmFormat?: "BUTTON" | "TEXT";
  requireFollow: boolean;
  followPromptMessage: string;
  followPromptButtonLabel: string;
  followUpEnabled: boolean;
  followUpMessage: string;
  followUpDelayMinutes?: number;
  // Present on the keyword-trigger thread: the DM the user sends to start it.
  inboundMessage?: string;
  /** How the conversation started: a plain DM, a reply to our story or a mention in theirs. */
  inboundKind?: "text" | "storyReply" | "storyMention";
  storyThumb?: string | null;
}) {
  const tr = useT();
  return (
    <div className="flex h-full flex-col text-white">
      <StatusBar />
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="w-4">{Ico.back("h-5 w-5")}</span>
        <Avatar url={avatarUrl} size={30} />
        <span className="text-sm font-semibold">{username}</span>
        <span className="ml-auto flex items-center gap-3">
          {Ico.phone("h-5 w-5")}
          {Ico.video("h-5 w-5")}
        </span>
      </div>

      <div className="flex-1 space-y-3 px-3 py-4">
        {inboundKind === "storyReply" && (
          <div className="flex flex-col items-end gap-1">
            <p className="text-[10px] text-zinc-500">{tr("Replied to your story")}</p>
            <StoryChip thumb={storyThumb} />
            <div className="max-w-[80%] rounded-2xl rounded-br-md bg-accent px-3 py-2 text-sm">
              {inboundMessage || tr("their message")}
            </div>
          </div>
        )}
        {inboundKind === "storyMention" && (
          <div className="flex flex-col items-end gap-1">
            <p className="text-[10px] text-zinc-500">{tr("Mentioned you in their story")}</p>
            <StoryChip thumb={null} mention={username} />
          </div>
        )}
        {inboundKind === "text" && inboundMessage !== undefined && (
          <div className="flex justify-end">
            <div className="max-w-[80%] rounded-2xl rounded-br-md bg-accent px-3 py-2 text-sm">
              {inboundMessage || tr("their message")}
            </div>
          </div>
        )}
        {openingDmEnabled && (
          <>
            <div className="flex items-end gap-2">
              <Avatar url={avatarUrl} size={24} />
              <div className="max-w-[80%] overflow-hidden rounded-2xl rounded-bl-md bg-zinc-800">
                <p className="whitespace-pre-wrap px-3 py-2 text-sm">{openingDmMessage || tr("Your opening message…")}</p>
                <div className="mx-1.5 mb-1.5 rounded-xl bg-zinc-700 px-4 py-1.5 text-center text-sm font-medium text-white">
                  {openingDmButtonLabel || tr("Button label")}
                </div>
              </div>
            </div>
            <div className="flex justify-end">
              <div className="rounded-2xl rounded-br-md bg-accent px-3 py-2 text-sm">
                {openingDmButtonLabel || tr("Button label")}
              </div>
            </div>
          </>
        )}
        {requireFollow && (
          <>
            <div className="flex items-end gap-2">
              <Avatar url={avatarUrl} size={24} />
              <div className="max-w-[80%] overflow-hidden rounded-2xl rounded-bl-md bg-zinc-800">
                <p className="whitespace-pre-wrap px-3 py-2 text-sm">
                  {followPromptMessage ||
                    tr("quick favor before i send your link. i don't make any money from this, it's free. if you want to support me, just don't unfollow after, and star the repo on github if it helps you. tap the button once you're following and i'll send it over")}
                </p>
                <div className="mx-1.5 mb-1.5 rounded-xl bg-zinc-700 px-4 py-1.5 text-center text-sm font-medium text-white">
                  {followPromptButtonLabel || tr("i'm following")}
                </div>
              </div>
            </div>
            <div className="flex justify-end">
              <div className="rounded-2xl rounded-br-md bg-accent px-3 py-2 text-sm">
                {followPromptButtonLabel || tr("i'm following")}
              </div>
            </div>
          </>
        )}
        {(() => {
          // TEXT: exactly the text the worker sends (composeLinkText), with
          // sample URLs, links highlighted.
          if (hasLink && dmFormat === "TEXT") {
            const primary = linkUrl || tr("your link");
            const second = hasSecondLink ? secondLinkUrl || tr("your second link") : null;
            const text = revealMessage
              ? composeLinkText({
                  message: revealMessage,
                  commenterName: SAMPLE_USER,
                  primary,
                  destinationUrl: linkUrl,
                  extraLinks: second ? [{ url: second, label: secondLinkButtonLabel }] : [],
                })
              : "";
            const urls = [primary, second].filter((u): u is string => Boolean(u));
            const escaped = urls.map((u) => u.replace(/[.*+?^$|()[\]{}\\]/g, "\\$&"));
            const pattern = new RegExp("(" + escaped.join("|") + ")", "g");
            return (
              <div className="flex items-end gap-2">
                <Avatar url={avatarUrl} size={24} />
                <div className="max-w-[80%] overflow-hidden rounded-2xl rounded-bl-md bg-zinc-800">
                  <p className="whitespace-pre-wrap break-words px-3 py-2 text-sm">
                    {!text
                      ? tr("Write a message")
                      : text.split(pattern).map((part, i) =>
                          urls.includes(part) ? (
                            <span key={i} className="text-sky-400 underline break-all">
                              {part}
                            </span>
                          ) : (
                            <span key={i}>{part}</span>
                          )
                        )}
                  </p>
                </div>
              </div>
            );
          }
          // BUTTON: with a link the worker always sends the card (the text
          // without {link}, then the buttons).
          const resolved = revealMessage.replace(/\{username\}/g, SAMPLE_USER);
          const showCard = hasLink;
          const bodyText = showCard
            ? resolved.replace(/\s*\{link\}\s*/g, " ").trim()
            : resolved;
          return (
            <div className="flex items-end gap-2">
              <Avatar url={avatarUrl} size={24} />
              <div className="max-w-[80%] overflow-hidden rounded-2xl rounded-bl-md bg-zinc-800">
                {(!showCard || bodyText) && (
                  <p className="whitespace-pre-wrap px-3 py-2 text-sm">
                    {!revealMessage
                      ? tr("Write a message")
                      : showCard
                        ? bodyText
                        : renderMessage(revealMessage, hasLink, linkUrl, tr)}
                  </p>
                )}
                {showCard && (
                  <>
                    <div className="mx-1.5 mb-1.5 rounded-xl bg-zinc-700 px-4 py-1.5 text-center text-sm font-medium text-white">
                      {linkButtonLabel || tr("Open link")}
                    </div>
                    {hasSecondLink && (
                      <div className="mx-1.5 mb-1.5 rounded-xl bg-zinc-700 px-4 py-1.5 text-center text-sm font-medium text-white">
                        {secondLinkButtonLabel || tr("Open link")}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })()}
        {followUpEnabled && (
          <>
            {followUpDelayMinutes > 0 && (
              <p className="py-1 text-center text-[11px] text-zinc-500">
                {followUpDelayMinutes} {tr("min later")}
              </p>
            )}
            <div className="flex items-end gap-2">
              <Avatar url={avatarUrl} size={24} />
              <div className="max-w-[80%] rounded-2xl rounded-bl-md bg-zinc-800 px-3 py-2">
                <p className="whitespace-pre-wrap text-sm">
                  {followUpMessage.trim()
                    ? followUpMessage.replace(/\{username\}/g, SAMPLE_USER)
                    : tr("Btw just wanted to say thanks for following me, I appreciate the support 🙌")}
                </p>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="flex items-center gap-2 px-3 py-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent text-white">
          {Ico.camera("h-4 w-4")}
        </span>
        <div className="flex-1 rounded-full bg-zinc-800 px-3 py-2 text-xs text-zinc-500">{tr("Message…")}</div>
      </div>
    </div>
  );
}

/** Small story card shown inside the DM thread (like Instagram does). */
function StoryChip({ thumb, mention }: { thumb: string | null; mention?: string }) {
  return (
    <div className="relative h-24 w-16 overflow-hidden rounded-xl bg-gradient-to-br from-fuchsia-600 via-rose-500 to-amber-400">
      {thumb && <img src={thumb} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />}
      {mention && (
        <span className="absolute inset-x-1 top-1/2 -translate-y-1/2 truncate rounded bg-white px-1 py-0.5 text-center text-[8px] font-semibold text-zinc-900">
          @{mention}
        </span>
      )}
    </div>
  );
}

function StoryScreen({
  username,
  avatarUrl,
  storyThumb,
  mention,
  sampleReply,
}: {
  username: string;
  avatarUrl: string | null;
  storyThumb: string | null;
  /** True: it is the person's story with our @ (story mention). */
  mention: boolean;
  sampleReply: string;
}) {
  const tr = useT();
  const owner = mention ? SAMPLE_USER : username;
  return (
    <div className="relative flex h-full flex-col text-white">
      <div className="absolute inset-0 bg-gradient-to-br from-fuchsia-700 via-rose-600 to-amber-500">
        {!mention && storyThumb && (
          <img src={storyThumb} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
        )}
      </div>
      <div className="relative z-10 flex h-full flex-col">
        <StatusBar />
        <div className="px-3 pt-2">
          <div className="h-0.5 w-full overflow-hidden rounded-full bg-white/35">
            <div className="h-full w-2/5 bg-white" />
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Avatar url={mention ? null : avatarUrl} size={28} />
            <span className="text-sm font-semibold drop-shadow">{owner}</span>
            <span className="text-xs text-white/70">{tr("2h")}</span>
            <span className="ml-auto tracking-widest">···</span>
          </div>
        </div>
        <div className="flex flex-1 items-center justify-center px-6">
          {mention ? (
            <span className="rounded-md bg-white px-3 py-1.5 text-base font-semibold text-zinc-900 shadow-lg">
              @{username}
            </span>
          ) : (
            !storyThumb && <p className="text-center text-sm text-white/80">{tr("Your story")}</p>
          )}
        </div>
        <div className="flex items-center gap-2 px-3 pb-4">
          {mention ? (
            <p className="w-full text-center text-xs text-white/80">
              {tr("Instagram tells you about the mention and the DM goes out")}
            </p>
          ) : (
            <>
              <div className="flex-1 rounded-full border border-white/70 px-3 py-2 text-xs">
                {sampleReply || tr("Send message")}
              </div>
              {Ico.heart("h-6 w-6")}
              {Ico.share("h-6 w-6")}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function LiveScreen({
  username,
  avatarUrl,
  sampleComment,
}: {
  username: string;
  avatarUrl: string | null;
  sampleComment: string;
}) {
  const tr = useT();
  return (
    <div className="relative flex h-full flex-col text-white">
      <div className="absolute inset-0 bg-gradient-to-b from-zinc-700 via-zinc-800 to-black" />
      <div className="relative z-10 flex h-full flex-col">
        <StatusBar />
        <div className="flex items-center gap-2 px-3 pt-2">
          <Avatar url={avatarUrl} size={28} />
          <span className="text-sm font-semibold">{username}</span>
          <span className="rounded bg-gradient-to-r from-fuchsia-600 to-rose-500 px-1.5 py-0.5 text-[10px] font-bold uppercase">
            {tr("Live")}
          </span>
          <span className="rounded bg-black/50 px-1.5 py-0.5 text-[10px]">👁 128</span>
        </div>
        <div className="flex-1" />
        <div className="space-y-2 px-3 pb-2">
          <p className="text-xs">
            <span className="font-semibold">maria.silva</span> <span className="text-white/85">{tr("hi from Recife!")}</span>
          </p>
          <div className="flex items-start gap-2">
            <Avatar url={null} size={24} />
            <p className="text-xs">
              <span className="font-semibold">{SAMPLE_USER}</span>{" "}
              <span className="text-white/90">{sampleComment || tr("yc")}</span>
            </p>
          </div>
          <p className="text-[10px] text-white/60">{tr("Nobody sees a reply here: the link goes to their Direct.")}</p>
        </div>
        <div className="flex items-center gap-2 px-3 pb-4">
          <div className="flex-1 rounded-full border border-white/50 px-3 py-2 text-xs text-white/70">{tr("Comment")}</div>
          {Ico.heart("h-6 w-6")}
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- root ----------------------------- */

export default function CampaignPreview(props: CampaignPreviewProps) {
  const tr = useT();
  const { tab, onTabChange } = props;
  const trigger = props.trigger ?? "COMMENT";
  const keys = previewTabsFor(trigger, props.dmTriggerEnabled);
  const tabs = keys.map((key) => ({
    key,
    // A DM campaign has a single thread: call it just "DM".
    label: trigger === "DM" && key === "dmTrigger" ? "DM" : TAB_LABELS[key],
  }));

  // A tab that does not exist for this trigger (switched trigger, DM toggle
  // off) falls back to the DM thread, or the first tab, never an empty phone.
  const activeTab: PreviewTab = keys.includes(tab) ? tab : keys.includes("dm") ? "dm" : keys[0];
  const storyThumb = props.storyThumb ?? null;

  return (
    <div className="flex flex-col items-center gap-5">
      <Phone>
        {activeTab === "post" && (
          <PostScreen
            username={props.username}
            avatarUrl={props.avatarUrl}
            postThumb={props.postThumb}
            caption={props.caption}
          />
        )}
        {activeTab === "comments" && (
          <CommentsScreen
            username={props.username}
            avatarUrl={props.avatarUrl}
            sampleComment={props.sampleComment}
            publicReplyEnabled={props.publicReplyEnabled}
            publicReplyMessage={props.publicReplyMessage}
          />
        )}
        {activeTab === "story" && (
          <StoryScreen
            username={props.username}
            avatarUrl={props.avatarUrl}
            storyThumb={storyThumb}
            mention={trigger === "STORY_MENTION"}
            sampleReply={props.sampleComment}
          />
        )}
        {activeTab === "live" && (
          <LiveScreen username={props.username} avatarUrl={props.avatarUrl} sampleComment={props.sampleComment} />
        )}
        {activeTab === "dm" && (
          <DmScreen
            username={props.username}
            avatarUrl={props.avatarUrl}
            openingDmEnabled={props.openingDmEnabled && trigger !== "STORY_REPLY" && trigger !== "STORY_MENTION"}
            openingDmMessage={props.openingDmMessage}
            openingDmButtonLabel={props.openingDmButtonLabel}
            revealMessage={props.revealMessage}
            hasLink={props.hasLink}
            linkButtonLabel={props.linkButtonLabel}
            hasSecondLink={props.hasSecondLink}
            secondLinkButtonLabel={props.secondLinkButtonLabel}
            secondLinkUrl={props.secondLinkUrl}
            dmFormat={props.dmFormat}
            requireFollow={props.requireFollow}
            followPromptMessage={props.followPromptMessage}
            followPromptButtonLabel={props.followPromptButtonLabel}
            followUpEnabled={props.followUpEnabled}
            followUpMessage={props.followUpMessage}
            followUpDelayMinutes={props.followUpDelayMinutes}
            linkUrl={props.linkUrl}
            // Story campaigns start from the story itself: the person's reply
            // or the mention card, and no opening DM (the chat is already open).
            {...(trigger === "STORY_REPLY"
              ? { inboundKind: "storyReply" as const, inboundMessage: props.sampleComment, storyThumb }
              : trigger === "STORY_MENTION"
                ? { inboundKind: "storyMention" as const }
                : {})}
          />
        )}
        {activeTab === "dmTrigger" && (
          <DmScreen
            username={props.username}
            avatarUrl={props.avatarUrl}
            // The user opened the conversation, so no opening DM is sent.
            openingDmEnabled={false}
            openingDmMessage=""
            openingDmButtonLabel=""
            revealMessage={props.revealMessage}
            hasLink={props.hasLink}
            linkButtonLabel={props.linkButtonLabel}
            hasSecondLink={props.hasSecondLink}
            secondLinkButtonLabel={props.secondLinkButtonLabel}
            secondLinkUrl={props.secondLinkUrl}
            dmFormat={props.dmFormat}
            requireFollow={props.requireFollow}
            followPromptMessage={props.followPromptMessage}
            followPromptButtonLabel={props.followPromptButtonLabel}
            followUpEnabled={props.followUpEnabled}
            followUpMessage={props.followUpMessage}
            followUpDelayMinutes={props.followUpDelayMinutes}
            linkUrl={props.linkUrl}
            inboundMessage={props.sampleComment}
          />
        )}
      </Phone>

      <div className="inline-flex rounded-full bg-surface p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => onTabChange(t.key)}
            className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
              activeTab === t.key
                ? "bg-background font-medium text-foreground ring-1 ring-accent/40"
                : "text-muted hover:text-foreground"
            }`}
          >
            {tr(t.label)}
          </button>
        ))}
      </div>
    </div>
  );
}
