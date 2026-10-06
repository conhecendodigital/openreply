import type { Metadata } from "next";
import Link from "next/link";
import LegalShell from "@/components/legal-shell";
import { getLang, getT } from "@/lib/i18n/server";
import { LEGAL_INFO, legalVars } from "@/lib/legal-info";
import { CONFIRMATION_CODE, getDeletionStatus, type PublicDeletionStatus } from "@/lib/meta/data-callbacks";

/**
 * Página pública de status do pedido de exclusão (o `url` que o callback da
 * Meta devolve). Sem login. Mostra só o status e as datas, nunca o @, o id
 * nem nada da conta.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t("Deletion request status - Lead Engine"),
    robots: { index: false, follow: false },
  };
}

function formatDate(date: Date, lang: "pt" | "en"): string {
  return new Intl.DateTimeFormat(lang === "pt" ? "pt-BR" : "en-US", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(date);
}

export default async function DeletionStatusPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string | string[] }>;
}) {
  const t = await getT();
  const lang = await getLang();
  const vars = legalVars();
  const raw = (await searchParams).code;
  const code = (Array.isArray(raw) ? raw[0] : raw ?? "").trim().toUpperCase();

  let found: PublicDeletionStatus | null = null;
  let lookupFailed = false;
  if (CONFIRMATION_CODE.test(code)) {
    try {
      found = await getDeletionStatus(code);
    } catch {
      lookupFailed = true;
    }
  }

  let heading: string;
  let message: string;
  if (!code) {
    heading = t("Type your confirmation code");
    message = t("Use the code Meta showed you when you asked for the deletion.");
  } else if (lookupFailed) {
    heading = t("We could not check right now");
    message = t("Try again in a few minutes. If it keeps happening, write to {email}.", vars);
  } else if (!found) {
    heading = t("Code not found");
    message = t("Check that the code is right. If you need help, write to {email} with the code.", vars);
  } else if (found.status === "COMPLETED") {
    heading = t("Deletion completed");
    message = t("All the data of this Instagram account was deleted from {product}.", vars);
  } else if (found.status === "NOT_FOUND") {
    heading = t("No data to delete");
    message = t(
      "We did not find any data linked to this Instagram account, so there was nothing to delete. If you think this is a mistake, write to {email} with the code.",
      vars
    );
  } else {
    heading = t("Request received, in progress");
    message = t(
      "We are checking this request by hand and will delete the data within {days} days. If you need help, write to {email} with the code.",
      vars
    );
  }

  return (
    <LegalShell
      title={t("Deletion request status")}
      description={t("Status of a data deletion request sent by Meta when someone removes {product} on Instagram.", vars)}
      updatedLabel={t("Data Deletion")}
    >
      <section>
        <h2>{heading}</h2>
        <p className="mt-3">{message}</p>
        {code && CONFIRMATION_CODE.test(code) ? (
          <p className="mt-3 text-muted">
            {t("Code:")} <span className="font-mono">{code}</span>
          </p>
        ) : null}
        {found ? (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-muted">
            <li>
              {t("Received:")} {formatDate(found.createdAt, lang)}
            </li>
            {found.completedAt ? (
              <li>
                {t("Finished:")} {formatDate(found.completedAt, lang)}
              </li>
            ) : null}
          </ul>
        ) : null}
      </section>

      <section>
        <p>
          <Link href="/data-deletion" className="text-accent hover:underline">
            {t("How data deletion works")}
          </Link>
        </p>
        <p className="mt-3 text-muted">{LEGAL_INFO.company}</p>
      </section>
    </LegalShell>
  );
}
