import { cookies } from "next/headers";
import { LANG_COOKIE, normalizeLang, translate, type Lang, type TFunction } from "@/lib/i18n";

export async function getLang(): Promise<Lang> {
  try {
    return normalizeLang((await cookies()).get(LANG_COOKIE)?.value);
  } catch {
    return normalizeLang(null);
  }
}

export async function getT(): Promise<TFunction> {
  const lang = await getLang();
  return (text, vars) => translate(lang, text, vars);
}
