import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentWorkspaceContext, canManageWorkspace } from "@/lib/workspace-access";
import { VendasReport } from "@/components/reports/vendas-report";

/**
 * Vendas por origem (28/10/2026). Só dono/admin do workspace abre; os outros
 * veem 404. Os números vêm de /api/reports/vendas (que confere de novo).
 */
export const metadata: Metadata = { title: "Vendas por origem - Lead Engine" };
export const dynamic = "force-dynamic";

export default async function VendasPage() {
  const context = await getCurrentWorkspaceContext().catch(() => null);
  if (!context || !canManageWorkspace(context.role)) notFound();
  return <VendasReport />;
}
