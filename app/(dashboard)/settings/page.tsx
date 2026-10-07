"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import type { AccountOption } from "@/components/account-select";
import { ApiKeysPanel } from "@/components/api-keys-panel";
import { SecurityPanel } from "@/components/security-panel";
import { AiUsageReport } from "@/components/ai-usage-report";
import { InstagramConnectNotice } from "@/components/instagram-connect-notice";

import { useT } from "@/components/lang-provider";
import { CollapsibleSection, SectionIndex, SectionsProvider } from "@/components/ui/collapsible-section";

type ChannelStatus = "ACTIVE" | "NEEDS_RECONNECT" | "DISCONNECTED";

interface SettingsData {
  workspace: {
    name: string;
    dmsSentThisPeriod: number;
  };
  instagramAccount: {
    id: string;
    username: string;
    instagramId: string;
    tokenExpiresAt: string | null;
    webhookSubscribed: boolean;
  } | null;
  instagramAccounts: Array<
    AccountOption & {
      tokenExpiresAt: string | null;
      webhookSubscribed: boolean;
      status?: ChannelStatus;
    }
  >;
}

interface WorkspaceMembersData {
  currentUserRole: "OWNER" | "ADMIN" | "MEMBER";
  members: Array<{
    id: string;
    role: "OWNER" | "ADMIN" | "MEMBER";
    createdAt: string;
    user: {
      id: string;
      email: string | null;
      name: string | null;
    };
  }>;
  invitations: Array<{
    id: string;
    email: string;
    role: "OWNER" | "ADMIN" | "MEMBER";
    inviteUrl: string;
    expiresAt: string;
  }>;
}

