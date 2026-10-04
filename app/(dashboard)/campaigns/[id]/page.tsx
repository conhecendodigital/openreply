"use client";

/**
 * Campaign Detail
 *
 * Clicking a campaign opens this read-only view: a summary of the automation
 * on the left, and Insights / Preview tabs on the right. Edit and Stop/Resume
 * live in the top bar.
 * 2026-10-07: "Open as flow" copies the campaign into a NEW flow that is
 * off. The campaign is only read: it stays on and untouched.
 */

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import CampaignPreview, { type PreviewTab, type PreviewTrigger } from "@/components/campaign-preview";
import { triggerText } from "@/components/trigger-ui";
import { CampaignAbPanel } from "@/components/ab-test";

import { useT } from "@/components/lang-provider";
interface Campaign {
  id: string;
  name: string;
  trigger?: PreviewTrigger | null;
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
  instagramAccount: { username: string };
  trackedLinks?: {
    destinationUrl: string;
    label?: string | null;
    trackedUrl?: string;
  }[];
  analytics: {
    sent: number;
    skipped: number;
    failed: number;
    clicks: number;
    ctr: number;
  };
}

type Tab = "insights" | "preview";

export default function CampaignDetailPage() {
  const t = useT();
  const router = useRouter();
  const { id } = useParams<{ id: string }>();

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [postThumb, setPostThumb] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("insights");
  const [previewTab, setPreviewTab] = useState<PreviewTab>("dm");
  const [busy, setBusy] = useState(false);
  const [converting, setConverting] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/automations", { cache: "no-store" })
      .then((r) => r.json())
      .then((payload) => {
        if (!payload.success) return setNotFound(true);
        const found = (payload.data as Campaign[]).find((c) => c.id === id);
        if (!found) return setNotFound(true);
        setCampaign(found);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!campaign) return;
    const acct = campaign.instagramAccountId;
    fetch(`/api/instagram/profile?instagramAccountId=${acct}`)
      .then((r) => r.json())
      .then((d) =>
        setAvatarUrl(d.success ? d.data.profilePictureUrl ?? null : null)
      )
      .catch(() => setAvatarUrl(null));

    if (campaign.postId) {
      fetch(`/api/instagram/posts?instagramAccountId=${acct}&limit=50`)
        .then((r) => r.json())
        .then((payload) => {
          if (!payload.success) return;
          const hit = (
            payload.data as {
              id: string;
              thumbnail_url?: string;
              media_url?: string;
            }[]
          ).find((p) => p.id === campaign.postId);
          setPostThumb(hit?.thumbnail_url ?? hit?.media_url ?? null);
        })
        .catch(() => setPostThumb(null));
    }
  }, [campaign]);

  async function toggleActive() {
    if (!campaign) return;
    setBusy(true);
    try {
      await fetch(`/api/automations?id=${campaign.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !campaign.isActive }),
      });
      setCampaign({ ...campaign, isActive: !campaign.isActive });
    } finally {
      setBusy(false);
    }
  }

  async function openAsFlow() {
    if (!campaign || converting) return;
    setConverting(true);
    setConvertError(null);
    try {
      const res = await fetch(`/api/flows/from-campaign/${encodeURIComponent(campaign.id)}`, { method: "POST" });
      const payload = await res.json().catch(() => null);
      if (!payload?.success) {
        setConvertError(payload?.error ? t(payload.error) : t("Could not open the campaign as a flow"));
        return;
      }
      const flowId = payload.data.id as string;
      try {
        const codes = ((payload.data.warnings ?? []) as { code: string }[]).map((w) => w.code);
        window.sessionStorage.setItem(`flow-convert:${flowId}`, JSON.stringify(codes));
      } catch {
        // storage blocked: the flow opens without the list of notes
      }
      router.push(`/flows/${flowId}`);
    } catch {
      setConvertError(t("Could not open the campaign as a flow"));
    } finally {
      setConverting(false);
    }
  }

  if (loading) {
    return <div className="panel h-64 rounded" />;
  }
  if (notFound || !campaign) {
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

  const publicReplies =
    campaign.publicReplyMessages && campaign.publicReplyMessages.length > 0
      ? campaign.publicReplyMessages
      : campaign.publicReplyMessage
        ? [campaign.publicReplyMessage]
        : [];
  const hasLink = Boolean(campaign.trackedLinks?.[0]?.destinationUrl);
  const hasSecondLink = Boolean(campaign.trackedLinks?.[1]?.destinationUrl);

  const kind: PreviewTrigger = campaign.trigger ?? "COMMENT";
  const trigger = triggerText(t, campaign);
  const matchText = campaign.matchAnyWord
    ? kind === "COMMENT" || kind === "LIVE_COMMENT"
      ? t("Any comment")
      : t("Any message")
    : campaign.keywords.join(", ") || t("No keywords");

  const metrics = [
    { label: "Sends", value: campaign.analytics.sent },
    { label: "Clicks", value: campaign.analytics.clicks },
    { label: "CTR", value: `${campaign.analytics.ctr}%` },
    { label: "Failed", value: campaign.analytics.failed },
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,340px)_1fr]">
      {/* Left: config summary */}
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <Link
            href="/campaigns"
            className="text-sm text-muted hover:text-foreground"
          >
            {t("← Campaigns")}
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <h1 className="truncate text-lg font-semibold">{campaign.name}</h1>
          <span
            className={`shrink-0 rounded px-2 py-0.5 text-xs font-semibold ${
              campaign.isActive
                ? "bg-success/10 text-success"
                : "bg-zinc-500/10 text-muted"
            }`}
          >
            {campaign.isActive ? t("LIVE") : t("Paused")}
          </span>
        </div>

        {kind !== "COMMENT" ? (
          <Summary title={t("What starts the campaign")}>
            <p className="text-sm text-foreground">{trigger}</p>
            {kind === "STORY_REPLY" && campaign.storyUrl && (
              <a href={campaign.storyUrl} target="_blank" rel="noreferrer" className="text-xs font-semibold text-accent">
                {t("View story")}
              </a>
            )}
          </Summary>
        ) : (
        <Summary title={t("When someone comments on")}>
          <div className="flex items-center gap-3">
            {postThumb ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={postThumb}
                alt={t("Post")}
                className="h-14 w-14 rounded object-cover"
              />
            ) : (
              <div className="grid h-14 w-14 place-items-center rounded bg-surface-hover text-[10px] text-muted">
                {campaign.matchAnyPost || campaign.pendingNextReel ? t("Any") : t("Post")}
              </div>
            )}
            <span className="text-sm text-foreground">{trigger}</span>
          </div>
        </Summary>
        )}

        {kind !== "STORY_MENTION" && (
        <Summary
          title={
            kind === "DM" ? t("And the message has") : kind === "STORY_REPLY" ? t("And the reply has") : t("And this comment has")
          }
        >
          <FieldBox>{matchText}</FieldBox>
          {campaign.dmTriggerEnabled && (
            <p className="text-xs text-muted">
              {t("Also replies when someone DMs")}{" "}
              {campaign.matchAnyWord ? t("anything") : t("these words")}.
            </p>
          )}
          {publicReplies.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted">{t("Public reply under the post")}</p>
              {publicReplies.map((m, i) => (
                <FieldBox key={i}>{m}</FieldBox>
              ))}
            </div>
          )}
        </Summary>
        )}

        {campaign.openingDmEnabled && (
          <Summary title={t("They will get an opening DM")}>
            <FieldBox>{campaign.openingDmMessage || t("Opening message")}</FieldBox>
            <FieldBox>{campaign.openingDmButtonLabel || t("Button")}</FieldBox>
          </Summary>
        )}

        {campaign.requireFollow && (
          <Summary title={t("They must follow first")}>
            <FieldBox>
              {campaign.followPromptMessage ||
                t("quick favor before i send your link. i don't make any money from this, it's free. if you want to support me, just don't unfollow after, and star the repo on github if it helps you. tap the button once you're following and i'll send it over")}
            </FieldBox>
            <FieldBox>
              {campaign.followPromptButtonLabel || t("i'm following")}
            </FieldBox>
          </Summary>
        )}

        <Summary title={t("And then, they will get a DM")}>
          <FieldBox>{campaign.dmMessage}</FieldBox>
          {hasLink && (
            <FieldBox>{campaign.linkButtonLabel || t("Open link")}</FieldBox>
          )}
          {hasSecondLink && (
            <FieldBox>
              {campaign.trackedLinks?.[1]?.label || t("Open link")}
            </FieldBox>
          )}
        </Summary>

        {hasLink && (
          <Summary title={t("The exact link sent")}>
            {campaign.trackedLinks
              ?.filter((link) => link.destinationUrl)
              .map((link, i) => (
                <div key={i} className="space-y-1">
                  <div className="rounded border border-border bg-surface px-3 py-2">
                    <p className="select-all break-all font-mono text-xs text-foreground">
                      {link.trackedUrl ?? link.destinationUrl}
                    </p>
                  </div>
                  <p className="text-xs text-muted">
                    {link.label ? `${link.label} · ` : ""}{t("redirects to")}{" "}
                    <span className="break-all">{link.destinationUrl}</span>
                  </p>
                </div>
              ))}
          </Summary>
        )}

        {campaign.followUpEnabled && campaign.followUpMessage && (
          <Summary title={t("Then a follow-up message")}>
            <FieldBox>{campaign.followUpMessage}</FieldBox>
            <p className="text-xs text-muted">
              {campaign.followUpDelayMinutes && campaign.followUpDelayMinutes > 0
                ? `Sent ${campaign.followUpDelayMinutes} min after the link.`
                : t("Sent right after the link.")}
            </p>
          </Summary>
        )}
      </div>

      {/* Right: top bar + tabs */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-3 border-b border-border pb-3">
          <div className="flex gap-4">
            <TabButton active={tab === "insights"} onClick={() => setTab("insights")}>
              {t("Insights")}
            </TabButton>
            <TabButton active={tab === "preview"} onClick={() => setTab("preview")}>
              {t("Preview")}
            </TabButton>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={openAsFlow}
              disabled={converting}
              title={t("Creates a new flow, off, copied from this campaign. The campaign stays on and untouched.")}
              className="rounded border border-border px-3 py-1.5 text-sm text-muted hover:text-foreground disabled:opacity-50"
            >
              {converting ? t("Opening…") : t("Open as flow")}
            </button>
            <Link
              href={`/campaigns/${campaign.id}/edit`}
              className="rounded border border-border px-3 py-1.5 text-sm text-muted hover:text-foreground"
            >
              {t("Edit")}
            </Link>
            <button
              onClick={toggleActive}
              disabled={busy}
              className={`rounded border px-3 py-1.5 text-sm disabled:opacity-50 ${
                campaign.isActive
                  ? "border-error/30 text-error hover:bg-error/10"
                  : "border-success/30 text-success hover:bg-success/10"
              }`}
            >
              {campaign.isActive ? t("Stop") : t("Resume")}
            </button>
          </div>
        </div>

        {convertError && <p className="text-sm text-error">{convertError}</p>}

        {tab === "insights" && (
          <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {metrics.map((m) => (
              <div key={m.label} className="panel rounded p-4">
                <p className="text-sm text-muted">{m.label}</p>
                <p className="mt-1 text-2xl font-semibold text-foreground">
                  {m.value}
                </p>
              </div>
            ))}
          </div>
          {/* Etapa 5: A/B results and "declare winner"; variants are edited in Edit. */}
          <CampaignAbPanel campaignId={campaign.id} compact />
          </div>
        )}

        {tab === "preview" && (
          <div className="flex justify-center sm:justify-start">
          <CampaignPreview
            tab={previewTab}
            onTabChange={setPreviewTab}
            trigger={kind}
            username={campaign.instagramAccount.username}
            avatarUrl={avatarUrl}
            postThumb={postThumb}
            caption=""
            sampleComment={kind === "STORY_MENTION" ? "" : campaign.matchAnyWord ? "nice!" : campaign.keywords[0] ?? "LINK"}
            dmTriggerEnabled={campaign.dmTriggerEnabled}
            publicReplyEnabled={campaign.publicReplyEnabled}
            publicReplyMessage={publicReplies[0] ?? ""}
            openingDmEnabled={campaign.openingDmEnabled}
            openingDmMessage={campaign.openingDmMessage ?? ""}
            openingDmButtonLabel={campaign.openingDmButtonLabel ?? ""}
            revealMessage={campaign.dmMessage}
            hasLink={hasLink}
            linkButtonLabel={campaign.linkButtonLabel ?? "Open link"}
            linkUrl={
              campaign.trackedLinks?.[0]?.trackedUrl ??
              campaign.trackedLinks?.[0]?.destinationUrl
            }
            hasSecondLink={hasSecondLink}
            secondLinkButtonLabel={
              campaign.trackedLinks?.[1]?.label ?? "Open link"
            }
            requireFollow={campaign.requireFollow}
            followPromptMessage={campaign.followPromptMessage ?? ""}
            followPromptButtonLabel={
              campaign.followPromptButtonLabel ?? "i'm following"
            }
            followUpEnabled={campaign.followUpEnabled ?? false}
            followUpMessage={campaign.followUpMessage ?? ""}
            followUpDelayMinutes={campaign.followUpDelayMinutes ?? 0}
          />
          </div>
        )}
      </div>
    </div>
  );
}

function Summary({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {children}
    </div>
  );
}

function FieldBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded border border-border bg-surface px-3 py-2 text-sm text-foreground">
      {children}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`border-b-2 pb-2 text-sm font-medium ${
        active
          ? "border-accent text-foreground"
          : "border-transparent text-muted hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
