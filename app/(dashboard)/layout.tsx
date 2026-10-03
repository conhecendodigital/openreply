import { redirect } from "next/navigation";
import DashboardShell from "@/components/dashboard-shell";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { getChannelAlerts, type ChannelAlert } from "@/lib/channels/overview";
import { ensureWorkspaceForUser } from "@/lib/workspace";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const workspace = await ensureWorkspaceForUser(
    session.user.id,
    session.user.email
  );
  // A channel that was switched off does not count as connected in the top bar.
  const accounts = await prisma.instagramAccount.findMany({
    where: { workspaceId: workspace.id, status: { not: "DISCONNECTED" } },
    orderBy: { connectedAt: "desc" },
    select: { username: true },
  });
  // Banner at the top of the panel. Never breaks the layout if the query fails.
  const channelAlerts: ChannelAlert[] = await getChannelAlerts(workspace.id).catch(() => []);

  return (
    <DashboardShell
      workspaceName={workspace.name}
      instagramUsername={accounts[0]?.username ?? null}
      instagramAccountCount={accounts.length}
      channelAlerts={channelAlerts}
    >
      {children}
    </DashboardShell>
  );
}
