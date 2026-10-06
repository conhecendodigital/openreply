import { getT } from "@/lib/i18n/server";
import { LEGAL_INFO, legalVars } from "@/lib/legal-info";

/**
 * Linha da empresa nos rodapés públicos (06/10/2026, revisão do app pela
 * Meta): o site precisa bater com os documentos da empresa. Os dados vêm de
 * lib/legal-info.ts.
 */
export default async function LegalCompanyLine({ className = "" }: { className?: string }) {
  const t = await getT();
  const vars = legalVars();
  return (
    <div className={`space-y-1 ${className}`.trim()}>
      <p>{t("{product} is a service of {company}, CNPJ {cnpj}. {city}, Brazil.", vars)}</p>
      <p>
        {t("Contact:")} <span>{LEGAL_INFO.email}</span>
      </p>
      <p>© 2026 {LEGAL_INFO.company}</p>
    </div>
  );
}
