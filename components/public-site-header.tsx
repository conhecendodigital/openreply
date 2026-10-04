import Link from "next/link";
import { LeadEngineLogo } from "@/components/sidebar";
import { LangSwitch } from "@/components/lang-provider";
import { getT } from "@/lib/i18n/server";

/**
 * Cabeçalho do site público (2026-10-04): visual do instagram.com, branco com
 * borda fina, logo Lead Engine, troca PT | EN e botão azul Entrar.
 */
interface PublicSiteHeaderProps {
  active?: "home" | "templates";
  /** Links da página inicial (âncoras). Nas outras páginas mostra Modelos e Agências. */
  variant?: "home" | "pages";
}

export default async function PublicSiteHeader({ active, variant = "pages" }: PublicSiteHeaderProps) {
  const t = await getT();
  const navLinks =
    variant === "home"
      ? [
          { label: t("Features"), href: "#recursos", key: "features" },
          { label: t("How it works"), href: "#como-funciona", key: "how" },
          { label: t("You in control"), href: "#controle", key: "control" },
        ]
      : [
          { label: t("Templates"), href: "/templates", key: "templates" },
          { label: t("Agencies"), href: "/instagram-dm-automation-agencies", key: "agencies" },
        ];

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link href="/" className="rounded-lg text-foreground" aria-label={t("Lead Engine home")}>
          <LeadEngineLogo />
        </Link>

        <nav className="hidden items-center gap-6 md:flex" aria-label={t("Main menu")}>
          {navLinks.map((link) => (
            <Link
              key={link.key}
              href={link.href}
              aria-current={active === link.key ? "page" : undefined}
              className={`text-sm transition-colors ${
                active === link.key ? "font-semibold text-foreground" : "text-muted hover:text-foreground"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2 sm:gap-3">
          <LangSwitch />
          <Link
            href="/login"
            className="inline-flex h-9 items-center justify-center rounded-lg bg-accent px-4 text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
          >
            {t("Sign in")}
          </Link>
        </div>
      </div>
    </header>
  );
}
