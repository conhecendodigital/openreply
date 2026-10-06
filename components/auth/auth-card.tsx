import { LeadEngineLogo } from "@/components/sidebar";

/** Cartão central das telas de conta (mesmo visual do login, estilo instagram.com). */
export function AuthCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#fafafa] px-4 py-10 text-foreground">
      <main className="w-full max-w-[380px] rounded-xl border border-border bg-white px-6 pb-8 pt-10 sm:px-10">
        <p className="flex justify-center">
          <LeadEngineLogo className="scale-125" />
        </p>
        <h1 className="mt-8 text-center text-base font-semibold">{title}</h1>
        <div className="mt-4">{children}</div>
      </main>
    </div>
  );
}
