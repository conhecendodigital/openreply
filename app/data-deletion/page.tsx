import type { Metadata } from "next";
import LegalShell from "@/components/legal-shell";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t("Data Deletion - Lead Engine"),
    description: t(
      "How Lead Engine customers can disconnect Instagram and request account or campaign data deletion."
    ),
  };
}

export default async function DataDeletionPage() {
  const t = await getT();
  return (
    <LegalShell
      title={t("Data Deletion")}
      description={t(
        "Use this page for Meta App Review and customer requests about removing Lead Engine account, workspace, Instagram, and campaign data."
      )}
      updatedLabel={t("Last updated May 24, 2026")}
    >
      <section>
        <h2>{t("Disconnect Instagram")}</h2>
        <p className="mt-3">
          {t(
            "Sign in, open Settings, and select Disconnect. This removes the stored Instagram connection token and stops campaigns from sending private replies for that workspace."
          )}
        </p>
      </section>

      <section>
        <h2>{t("Delete Workspace Data")}</h2>
        <p className="mt-3">
          {t(
            "To delete workspace, campaign, log, webhook, billing reference, and operational diagnostic data, contact support from the email address used to sign in. Include the workspace name and the Instagram username connected to the workspace."
          )}
        </p>
      </section>

      <section>
        <h2>{t("Verification")}</h2>
        <p className="mt-3">
          {t(
            "We may ask you to verify control of the email address or connected business account before deleting data. Deletion requests are processed as quickly as practical unless retention is required for legal, billing, fraud prevention, or security reasons."
          )}
        </p>
      </section>
    </LegalShell>
  );
}
