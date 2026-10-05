import type { Metadata } from "next";
import LegalShell from "@/components/legal-shell";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t("Meta App Review Support - Lead Engine"),
    description: t("Meta App Review notes for Lead Engine's official Instagram private reply workflow."),
  };
}

export default async function MetaReviewPage() {
  const t = await getT();
  return (
    <LegalShell
      title={t("Meta App Review Support")}
      description={t(
        "Lead Engine is designed for Instagram professional accounts that want to send private replies after keyword comments on their own posts or reels."
      )}
      updatedLabel={t("Last updated May 24, 2026")}
    >
      <section>
        <h2>{t("User Flow")}</h2>
        <p className="mt-3">
          {t(
            "A business owner signs in by email, connects an Instagram professional account through Meta OAuth, creates a keyword campaign for a post or reel, and receives a webhook when someone comments. Lead Engine queues the event, deduplicates it, checks rate limits, then sends a private reply using the comment ID."
          )}
        </p>
      </section>

      <section>
        <h2>{t("Compliance Position")}</h2>
        <p className="mt-3">
          {t(
            "The app uses official Meta APIs, verifies webhook signatures, encrypts tokens, avoids scraping, avoids password collection, and sends no more than one private reply for a matched campaign/comment pair."
          )}
        </p>
      </section>

      <section>
        <h2>{t("Review Test Notes")}</h2>
        <p className="mt-3">
          {t(
            "Reviewers can use a Meta test business, connect an Instagram professional account, create a keyword such as LINK, comment that keyword on the selected media, and confirm that the private reply is sent and logged once."
          )}
        </p>
      </section>
    </LegalShell>
  );
}
