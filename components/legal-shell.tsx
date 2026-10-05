import PublicSiteHeader from "@/components/public-site-header";
import PublicSiteFooter from "@/components/public-site-footer";

/**
 * Páginas legais (2026-10-04): visual novo do site público, texto escuro sobre
 * cartão branco. Os textos chegam já traduzidos pela página.
 */
interface LegalShellProps {
  title: string;
  description: string;
  /** Linha "Atualizado em ..." já traduzida. */
  updatedLabel: string;
  children: React.ReactNode;
}

export default function LegalShell({ title, description, updatedLabel, children }: LegalShellProps) {
  return (
    <div className="min-h-screen bg-[#fafafa] text-foreground">
      <PublicSiteHeader />

      <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 md:py-14">
        <article className="rounded-xl border border-border bg-white px-5 py-8 sm:px-10 sm:py-10">
          <p className="text-xs font-semibold uppercase tracking-wide text-accent">{updatedLabel}</p>
          <h1 className="mt-3 text-balance text-[28px] font-bold leading-tight tracking-tight sm:text-[36px]">
            {title}
          </h1>
          <p className="mt-4 text-base leading-7 text-muted">{description}</p>
          <div className="mt-8 space-y-7 break-words text-sm leading-7 text-foreground [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-foreground">
            {children}
          </div>
        </article>
      </main>

      <PublicSiteFooter />
    </div>
  );
}
