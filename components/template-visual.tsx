import type { CampaignTemplate } from "@/lib/templates/campaign-templates";
import type { TFunction } from "@/lib/i18n";

interface TemplateVisualProps {
  template: CampaignTemplate;
  t: TFunction;
  compact?: boolean;
}

/**
 * Prévia de um modelo (2026-10-04): o comentário que dispara e a DM que sai,
 * no visual do Direct (bolha cinza da pessoa, bolha azul da resposta).
 */
export default function TemplateVisual({ template, t, compact = false }: TemplateVisualProps) {
  return (
    <div className="rounded-xl border border-border bg-white p-4" aria-label={t("Template preview")}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">{t("Comment trigger")}</p>
        <span className="rounded-full border border-border px-2.5 py-0.5 text-[11px] font-semibold text-muted">
          {t(template.category)}
        </span>
      </div>

      <div className="space-y-2 pt-3 text-[13px] leading-snug">
        <div className="flex items-end gap-2">
          <span className="h-6 w-6 shrink-0 rounded-full bg-[#efefef]" aria-hidden="true" />
          <p className="max-w-[80%] rounded-[18px] bg-[#efefef] px-3.5 py-2 font-semibold text-foreground">
            {t(template.triggerExample)}
          </p>
        </div>
        <p className="ml-auto max-w-[85%] rounded-[18px] bg-accent px-3.5 py-2 text-white">
          {t(template.privateReplyPreview)}
        </p>
      </div>

      {!compact && (
        <div className="mt-4 border-t border-border pt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">{t("Keywords")}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {template.keywords.map((keyword) => (
              <span
                key={keyword}
                className="rounded-md border border-border bg-[#fafafa] px-2 py-1 text-xs font-semibold text-foreground"
              >
                {t(keyword)}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
