import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import { auth } from "@/lib/auth";
import { adminMenuState, requirePlatformAdmin } from "@/lib/platform-admin";
import { FunisBoard } from "@/components/admin-funnels/funis-board";

/**
 * Aba "Funis" (10/10/2026): só o admin da plataforma abre (mesma regra do
 * /admin: role ADMIN com 2FA; sem 2FA vai pra tela de ligar; os outros, 404).
 * Os números vêm das mesmas rotas que o Relatório e os Quizzes já usam.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Funnels - Lead Engine") };
}

export const dynamic = "force-dynamic";

export default async function FunisPage() {
  const admin = await requirePlatformAdmin();
  if (!admin) {
    const session = await auth().catch(() => null);
    if (adminMenuState(session?.user) === "needs_2fa") redirect("/account/two-factor");
    notFound();
  }
  return <FunisBoard />;
}
