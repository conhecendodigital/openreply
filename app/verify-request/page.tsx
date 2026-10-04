import Link from "next/link";
import type { Metadata } from "next";

import { getT } from "@/lib/i18n/server";
import { LeadEngineLogo } from "@/components/sidebar";

/** 2026-10-04: mesmo cartão do login (visual do instagram.com). */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t("Check your email - Lead Engine"),
    description: t("A sign-in link was sent to your email."),
  };
}

export default async function VerifyRequestPage() {
  const t = await getT();
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#fafafa] px-4 py-10 text-foreground">
      <main className="w-full max-w-[350px] rounded-xl border border-border bg-white px-6 pb-8 pt-10 text-center sm:px-10">
        <h1 className="flex justify-center">
          <LeadEngineLogo className="scale-125" />
        </h1>
        <div className="mt-8" role="status">
          <h2 className="text-base font-semibold">{t("Check your email")}</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            {t("We sent you a secure sign-in link. Open it on this device to continue.")}
          </p>
        </div>
        <p className="mt-6 text-sm">
          <Link href="/login" className="font-semibold text-accent hover:underline">
            {t("Back to sign in")}
          </Link>
        </p>
      </main>
    </div>
  );
}
