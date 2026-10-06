"use server";

/** Fase 0: liberar e tirar e-mails do beta (só o admin). */
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/client";
import { BETA_ALLOWLIST_LIMIT, normalizeAllowlistEmail, requirePlatformAdmin } from "@/lib/platform-admin";

export async function addAllowlistEmail(formData: FormData): Promise<void> {
  const admin = await requirePlatformAdmin();
  if (!admin) return;
  const email = normalizeAllowlistEmail(formData.get("email"));
  if (!email) return;
  const count = await prisma.betaAllowlist.count();
  const exists = await prisma.betaAllowlist.findUnique({ where: { email }, select: { email: true } });
  if (!exists && count >= BETA_ALLOWLIST_LIMIT) return;
  await prisma.betaAllowlist.upsert({
    where: { email },
    create: { email, addedById: admin.user.id, note: String(formData.get("note") ?? "").slice(0, 200) || null },
    update: {},
  });
  revalidatePath("/admin");
}

export async function removeAllowlistEmail(formData: FormData): Promise<void> {
  const admin = await requirePlatformAdmin();
  if (!admin) return;
  const email = normalizeAllowlistEmail(formData.get("email"));
  // O admin não tira o próprio e-mail (ficaria trancado pra fora).
  if (!email || email === admin.user.email?.toLowerCase()) return;
  await prisma.betaAllowlist.deleteMany({ where: { email } });
  // Quem saiu da lista perde as sessões abertas na hora.
  const user = await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true, role: true } });
  if (user && user.role !== "ADMIN") await prisma.authSession.deleteMany({ where: { userId: user.id } });
  revalidatePath("/admin");
}