export default function SettingsPage() {
  const t = useT();
  const [data, setData] = useState<SettingsData | null>(null);
  const [membersData, setMembersData] = useState<WorkspaceMembersData | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"ADMIN" | "MEMBER">("MEMBER");
  const [memberError, setMemberError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/dashboard/stats").then((res) => res.json()),
      fetch("/api/workspace/members").then((res) => res.json()),
    ])
      .then(([statsPayload, membersPayload]) => {
        if (statsPayload.success) setData(statsPayload.data);
        if (membersPayload.success) setMembersData(membersPayload.data);
      })
      .finally(() => setLoading(false));
  }, []);

  async function refreshMembers() {
    const res = await fetch("/api/workspace/members");
    const payload = await res.json();
    if (payload.success) setMembersData(payload.data);
  }

  // Owner's rule (2026-10-03): disconnecting turns the channel off and never
  // deletes anything. Deleting for real lives on the Channels page.
  async function disconnectInstagram(instagramAccountId: string, username: string) {
    if (
      !confirm(
        t("Disconnect @{username}? The channel turns off: no campaign runs and nothing is sent. Nothing is deleted: campaigns, contacts, conversations and history stay, and reconnecting the same account turns everything back on.", { username })
      )
    ) {
      return;
    }

    setBusy(`disconnect:${instagramAccountId}`);
    const res = await fetch("/api/instagram/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instagramAccountId }),
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => null);
      setBusy(null);
      alert(payload?.error ?? t("Could not disconnect."));
      return;
    }
    window.location.reload();
  }

  async function inviteMember(event: React.FormEvent) {
    event.preventDefault();
    setMemberError(null);
    setBusy("invite");
    const res = await fetch("/api/workspace/members", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
    });
    const payload = await res.json();
    if (payload.success) {
      setMembersData(payload.data);
      setInviteEmail("");
    } else {
      setMemberError(payload.error ?? "Could not invite member");
    }
    setBusy(null);
  }

  async function removeInvitation(invitationId: string) {
    setBusy(`invite:${invitationId}`);
    await fetch("/api/workspace/members", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invitationId }),
    });
    await refreshMembers();
    setBusy(null);
  }

  if (loading) {
    return <div className="panel rounded p-8 h-64" />;
  }

  const accounts = data?.instagramAccounts ?? [];
  const onAccounts = accounts.filter((a) => (a.status ?? "ACTIVE") !== "DISCONNECTED");
  const canManageMembers =
    membersData?.currentUserRole === "OWNER" ||
    membersData?.currentUserRole === "ADMIN";

  const needsReconnect = accounts.some((a) => a.status === "NEEDS_RECONNECT");
  const memberCount = membersData?.members.length ?? 0;
  const inviteCount = membersData?.invitations.length ?? 0;

  return (
    <SectionsProvider page="configuracoes">
    <div className="max-w-2xl mx-auto space-y-4">
      {/* Surfaces the ?instagram= code the OAuth routes redirect back with.
          Needs a Suspense boundary: useSearchParams in a prerendered client
          page fails the production build without one. */}
      <Suspense fallback={null}>
        <InstagramConnectNotice />
      </Suspense>

      <SectionIndex />

      <CollapsibleSection
        id="instagram"
        title={t("Instagram Connection")}
        attention={needsReconnect}
        badge={onAccounts.length > 0 ? { text: t("Connected"), tone: "success" } : { text: t("Not connected"), tone: "warning" }}
        summary={t("{n} of {total} Instagram profiles on", { n: onAccounts.length, total: accounts.length })}
      >

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 py-3 border-b border-border">
            <div>
              <p className="text-sm font-medium text-foreground">{t("Status")}</p>
              <p className="text-xs text-muted mt-0.5">
                {t("Comment webhooks and private replies depend on this connection.")}
              </p>
            </div>
            <span
              className={`px-3 py-1.5 rounded-full text-xs font-medium ${
                onAccounts.length > 0
                  ? "bg-success/10 text-success"
                  : "bg-warning/10 text-warning"
              }`}
            >
              {onAccounts.length > 0 ? t("Connected") : t("Not connected")}
            </span>
          </div>

          <div className="flex items-center justify-between gap-3 py-3 border-b border-border">
            <div>
              <p className="text-sm font-medium text-foreground">{t("Accounts")}</p>
              <p className="text-xs text-muted mt-0.5">
                {t("{n} of {total} Instagram profiles on", { n: onAccounts.length, total: accounts.length })}
              </p>
            </div>
            <Link href="/channels" className="shrink-0 text-sm font-semibold text-accent hover:text-accent-hover">
              {t("Manage on Channels")}
            </Link>
          </div>

          <div className="space-y-3 py-3">
            {accounts.length === 0 && (
              <p className="text-sm text-muted">
                {t("Connect an Instagram professional account to launch campaigns.")}
              </p>
            )}
            {accounts.map((account) => (
              <div
                key={account.id}
                className="flex flex-col gap-3 rounded border border-border bg-surface/70 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    @{account.username}
                    {account.status === "NEEDS_RECONNECT" && (
                      <span className="ml-2 rounded-full bg-error/10 px-2 py-0.5 text-xs font-semibold text-error">
                        {t("Needs reconnect")}
                      </span>
                    )}
                    {account.status === "DISCONNECTED" && (
                      <span className="ml-2 rounded-full bg-surface-hover px-2 py-0.5 text-xs font-semibold text-muted">
                        {t("Disconnected")}
                      </span>
                    )}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {account.status === "DISCONNECTED"
                      ? t("Channel off. Everything was kept; reconnect to turn it back on.")
                      : `${t("Token expires")} ${
                          account.tokenExpiresAt
                            ? new Date(account.tokenExpiresAt).toLocaleDateString()
                            : t("not available")
                        } · ${account.webhookSubscribed ? t("Webhook ready") : t("Webhook pending")}`}
                  </p>
                </div>
                {account.status === "DISCONNECTED" || account.status === "NEEDS_RECONNECT" ? (
                  <a
                    href="/api/instagram/connect"
                    className="inline-flex items-center justify-center rounded bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
                  >
                    {t("Reconnect")}
                  </a>
                ) : (
                  <button
                    onClick={() => disconnectInstagram(account.id, account.username)}
                    disabled={busy === `disconnect:${account.id}`}
                    className="inline-flex items-center justify-center rounded border border-error/20 px-4 py-2 text-sm font-medium text-error transition-all hover:border-error/40 hover:bg-error/10 disabled:opacity-50"
                  >
                    {busy === `disconnect:${account.id}`
                      ? t("Disconnecting...")
                      : t("Disconnect")}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <p className="mt-4 text-xs text-muted">
          {t("Disconnecting turns the channel off and never deletes anything. Status, tests and the real delete are on the Channels page.")}
        </p>

        <div className="mt-6 pt-4 border-t border-border flex flex-wrap gap-3">
          <Link
            href="/channels"
            className="px-4 py-2 rounded text-sm font-medium transition-colors bg-surface-hover text-foreground hover:bg-border"
          >
            {t("Open Channels")}
          </Link>
          <a
            href="/api/instagram/connect"
            className="px-4 py-2 rounded text-sm font-medium transition-colors bg-accent text-white hover:bg-accent-hover"
          >
            {accounts.length > 0 ? t("Connect another account") : t("Connect Instagram")}
          </a>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        id="equipe"
        title={t("Team")}
        defaultOpen={false}
        attention={Boolean(memberError)}
        badge={{ text: String(memberCount) }}
        summary={[
          memberCount === 1 ? t("1 member") : t("{n} members", { n: memberCount }),
          inviteCount === 1 ? t("1 pending invite") : t("{n} pending invites", { n: inviteCount }),
        ].join(" · ")}
      >
        <div className="space-y-3">
          {membersData?.members.map((member) => (
            <div
              key={member.id}
              className="flex items-center justify-between gap-4 border-b border-border py-3 last:border-0"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {member.user.name ?? member.user.email ?? t("Unknown member")}
                </p>
                <p className="text-xs text-muted">{member.user.email}</p>
              </div>
              <span className="rounded-full border border-border px-3 py-1 text-xs font-semibold text-muted">
                {member.role}
              </span>
            </div>
          ))}
        </div>

        {membersData?.invitations.length ? (
          <div className="mt-6 border-t border-border pt-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              {t("Pending invites")}
            </p>
            <div className="space-y-3">
              {membersData.invitations.map((invitation) => (
                <div
                  key={invitation.id}
                  className="flex flex-col gap-3 rounded border border-border bg-surface/70 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {invitation.email}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {invitation.role} · {invitation.inviteUrl}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        void navigator.clipboard?.writeText(invitation.inviteUrl)
                      }
                      className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-border-hover hover:text-foreground"
                    >
                      {t("Copy")}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeInvitation(invitation.id)}
                      disabled={busy === `invite:${invitation.id}`}
                      className="rounded-lg border border-error/20 px-3 py-1.5 text-xs font-medium text-error transition-colors hover:bg-error/10 disabled:opacity-50"
                    >
                      {t("Revoke")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {canManageMembers && (
          <form
            onSubmit={inviteMember}
            className="mt-6 grid gap-3 border-t border-border pt-4 sm:grid-cols-[1fr_140px_auto]"
          >
            <input
              type="email"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              placeholder={t("teammate@agency.com")}
              className="rounded border border-border bg-surface px-4 py-2 text-sm text-foreground outline-none transition-colors focus:border-accent/40"
              required
            />
            <select
              value={inviteRole}
              onChange={(event) =>
                setInviteRole(event.target.value as "ADMIN" | "MEMBER")
              }
              className="rounded border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-accent/40"
            >
              <option value="MEMBER">{t("Member")}</option>
              <option value="ADMIN">{t("Admin")}</option>
            </select>
            <button
              type="submit"
              disabled={busy === "invite"}
              className="rounded bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
            >
              {busy === "invite" ? t("Inviting...") : t("Invite")}
            </button>
            {memberError && (
              <p className="sm:col-span-3 text-sm text-error">{memberError}</p>
            )}
          </form>
        )}
      </CollapsibleSection>

      <SecurityPanel />

      <CollapsibleSection
        id="gastos-ia"
        title={t("My AI spending")}
        defaultOpen={false}
        summary={t("Only what your agents spent with AI. Nobody else's spending shows up here.")}
        description={t("Only what your agents spent with AI. Nobody else's spending shows up here.")}
      >
        <AiUsageReport scope="me" />
      </CollapsibleSection>

      {canManageMembers && (
        <CollapsibleSection
          id="pixel-meta"
          title={t("Meta Pixel and Conversions API")}
          defaultOpen={false}
          summary={t("Now in Channels, Connections and keys")}
        >
          <p className="mb-4 text-sm text-muted">
            {t("The Meta Pixel and the Conversions API moved to Channels, in Connections and keys. Everything you saved is still there.")}
          </p>
          <a
            href="/channels#conexoes"
            className="inline-flex rounded border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface-hover"
          >
            {t("Open Connections and keys")}
          </a>
        </CollapsibleSection>
      )}

      {canManageMembers && <ApiKeysPanel />}

      <CollapsibleSection
        id="uso"
        title={t("Usage")}
        defaultOpen={false}
        summary={t("{n} DMs sent this month", { n: data?.workspace.dmsSentThisPeriod ?? 0 })}
      >
        <div className="flex items-center justify-between gap-3 py-3">
          <div>
            <p className="text-sm font-medium text-foreground">
              {t("DMs sent this month")}
            </p>
            <p className="text-xs text-muted mt-0.5">
              {t("Self-hosted — no plan limits.")}
            </p>
          </div>
          <span className="text-sm font-semibold text-foreground">
            {data?.workspace.dmsSentThisPeriod ?? 0}
          </span>
        </div>
      </CollapsibleSection>
    </div>
    </SectionsProvider>
  );
}
