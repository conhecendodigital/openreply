import type { Metadata } from "next";
import LegalShell from "@/components/legal-shell";
import { getLang, getT } from "@/lib/i18n/server";
import { LEGAL_INFO, legalVars } from "@/lib/legal-info";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t("Meta App Review Support - Lead Engine"),
    description: t("Meta App Review notes for Lead Engine's official Instagram private reply workflow."),
  };
}

export default async function MetaReviewPage() {
  const t = await getT();
  const lang = await getLang();
  const vars = legalVars();
  return (
    <LegalShell
      title={t("Meta App Review Support")}
      description={t(
        "Lead Engine is designed for Instagram professional accounts that want to send private replies after keyword comments on their own posts or reels."
      )}
      updatedLabel={t("Last updated {date}", { date: lang === "pt" ? LEGAL_INFO.updatedPt : LEGAL_INFO.updatedEn })}
    >
      <section>
        <h2>{t("User Flow")}</h2>
        <p className="mt-3">
          {t(
            "A business owner signs in with email and password (or a sign-in link, or Google), connects an Instagram professional account through Instagram business login, creates a keyword campaign for a post or reel, and Lead Engine receives a webhook when someone comments. It queues the event, removes duplicates, checks rate limits and sends one private reply using the comment ID. The conversation continues in the Inbox after the person answers."
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
        <h2>{t("Deauthorize and data deletion callbacks")}</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5">
          <li>
            {t(
              "Deauthorize callback URL: {site}/api/instagram/deauthorize. When someone removes the app on Instagram, the account is disconnected and its token is deleted. Conversations, contacts and campaigns are kept.",
              vars
            )}
          </li>
          <li>
            {t(
              "Data deletion request URL: {site}/api/instagram/data-deletion. The signed_request is checked with HMAC-SHA256 and the app secret, every piece of data of that account is deleted and the answer brings a confirmation code and the status page ({site}/data-deletion/status).",
              vars
            )}
          </li>
        </ul>
        <p className="mt-3">
          {t("Both URLs go in the App Dashboard: Instagram, API setup with Instagram login, Business login settings.")}
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
