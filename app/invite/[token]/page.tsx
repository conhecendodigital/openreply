import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import InvitationAcceptCard from "@/components/invitation-accept-card";
import { LeadEngineLogo } from "@/components/sidebar";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { getT } from "@/lib/i18n/server";

/** Convite pro espaço de trabalho (2026-10-04): mesmo cartão do login. */
type InvitePageProps = {
  params: Promise<{ token: string }>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t("Accept Workspace Invitation - Lead Engine"),
    robots: { index: false, follow: false },
  };
}

export default async function InvitePage({ params }: InvitePageProps) {
  const t = await getT();
  const { token } = await params;
  const [session, invitation] = await Promise.all([
    auth(),
    prisma.workspaceInvitation.findUnique({
      where: { token },
      include: {
        workspace: { select: { name: true } },
      },
    }),
  ]);

  if (!invitation || invitation.status !== "PENDING") {
    notFound();
  }

  const expired = invitation.expiresAt <= new Date();

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#fafafa] px-4 py-10 text-foreground">
      <main className="w-full max-w-[400px] rounded-xl border border-border bg-white px-6 pb-8 pt-10 sm:px-10">
        <Link href="/" className="flex justify-center text-foreground" aria-label={t("Lead Engine home")}>
          <LeadEngineLogo className="scale-125" />
        </Link>
        <p className="mt-8 text-center text-xs font-semibold uppercase tracking-wide text-muted">
          {t("Workspace invitation")}
        </p>
        <h1 className="mt-2 break-words text-center text-xl font-semibold leading-snug">
          {t("Join {name}", { name: invitation.workspace.name })}
        </h1>
        <p className="mt-3 break-words text-center text-sm leading-6 text-muted">
          {t("You were invited as {role} for {email}.", {
            role: t(invitation.role.toLowerCase()),
            email: invitation.email,
          })}
        </p>
        <div className="mt-6 flex justify-center text-center">
          {expired ? (
            <p className="text-sm text-error">
              {t("This invitation has expired. Ask the workspace owner to resend it.")}
            </p>
          ) : (
            <InvitationAcceptCard
              token={token}
              isSignedIn={Boolean(session?.user?.id)}
              invitedEmail={invitation.email}
            />
          )}
        </div>
      </main>
    </div>
  );
}
