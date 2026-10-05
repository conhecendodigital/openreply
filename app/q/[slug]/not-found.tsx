/**
 * Etapa 6 (Quiz): 404 of a funnel link. Same answer for an unknown slug, a
 * draft or an archived funnel, so nothing leaks.
 */

import { getLang } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n";

export default async function FunnelNotFound() {
  const lang = await getLang();
  const tr = (text: string) => translate(lang, text);
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
      <p className="text-5xl font-bold">404</p>
      <h1 className="text-xl font-semibold">{tr("This page is not available")}</h1>
      <p className="text-sm text-muted">{tr("The link may be wrong or the page is not online anymore.")}</p>
    </main>
  );
}
