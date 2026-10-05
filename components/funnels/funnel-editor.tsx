"use client";

/**
 * Etapa 6 (Quiz): editor of a funnel, /quizzes/[id].
 *
 *  - Wide screens: screens and blocks on the left, properties in the middle,
 *    live phone preview on the right. Phones: tabs (Screens / Blocks /
 *    Properties / Preview).
 *  - Same checks as the server, live (zod shape + validateFunnel): errors
 *    block publishing, warnings only inform. Save = PATCH of the draft; what
 *    is live only changes on Publish (asked in a dialog, signed in only).
 *  - Ctrl/Cmd + S saves. Leaving with unsaved changes asks first.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/components/lang-provider";
import { emptyFunnelDefinition, funnelDefinitionSchema, MAX_FUNNEL_NAME, parseFunnelDefinition } from "@/lib/funnels/schema";
import { validateFunnel } from "@/lib/funnels/validate";
import { isValidSlug, slugify } from "@/lib/funnels/slug";
import type { FunnelDefinition, FunnelDetail, FunnelIssue } from "@/lib/funnels/types";
import { funnelApi, funnelErrorText } from "@/components/funnels/funnel-api";
import { BLOCK_TYPE_LABEL } from "@/components/funnels/funnel-labels";
import { FunnelStatusChip } from "@/components/funnels/status-chip";
import StepList from "@/components/funnels/step-list";
import BlockList from "@/components/funnels/block-list";
import BlockPanel from "@/components/funnels/block-panel";
import SettingsPanel from "@/components/funnels/settings-panel";
import PhonePreview from "@/components/funnels/phone-preview";
import PublishDialog from "@/components/funnels/publish-dialog";
import { MediaUploadProvider, type MediaEditorState } from "@/components/funnels/media-upload";
import { getMediaUploader, setMediaPublicBase, type FunnelMediaItem, type MediaUploadConfig } from "@/lib/funnels/media";

type Tab = "steps" | "blocks" | "props" | "preview";
type Notice = { tone: "ok" | "error" | "warn"; text: string };

const NARROW = "(max-width: 1279px)";
const isNarrow = () => typeof window !== "undefined" && window.matchMedia(NARROW).matches;

export default function FunnelEditor({ funnelId }: { funnelId: string }) {
  const t = useT();
  const router = useRouter();

  const [meta, setMeta] = useState<FunnelDetail | null>(null);
  const [def, setDefState] = useState<FunnelDefinition | null>(null);
  const [savedJson, setSavedJson] = useState("");
  const [name, setName] = useState("");
  const [savedName, setSavedName] = useState("");
  const [slug, setSlug] = useState("");
  const [savedSlug, setSavedSlug] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [stepId, setStepId] = useState("");
  const [blockId, setBlockId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("blocks");
  const [busy, setBusy] = useState<"save" | "publish" | "unpublish" | "delete" | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showPublish, setShowPublish] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [media, setMedia] = useState<{ config: MediaUploadConfig | null; files: FunnelMediaItem[] }>({ config: null, files: [] });
  const mediaState = useMemo<MediaEditorState>(
    () => ({
      uploader: getMediaUploader(media.config ? { ...media.config, funnelId } : null),
      files: media.files,
      addFile: (file) => setMedia((s) => ({ ...s, files: [file, ...s.files.filter((f) => f.id !== file.id)] })),
    }),
    [media, funnelId]
  );
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  const setDef = (update: (d: FunnelDefinition) => FunnelDefinition) => setDefState((d) => (d ? update(d) : d));

  // ── Load ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    const path = `/api/funnels/${encodeURIComponent(funnelId)}`;
    void Promise.all([
      funnelApi<FunnelDetail>(path),
      funnelApi<MediaUploadConfig & { files: FunnelMediaItem[] }>(`${path}/media`),
    ]).then(([r, m]) => {
      if (!alive) return;
      const tr = tRef.current;
      // Before the draft: the checks of a video of our own storage need the base.
      const mediaConfig = m.success ? m.data : null;
      setMediaPublicBase(mediaConfig?.publicBaseUrl ?? null);
      setMedia({ config: mediaConfig, files: mediaConfig?.files ?? [] });
      if (!r.success) {
        setLoadError(funnelErrorText(tr, r));
        return;
      }
      const parsed = parseFunnelDefinition(r.data.draft);
      const loaded = parsed.ok ? parsed.definition : emptyFunnelDefinition();
      if (!parsed.ok) setNotice({ tone: "warn", text: tr("The saved draft could not be read. It was reset to an empty quiz.") });
      setMeta(r.data);
      setDefState(loaded);
      setSavedJson(JSON.stringify(loaded));
      setName(r.data.name);
      setSavedName(r.data.name);
      setSlug(r.data.slug);
      setSavedSlug(r.data.slug);
      setStepId(loaded.steps[0]?.id ?? "");
    });
    return () => {
      alive = false;
    };
  }, [funnelId]);

  // ── Derived ──────────────────────────────────────────────────────────────
  const defJson = useMemo(() => (def ? JSON.stringify(def) : ""), [def]);
  const dirty = def !== null && (defJson !== savedJson || name.trim() !== savedName || slug !== savedSlug);

  const shape = useMemo(() => {
    if (!def) return [] as { stepIndex: number | null; blockIndex: number | null; text: string }[];
    const r = funnelDefinitionSchema.safeParse(def);
    if (r.success) return [];
    return r.error.issues.map((i) => {
      const p = i.path;
      const stepIndex = p[0] === "steps" && typeof p[1] === "number" ? p[1] : null;
      const blockIndex = stepIndex !== null && p[2] === "blocks" && typeof p[3] === "number" ? p[3] : null;
      return { stepIndex, blockIndex, text: i.message };
    });
  }, [def]);

  const shapeTexts = useMemo(() => {
    if (!def) return [];
    return shape.map((s) => {
      if (s.stepIndex === null) return `${t("Settings")}: ${s.text}`;
      const step = def.steps[s.stepIndex];
      const block = s.blockIndex !== null ? step?.blocks[s.blockIndex] : undefined;
      const where = block
        ? t("Screen {n}, {block}", { n: s.stepIndex + 1, block: t(BLOCK_TYPE_LABEL[block.type]) })
        : t("Screen {n}", { n: s.stepIndex + 1 });
      return `${where}: ${s.text}`;
    });
  }, [shape, def, t]);

  const validation = useMemo(() => (def ? validateFunnel(def) : { ok: false, errors: [], warnings: [] }), [def]);
  const allIssues = useMemo(() => [...validation.errors, ...validation.warnings], [validation]);

  const counts = useMemo(() => {
    const m = new Map<string, { errors: number; warnings: number }>();
    const bump = (key: string | undefined, kind: "errors" | "warnings") => {
      if (!key) return;
      const c = m.get(key) ?? { errors: 0, warnings: 0 };
      c[kind]++;
      m.set(key, c);
    };
    for (const e of validation.errors) {
      bump(e.stepId, "errors");
      bump(e.blockId, "errors");
    }
    for (const w of validation.warnings) {
      bump(w.stepId, "warnings");
      bump(w.blockId, "warnings");
    }
    if (def) {
      for (const s of shape) {
        if (s.stepIndex === null) continue;
        const step = def.steps[s.stepIndex];
        bump(step?.id, "errors");
        if (s.blockIndex !== null) bump(step?.blocks[s.blockIndex]?.id, "errors");
      }
    }
    return m;
  }, [validation, shape, def]);

  const currentStepId = def?.steps.some((s) => s.id === stepId) ? stepId : (def?.steps[0]?.id ?? "");
  const currentBlockId = def?.steps.find((s) => s.id === currentStepId)?.blocks.some((b) => b.id === blockId) ? blockId : null;

  // ── Guards ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // ── Selection ────────────────────────────────────────────────────────────
  function selectStep(id: string, fromPreview = false) {
    setStepId(id);
    setBlockId(null);
    if (!fromPreview && isNarrow()) setTab("blocks");
  }
  function selectBlock(id: string | null) {
    setBlockId(id);
    if (id && isNarrow()) setTab("props");
  }
  function goToIssue(issue: FunnelIssue) {
    setShowPublish(false);
    if (issue.stepId) setStepId(issue.stepId);
    setBlockId(issue.blockId ?? null);
    if (isNarrow()) setTab("props");
  }

  // ── Actions ──────────────────────────────────────────────────────────────
  async function save(): Promise<boolean> {
    if (!def || !meta) return false;
    if (shape.length) {
      setNotice({ tone: "error", text: t("Fix the fields marked in red before saving.") });
      return false;
    }
    const cleanName = name.trim().slice(0, MAX_FUNNEL_NAME) || meta.name;
    if (slug !== savedSlug && !isValidSlug(slug)) {
      setNotice({ tone: "error", text: t("The link can only have lowercase letters, numbers and hyphens (3 to 60).") });
      return false;
    }
    setBusy("save");
    setNotice(null);
    const r = await funnelApi<FunnelDetail>(`/api/funnels/${encodeURIComponent(meta.id)}`, {
      method: "PATCH",
      json: { name: cleanName, ...(slug !== savedSlug ? { slug } : {}), draft: def },
    });
    setBusy(null);
    if (!r.success) {
      setNotice({ tone: "error", text: funnelErrorText(t, r) });
      return false;
    }
    setMeta(r.data);
    setSavedJson(defJson);
    setName(cleanName);
    setSavedName(cleanName);
    setSlug(r.data.slug);
    setSavedSlug(r.data.slug);
    setNotice({
      tone: "ok",
      text: r.data.status === "PUBLISHED" ? t("Saved. The live page only changes when you publish again.") : t("Draft saved. It only goes live when you publish."),
    });
    return true;
  }

  async function publish() {
    if (!meta) return;
    setPublishError(null);
    if (dirty && !(await save())) {
      setPublishError(t("Could not save the changes. Nothing was published."));
      return;
    }
    setBusy("publish");
    const r = await funnelApi<FunnelDetail>(`/api/funnels/${encodeURIComponent(meta.id)}/publish`, { method: "POST" });
    setBusy(null);
    if (!r.success) {
      setPublishError(funnelErrorText(t, r));
      return;
    }
    setMeta(r.data);
    setShowPublish(false);
    setNotice({ tone: "ok", text: t("Published (version {v}). The link is live.", { v: r.data.publishedVersion }) });
  }

  async function unpublish(archive: boolean) {
    if (!meta) return;
    const question = archive
      ? t("Archive “{name}”? The link stops working and the quiz leaves the list.", { name: meta.name })
      : t("Unpublish “{name}”? The link stops working until you publish again.", { name: meta.name });
    if (!window.confirm(question)) return;
    setBusy("unpublish");
    const r = await funnelApi<FunnelDetail>(`/api/funnels/${encodeURIComponent(meta.id)}/unpublish`, { method: "POST", json: { archive } });
    setBusy(null);
    if (!r.success) return setNotice({ tone: "error", text: funnelErrorText(t, r) });
    setMeta(r.data);
    setNotice({ tone: "ok", text: archive ? t("Archived. The link no longer works.") : t("Unpublished. The link no longer works.") });
  }

  async function remove() {
    if (!meta || meta.status === "PUBLISHED") return;
    if (!window.confirm(t("Delete the quiz “{name}”? Its results and leads are deleted too.", { name: meta.name }))) return;
    setBusy("delete");
    const r = await funnelApi(`/api/funnels/${encodeURIComponent(meta.id)}`, { method: "DELETE" });
    setBusy(null);
    if (!r.success) return setNotice({ tone: "error", text: funnelErrorText(t, r) });
    setSavedJson(defJson);
    setSavedName(name.trim());
    setSavedSlug(slug);
    router.push("/quizzes");
  }

  async function copyLink() {
    if (!meta) return;
    const url = `${window.location.origin}/q/${meta.slug}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt(t("Copy the link"), url);
    }
  }

  // Ctrl/Cmd + S saves the draft.
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────
  if (loadError) {
    return (
      <div className="panel mx-auto max-w-lg space-y-4 rounded-2xl p-8 text-center">
        <p className="text-sm text-muted">{loadError}</p>
        <Link href="/quizzes" className="inline-block rounded-lg bg-surface-hover px-4 py-2 text-sm font-semibold">
          {t("Back to quizzes")}
        </Link>
      </div>
    );
  }
  if (!def || !meta) return <div className="panel h-[60vh] animate-pulse rounded-2xl" />;

  const published = meta.status === "PUBLISHED";
  const unpublished = published && (meta.hasUnpublishedChanges || dirty);
  const errorsCount = validation.errors.length + shape.length;
  const tabs: { id: Tab; label: string }[] = [
    { id: "steps", label: t("Screens") },
    { id: "blocks", label: t("Blocks") },
    { id: "props", label: t("Properties") },
    { id: "preview", label: t("Preview") },
  ];
  const show = (id: Tab) => (tab === id ? "" : "hidden xl:block");

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="space-y-3">
        <Link href="/quizzes" className="inline-flex min-h-11 items-center text-sm text-muted hover:text-foreground">
          {t("← Quizzes")}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={name}
                maxLength={MAX_FUNNEL_NAME}
                onChange={(e) => setName(e.target.value)}
                aria-label={t("Quiz name")}
                className="min-h-11 min-w-0 max-w-full flex-1 rounded-lg border border-transparent bg-transparent px-1 text-lg font-semibold outline-none hover:border-border focus:border-border-hover sm:max-w-md"
              />
              <FunnelStatusChip status={meta.status} unpublished={unpublished} />
              {meta.publishedVersion > 0 && <span className="text-xs text-muted">{t("Version {v}", { v: meta.publishedVersion })}</span>}
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-1 text-sm text-muted">
              <label htmlFor="funnel-slug" className="shrink-0">
                /q/
              </label>
              <input
                id="funnel-slug"
                value={slug}
                maxLength={60}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                onBlur={() => setSlug((v) => (v ? v : savedSlug || slugify(name)))}
                aria-label={t("Quiz link")}
                className="min-h-9 w-56 max-w-full rounded-lg border border-border bg-background px-2 text-sm text-foreground outline-none focus:border-border-hover"
              />
              {published && (
                <>
                  <button type="button" onClick={() => void copyLink()} className="min-h-11 rounded-lg px-2 text-xs font-semibold text-accent hover:bg-surface-hover">
                    {copied ? t("Copied") : t("Copy link")}
                  </button>
                  <a href={`/q/${meta.slug}`} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center rounded-lg px-2 text-xs font-semibold text-accent hover:bg-surface-hover">
                    {t("Open page")}
                  </a>
                </>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted" aria-live="polite">
              {busy === "save" ? t("Saving…") : dirty ? t("Unsaved changes") : t("All changes saved")}
            </span>
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy !== null || !dirty}
              title={t("Ctrl/Cmd + S")}
              className="min-h-11 rounded-lg border border-border px-3 text-sm font-semibold hover:bg-surface-hover disabled:opacity-50"
            >
              {t("Save")}
            </button>
            <button type="button" onClick={() => setShowSettings(true)} className="min-h-11 rounded-lg border border-border px-3 text-sm font-semibold hover:bg-surface-hover">
              {t("Settings")}
            </button>
            <a
              href={`/q/${meta.slug}?preview=1`}
              target="_blank"
              rel="noopener"
              title={dirty ? t("Save to see your latest changes in the full screen preview.") : undefined}
              className="inline-flex min-h-11 items-center rounded-lg border border-border px-3 text-sm font-semibold hover:bg-surface-hover"
            >
              {t("Full screen preview")}
            </a>
            <Link href={`/quizzes/${meta.id}/results`} className="inline-flex min-h-11 items-center rounded-lg border border-border px-3 text-sm font-semibold hover:bg-surface-hover">
              {t("Results")}
            </Link>
            <button
              type="button"
              onClick={() => {
                setPublishError(null);
                setShowPublish(true);
              }}
              disabled={busy !== null}
              className="min-h-11 rounded-lg bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {published ? (unpublished ? t("Publish changes") : t("Published")) : t("Publish")}
              {errorsCount > 0 && <span className="ml-1.5 rounded-full bg-white/25 px-1.5 text-[11px]">{errorsCount}</span>}
            </button>
            {published ? (
              <>
                <button type="button" onClick={() => void unpublish(false)} disabled={busy !== null} className="min-h-11 rounded-lg px-3 text-sm font-semibold text-muted hover:bg-surface-hover disabled:opacity-50">
                  {t("Unpublish")}
                </button>
                <button type="button" onClick={() => void unpublish(true)} disabled={busy !== null} className="min-h-11 rounded-lg px-3 text-sm font-semibold text-muted hover:bg-surface-hover disabled:opacity-50">
                  {t("Archive")}
                </button>
              </>
            ) : (
              <button type="button" onClick={() => void remove()} disabled={busy !== null} className="min-h-11 rounded-lg px-3 text-sm font-semibold text-error hover:bg-error/10 disabled:opacity-50">
                {t("Delete")}
              </button>
            )}
          </div>
        </div>
      </div>

      {notice && (
        <div
          role="status"
          className={`flex items-start justify-between gap-3 rounded-xl px-4 py-2.5 text-sm ${
            notice.tone === "ok" ? "bg-success/10 text-[#2f6f0e]" : notice.tone === "warn" ? "bg-warning/10 text-[#8a560c]" : "bg-error/10 text-error"
          }`}
        >
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} className="min-h-6 shrink-0 text-xs font-semibold opacity-70 hover:opacity-100">
            {t("Close")}
          </button>
        </div>
      )}
      {unpublished && (
        <p className="rounded-xl bg-warning/10 px-4 py-2.5 text-sm text-[#8a560c]">
          {t("The live page shows the published version. Your changes only go live after Publish.")}
        </p>
      )}

      {/* Phone tabs */}
      <div className="sticky top-0 z-10 -mx-4 border-b border-border bg-background px-4 xl:hidden" role="tablist" aria-label={t("Editor sections")}>
        <div className="flex">
          {tabs.map((x) => (
            <button
              key={x.id}
              type="button"
              role="tab"
              aria-selected={tab === x.id}
              onClick={() => setTab(x.id)}
              className={`min-h-12 flex-1 border-b-2 px-1 text-sm font-semibold ${tab === x.id ? "border-foreground text-foreground" : "border-transparent text-muted"}`}
            >
              {x.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[260px_minmax(0,1fr)_340px] xl:items-start">
        <div className="min-w-0 space-y-4 xl:space-y-6">
          <section className={`panel rounded-2xl p-3 ${show("steps")}`} aria-label={t("Screens")}>
            <StepList def={def} selectedStepId={currentStepId} onSelect={(id) => selectStep(id)} setDef={setDef} counts={counts} />
          </section>
          <section className={`panel rounded-2xl p-3 ${show("blocks")}`} aria-label={t("Blocks")}>
            <BlockList def={def} stepId={currentStepId} selectedBlockId={currentBlockId} onSelect={selectBlock} setDef={setDef} counts={counts} />
          </section>
        </div>

        <section className={`panel min-w-0 rounded-2xl p-4 ${show("props")}`} aria-label={t("Properties")}>
          {errorsCount > 0 && (
            <button
              type="button"
              onClick={() => setShowPublish(true)}
              className="mb-4 flex min-h-11 w-full items-center justify-between gap-2 rounded-xl bg-error/10 px-3 text-left text-sm font-semibold text-error"
            >
              <span>{t("{n} things to fix before publishing", { n: errorsCount })}</span>
              <span className="text-xs">{t("See list")}</span>
            </button>
          )}
          <MediaUploadProvider value={mediaState}>
            <BlockPanel def={def} stepId={currentStepId} blockId={currentBlockId} setDef={setDef} issues={allIssues} onSelectBlock={setBlockId} />
          </MediaUploadProvider>
          {shapeTexts.length > 0 && (
            <ul className="mt-4 list-disc space-y-1 rounded-xl bg-error/10 py-2 pl-8 pr-3 text-xs text-error">
              {shapeTexts.slice(0, 6).map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          )}
        </section>

        <section className={`min-w-0 xl:sticky xl:top-4 ${show("preview")}`} aria-label={t("Preview")}>
          <PhonePreview
            def={def}
            id={meta.id}
            slug={slug || meta.slug}
            name={name || meta.name}
            stepId={currentStepId}
            onStepChange={(id) => selectStep(id, true)}
            onBlockClick={(id) => setBlockId(id)}
          />
        </section>
      </div>

      {showSettings && <SettingsPanel def={def} setDef={setDef} onClose={() => setShowSettings(false)} />}
      {showPublish && (
        <PublishDialog
          def={def}
          validation={validation}
          shapeErrors={shapeTexts}
          dirty={dirty}
          republish={published}
          busy={busy === "publish" || busy === "save"}
          error={publishError}
          onGo={goToIssue}
          onPublish={() => void publish()}
          onClose={() => setShowPublish(false)}
        />
      )}
    </div>
  );
}
