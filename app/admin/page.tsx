import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import { prisma } from "@/lib/db/client";
import { adminMenuState, BETA_ALLOWLIST_LIMIT, requirePlatformAdmin } from "@/lib/platform-admin";
import { auth } from "@/lib/auth";
import { listSessionsAsAdmin } from "@/lib/whatsapp/admin-access";
import { addAllowlistEmail, removeAllowlistEmail } from "./actions";
import { AiKeysPanel } from "@/components/ai-keys-panel";
import { AiUsageReport } from "@/components/ai-usage-report";

/**
 * Fase 0 (06/10/2026): painel do admin da plataforma (no menu só pro admin,
 * grupo "Admin da plataforma"; só o admin com 2FA abre, admin sem 2FA vai pra
 * tela de ligar o 2FA, os outros recebem 404). Números e status de
 * todo mundo, sem conteúdo de conversa (abrir conversa de outro workspace só
 * com registro de auditoria, lib/whatsapp/admin-access.ts).
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Admin - Lead Engine") };
}

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const admin = await requirePlatformAdmin();
  if (!admin) {
    // Admin da plataforma que ainda não ligou o 2FA: vai pra tela de ligar (não 404).
    const session = await auth().catch(() => null);
    if (adminMenuState(session?.user) === "needs_2fa") redirect("/account/two-factor");
    notFound();
  }
  const t = await getT();

  const [allowlist, users, waSessions] = await Promise.all([
    prisma.betaAllowlist.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.user.findMany({
      orderBy: { createdAt: "asc" },
      take: 200,
      select: {
        id: true,
        email: true,
        role: true,
        twoFactorEnabled: true,
        createdAt: true,
        _count: { select: { workspaceMembers: true, authSessions: true } },
      },
    }),
    listSessionsAsAdmin(admin.user.id).catch(() => null),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t("Admin")}</h1>
        <Link href="/dashboard" className="text-sm font-semibold text-accent hover:underline">
          {t("Back to the panel")}
        </Link>
      </div>

      <section className="panel rounded p-4 sm:p-6">
        <h2 className="mb-2 text-base font-semibold">{t("Beta access")}</h2>
        <p className="mb-4 text-sm text-muted">
          {t("Only these emails get in, plus ALLOWED_EMAILS and whoever was invited to a workspace. Up to {n} in the beta.", {
            n: BETA_ALLOWLIST_LIMIT,
          })}
        </p>
        <ul className="mb-4 divide-y divide-border rounded-lg border border-border">
          {allowlist.length === 0 && <li className="px-3 py-2 text-sm text-muted">{t("No email on the list yet.")}</li>}
          {allowlist.map((row) => (
            <li key={row.email} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span>
                {row.email}
                {row.note && <span className="ml-2 text-xs text-muted">{row.note}</span>}
              </span>
              {row.email !== admin.user.email?.toLowerCase() && (
                <form action={removeAllowlistEmail}>
                  <input type="hidden" name="email" value={row.email} />
                  <button type="submit" className="text-sm font-semibold text-red-600 hover:underline">
                    {t("Remove")}
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
        {allowlist.length < BETA_ALLOWLIST_LIMIT && (
          <form action={addAllowlistEmail} className="flex flex-wrap gap-2">
            <input
              name="email"
              type="email"
              required
              placeholder={t("person@email.com")}
              aria-label={t("Email")}
              className="h-9 min-w-0 flex-1 rounded-md border border-border bg-[#fafafa] px-3 text-sm"
            />
            <input
              name="note"
              placeholder={t("Note (optional)")}
              aria-label={t("Note (optional)")}
              className="h-9 min-w-0 flex-1 rounded-md border border-border bg-[#fafafa] px-3 text-sm"
            />
            <button type="submit" className="h-9 rounded-lg bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-hover">
              {t("Add")}
            </button>
          </form>
        )}
      </section>

      <section id="chaves-ia" className="panel rounded p-4 sm:p-6">
        <h2 className="mb-2 text-base font-semibold">{t("AI keys")}</h2>
        <p className="mb-4 text-sm text-muted">
          {t("One key per provider, used by every user in the beta. After you save it, only the last 4 characters show up here. Every change goes to the audit log.")}
        </p>
        <AiKeysPanel />
      </section>

      <section id="gastos-ia" className="panel rounded p-4 sm:p-6">
        <h2 className="mb-2 text-base font-semibold">{t("AI spending")}</h2>
        <p className="mb-4 text-sm text-muted">
          {t("What each call to the AI cost, per user, workspace, agent and model. Estimated with the price table above.")}
        </p>
        <AiUsageReport scope="admin" />
      </section>

      <section className="panel rounded p-4 sm:p-6">
        <h2 className="mb-4 text-base font-semibold">{t("Users")}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="py-2 pr-4">{t("Email")}</th>
                <th className="py-2 pr-4">{t("Role")}</th>
                <th className="py-2 pr-4">{t("Two-step verification")}</th>
                <th className="py-2 pr-4">{t("Workspaces")}</th>
                <th className="py-2 pr-4">{t("Active sessions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="py-2 pr-4">{u.email}</td>
                  <td className="py-2 pr-4">{u.role === "ADMIN" ? t("Admin") : t("User")}</td>
                  <td className="py-2 pr-4">{u.twoFactorEnabled ? t("On") : t("Off")}</td>
                  <td className="py-2 pr-4">{u._count.workspaceMembers}</td>
                  <td className="py-2 pr-4">{u._count.authSessions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel rounded p-4 sm:p-6">
        <h2 className="mb-2 text-base font-semibold">{t("WhatsApp numbers")}</h2>
        <p className="mb-4 text-sm text-muted">
          {t("Status and numbers only. Opening a conversation of another workspace is saved in the audit log.")}
        </p>
        {waSessions === null ? (
          <p className="text-sm text-muted">{t("Could not read the WhatsApp tables. Check the database roles (docs/fase0-multiusuario.md).")}</p>
        ) : waSessions.length === 0 ? (
          <p className="text-sm text-muted">{t("No number connected yet.")}</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {waSessions.map((s) => (
              <li key={s.id} className="flex flex-wrap justify-between gap-2 px-3 py-2 text-sm">
                <span>{s.displayName ?? s.phoneE164 ?? s.id}</span>
                <span className="text-muted">
                  {s.status} · {t("{n} conversations", { n: s.conversationCount })} · {t("{n} messages", { n: s.messageCount })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
