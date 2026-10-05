"use client";

/**
 * New quiz (Etapa 6): pick a ready-made template (or blank), give it a name
 * and a link. It is created as a DRAFT and opens in the editor. Templates
 * come with [brackets] where real data is missing; publishing stays blocked
 * until every bracket, the price and the checkout are filled in.
 */

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useT } from "@/components/lang-provider";
import { FUNNEL_TEMPLATES } from "@/lib/funnels/templates";
import { MAX_FUNNEL_NAME } from "@/lib/funnels/schema";
import { isValidSlug, slugify } from "@/lib/funnels/slug";
import { toPublicFunnel } from "@/lib/funnels/render";
import type { FunnelDetail } from "@/lib/funnels/types";
import FunnelPlayer from "@/components/funnels/funnel-player";
import { funnelApi, funnelErrorText } from "@/components/funnels/funnel-api";
import { inputClass } from "@/components/funnels/form-controls";

export default function NewQuizPage() {
  return (
    <Suspense fallback={<div className="panel mx-auto h-[60vh] max-w-5xl animate-pulse rounded-2xl" />}>
      <NewQuiz />
    </Suspense>
  );
}

function Thumbnail({ templateId }: { templateId: string }) {
  const funnel = useMemo(() => {
    const tpl = FUNNEL_TEMPLATES.find((x) => x.id === templateId);
    if (!tpl) return null;
    const def = tpl.build();
    return toPublicFunnel({ id: `tpl-${tpl.id}`, slug: tpl.id, name: tpl.namePt, version: 0, definition: { ...def, steps: def.steps.slice(0, 1) } });
  }, [templateId]);
  if (!funnel) return null;
  const scale = 0.42;
  return (
    <div aria-hidden="true" inert className="pointer-events-none mx-auto overflow-hidden rounded-xl border border-border" style={{ width: 390 * scale, height: 300 * scale * 1.6 }}>
      <div className="origin-top-left" style={{ width: 390, transform: `scale(${scale})` }}>
        <FunnelPlayer funnel={funnel} mode="editor" />
      </div>
    </div>
  );
}

function NewQuiz() {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const initial = FUNNEL_TEMPLATES.some((x) => x.id === params.get("template")) ? (params.get("template") as string) : "escada-sim-vsl";
  const [templateId, setTemplateId] = useState(initial);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shownSlug = slugEdited ? slug : slugify(name);
  const slugBad = shownSlug !== "" && !isValidSlug(shownSlug);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const cleanName = name.trim().slice(0, MAX_FUNNEL_NAME);
    if (!cleanName) return setError(t("Give the quiz a name."));
    if (slugBad) return setError(t("The link can only have lowercase letters, numbers and hyphens (3 to 60)."));
    setBusy(true);
    setError(null);
    const r = await funnelApi<FunnelDetail>("/api/funnels", {
      method: "POST",
      json: { name: cleanName, templateId, ...(shownSlug ? { slug: shownSlug } : {}) },
    });
    if (!r.success) {
      setBusy(false);
      return setError(funnelErrorText(t, r));
    }
    router.push(`/quizzes/${r.data.id}`);
  }

  return (
    <form onSubmit={create} className="mx-auto max-w-5xl space-y-6">
      <div className="space-y-1">
        <Link href="/quizzes" className="inline-flex min-h-11 items-center text-sm text-muted hover:text-foreground">
          {t("← Quizzes")}
        </Link>
        <h2 className="text-xl font-semibold">{t("New quiz")}</h2>
        <p className="max-w-2xl text-sm text-muted">
          {t("Pick a template. Texts in [brackets] are where your real data goes: the quiz can only be published when none is left.")}
        </p>
      </div>

      <fieldset>
        <legend className="mb-3 text-sm font-semibold">{t("Template")}</legend>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FUNNEL_TEMPLATES.map((tpl) => {
            const selected = tpl.id === templateId;
            const steps = tpl.build().steps.length;
            return (
              <label
                key={tpl.id}
                className={`panel flex cursor-pointer flex-col gap-3 rounded-2xl p-4 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${
                  selected ? "border-accent ring-2 ring-accent/30" : "hover:border-border-hover"
                }`}
              >
                <input type="radio" name="template" value={tpl.id} checked={selected} onChange={() => setTemplateId(tpl.id)} className="sr-only" />
                <Thumbnail templateId={tpl.id} />
                <span className="flex items-start justify-between gap-2">
                  <span className="text-sm font-semibold">{t(tpl.name)}</span>
                  <span className="shrink-0 rounded-full bg-surface-hover px-2 py-0.5 text-[11px] font-semibold text-muted">{t("{n} screens", { n: steps })}</span>
                </span>
                <span className="text-xs text-muted">{t(tpl.description)}</span>
                {selected && <span className="text-xs font-semibold text-accent">{t("Selected")}</span>}
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="panel grid gap-4 rounded-2xl p-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="quiz-name" className="block text-xs font-semibold">
            {t("Quiz name")}
          </label>
          <input
            id="quiz-name"
            value={name}
            required
            maxLength={MAX_FUNNEL_NAME}
            placeholder={t("ex.: Chat Sem Frescura")}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
          />
          <p className="text-xs text-muted">{t("Only you see it. The page title is in the quiz settings.")}</p>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="quiz-slug" className="block text-xs font-semibold">
            {t("Link")}
          </label>
          <div className="flex items-center gap-1">
            <span className="shrink-0 text-sm text-muted">/q/</span>
            <input
              id="quiz-slug"
              value={shownSlug}
              maxLength={60}
              aria-invalid={slugBad || undefined}
              onChange={(e) => {
                setSlugEdited(true);
                setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
              }}
              className={inputClass}
            />
          </div>
          <p className={`text-xs ${slugBad ? "text-error" : "text-muted"}`}>
            {slugBad ? t("Lowercase letters, numbers and hyphens, 3 to 60.") : t("If the link is taken, a number is added at the end.")}
          </p>
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-xl bg-error/10 px-4 py-2.5 text-sm text-error">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Link href="/quizzes" className="inline-flex min-h-11 items-center rounded-lg px-4 text-sm font-semibold hover:bg-surface-hover">
          {t("Cancel")}
        </Link>
        <button type="submit" disabled={busy} className="min-h-11 rounded-lg bg-accent px-5 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50">
          {busy ? t("Creating…") : t("Create draft")}
        </button>
      </div>
    </form>
  );
}
