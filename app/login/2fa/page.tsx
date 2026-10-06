import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import { LeadEngineLogo } from "@/components/sidebar";
import { TwoFactorChallenge } from "@/components/auth/two-factor-challenge";
import { safeCallbackPath } from "@/lib/auth-config";

/** Fase 0: tela do código do 2FA, depois da senha, do link ou do Google. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Two-step verification - Lead Engine") };
}

export default async function TwoFactorPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const t = await getT();
  const { callbackUrl } = await searchParams;
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#fafafa] px-4 py-10 text-foreground">
      <main className="w-full max-w-[350px] rounded-xl border border-border bg-white px-6 pb-8 pt-10 sm:px-10">
        <h1 className="flex justify-center">
          <LeadEngineLogo className="scale-125" />
        </h1>
        <h2 className="mt-8 text-center text-base font-semibold">{t("Two-step verification")}</h2>
        <TwoFactorChallenge callbackUrl={safeCallbackPath(callbackUrl, "http://local.invalid")} />
      </main>
    </div>
  );
}
