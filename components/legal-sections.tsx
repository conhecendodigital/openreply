import type { TFunction } from "@/lib/i18n";
import type { LegalSection } from "@/lib/legal-pages";

/** Seções de uma página legal, já traduzidas e com os dados da empresa. */
export default function LegalSections({
  sections,
  t,
  vars,
}: {
  sections: LegalSection[];
  t: TFunction;
  vars: Record<string, string | number>;
}) {
  return (
    <>
      {sections.map((section) => (
        <section key={section.heading}>
          <h2>{t(section.heading, vars)}</h2>
          {section.paragraphs.map((p) => (
            <p key={p} className="mt-3">
              {t(p, vars)}
            </p>
          ))}
          {section.items?.length ? (
            <ul className="mt-3 list-disc space-y-2 pl-5">
              {section.items.map((item) => (
                <li key={item}>{t(item, vars)}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}
    </>
  );
}
