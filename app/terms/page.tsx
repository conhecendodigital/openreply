import type { Metadata } from "next";
import LegalShell from "@/components/legal-shell";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t("Terms of Service - Lead Engine"),
    description: t("Terms for using Lead Engine's Instagram comment-to-DM campaign software."),
  };
}

export default async function TermsPage() {
  const t = await getT();
  return (
    <LegalShell
      title={t("Terms of Service")}
      description={t(
        "These terms define acceptable use for Lead Engine's hosted Instagram comment-to-DM campaign service."
      )}
      updatedLabel={t("Last updated May 24, 2026")}
    >
      <section>
        <h2>{t("Authorized Use")}</h2>
        <p className="mt-3">
          {t(
            "You may use Lead Engine only with Instagram professional accounts you own or are authorized to manage. You are responsible for the campaigns, keywords, links, and messages you configure."
          )}
        </p>
      </section>

      <section>
        <h2>{t("Platform Compliance")}</h2>
        <p className="mt-3">
          {t(
            "You agree to follow Meta Platform Terms, Instagram policies, applicable messaging rules, privacy laws, advertising rules, and anti-spam laws. Lead Engine may rate-limit, pause, or disable campaigns that create compliance, abuse, security, or deliverability risk."
          )}
        </p>
      </section>

      <section>
        <h2>{t("Availability")}</h2>
        <p className="mt-3">
          {t(
            "Lead Engine depends on third-party platforms including Meta, email, hosting, database, and queue providers. We work to operate the service reliably, but uninterrupted availability is not guaranteed."
          )}
        </p>
      </section>

      <section>
        <h2>{t("Open-Source Core")}</h2>
        <p className="mt-3">
          {t(
            "The public repository is MIT licensed. Hosted SaaS infrastructure, managed support, agency workflows, analytics, reports, and other paid service features may be provided separately from the open-source core."
          )}
        </p>
      </section>
    </LegalShell>
  );
}
