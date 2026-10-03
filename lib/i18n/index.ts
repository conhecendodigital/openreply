import { pt } from "@/lib/i18n/pt";

/**
 * Two languages (2026-10-03): Portuguese (default) and English. The English text
 * in the code is the key; `pt` maps it to Portuguese. A string missing from the
 * dictionary simply shows in English, so nothing breaks while translating.
 * `{name}` placeholders are filled from `vars`.
 */
export type Lang = "pt" | "en";
export const LANGS: Lang[] = ["pt", "en"];
export const DEFAULT_LANG: Lang = "pt";
export const LANG_COOKIE = "lang";

export function normalizeLang(value: string | null | undefined): Lang {
  return value === "en" ? "en" : DEFAULT_LANG;
}

export function translate(lang: Lang, text: string, vars?: Record<string, string | number>): string {
  const base = lang === "pt" ? pt[text] ?? text : text;
  if (!vars) return base;
  return base.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

export type TFunction = (text: string, vars?: Record<string, string | number>) => string;
