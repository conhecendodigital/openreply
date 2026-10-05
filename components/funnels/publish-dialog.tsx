"use client";

/**
 * Etapa 6 (Quiz): confirm before publishing. Lists what blocks publishing
 * (errors) and what is only a warning, each with a link to the block. With
 * any error the Publish button stays off; the server checks again anyway.
 * Publishing is only possible here, signed in (never by API key or MCP).
 */

import { useEffect, useRef } from "react";
import { useT } from "@/components/lang-provider";
import type { FunnelDefinition, FunnelIssue, FunnelValidation } from "@/lib/funnels/types";
import { issueText } from "@/components/funnels/funnel-labels";

export default function PublishDialog({
  def,
  validation,
  shapeErrors,
  dirty,
  republish,
  busy,
  error,
  onGo,
  onPublish,
  onClose,
}: {
  def: FunnelDefinition;
  validation: FunnelValidation;
  shapeErrors: string[];
  dirty: boolean;
  republish: boolean;
  busy: boolean;
  error: string | null;
  onGo: (issue: FunnelIssue) => void;
  onPublish: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCloseRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const blocked = validation.errors.length > 0 || shapeErrors.length > 0;
  const stepNumber = (id?: string) => (id ? def.steps.findIndex((s) => s.id === id) + 1 : 0);

  const row = (issue: FunnelIssue, i: number) => (
    <li key={`${issue.code}-${i}`} className="flex items-start justify-between gap-3 py-2">
      <span className="text-sm">
        {stepNumber(issue.stepId) > 0 && <span className="mr-1 font-semibold">{t("Screen {n}:", { n: stepNumber(issue.stepId) })}</span>}
        {issueText(t, issue)}
      </span>
      {issue.stepId && (
        <button type="button" onClick={() => onGo(issue)} className="min-h-11 shrink-0 rounded-lg px-2 text-xs font-semibold text-accent hover:bg-surface-hover">
          {t("Go there")}
        </button>
      )}
    </li>
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="publish-title">
      <div className="flex max-h-[90dvh] w-full max-w-lg flex-col rounded-t-2xl bg-background sm:rounded-2xl">
        <div className="space-y-1 border-b border-border px-5 py-4">
          <h2 id="publish-title" className="text-base font-semibold">
            {republish ? t("Publish the changes?") : t("Publish the quiz?")}
          </h2>
          <p className="text-sm text-muted">
            {republish
              ? t("The live page switches to this version. Visits already in progress keep working.")
              : t("The link starts working for everyone. You can unpublish whenever you want.")}
          </p>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {shapeErrors.length > 0 && (
            <div className="space-y-1 rounded-xl bg-error/10 px-3 py-2">
              <p className="text-sm font-semibold text-error">{t("Some fields are not in the right format:")}</p>
              <ul className="list-disc pl-5 text-xs text-error">
                {shapeErrors.slice(0, 8).map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          )}
          {validation.errors.length > 0 ? (
            <section>
              <h3 className="text-sm font-semibold text-error">{t("Fix before publishing ({n})", { n: validation.errors.length })}</h3>
              <ul className="divide-y divide-border">{validation.errors.map(row)}</ul>
            </section>
          ) : (
            shapeErrors.length === 0 && <p className="rounded-xl bg-success/10 px-3 py-2 text-sm font-semibold text-[#3a8a12]">{t("Everything needed is filled in.")}</p>
          )}
          {validation.warnings.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-[#8a560c]">{t("Worth a look ({n})", { n: validation.warnings.length })}</h3>
              <ul className="divide-y divide-border">{validation.warnings.map(row)}</ul>
            </section>
          )}
          {dirty && !blocked && <p className="text-xs text-muted">{t("Your unsaved changes are saved first.")}</p>}
          {error && (
            <p role="alert" className="rounded-xl bg-error/10 px-3 py-2 text-sm text-error">
              {error}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3" style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}>
          <button ref={closeRef} type="button" onClick={onClose} className="min-h-11 rounded-lg px-4 text-sm font-semibold hover:bg-surface-hover">
            {t("Cancel")}
          </button>
          <button
            type="button"
            onClick={onPublish}
            disabled={blocked || busy}
            className="min-h-11 rounded-lg bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {busy ? t("Publishing…") : t("Publish")}
          </button>
        </div>
      </div>
    </div>
  );
}
