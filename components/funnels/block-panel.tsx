"use client";

/* eslint-disable @next/next/no-img-element -- previews of images the owner pasted (any https host) */

/**
 * Etapa 6 (Quiz): properties of the selected block (one form per type), or
 * of the screen when no block is selected. Destinations are picked from the
 * screens; video and image links are checked live with the same functions
 * the server uses; testimonials and before/after ask for the owner's
 * confirmation that the result is real and authorized.
 */

import { useState } from "react";
import { useT } from "@/components/lang-provider";
import { isAllowedImageUrl, isPlaceholderUrl, parseVideoUrl } from "@/lib/funnels/media";
import { MediaUploadControl, useMediaUpload } from "@/components/funnels/media-upload";
import type {
  ButtonAction,
  CompareSide,
  FunnelBlock,
  FunnelDefinition,
  FunnelIssue,
  FunnelOption,
  LeadField,
  ScoreRoute,
} from "@/lib/funnels/types";
import { BLOCK_TYPE_LABEL, issueText } from "@/components/funnels/funnel-labels";
import { MAX_OPTIONS_PER_BLOCK, PLACEHOLDER_IMAGE, PLACEHOLDER_VIDEO, newOption, updateBlock, updateStep } from "@/components/funnels/editor-model";
import {
  CheckField,
  IconButton,
  Icons,
  MoneyField,
  NumberField,
  SelectField,
  StringListField,
  TextField,
} from "@/components/funnels/form-controls";
import { formatCents } from "@/components/funnels/blocks/offer";

type SetDef = (update: (d: FunnelDefinition) => FunnelDefinition) => void;

const RICH_HINT = "Use **bold**, *italic* and start a line with - for a list. {resposta.name} shows an answer.";

/** ISO with offset -> value of <input type="datetime-local"> in the browser's time zone. */
function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToIso(value: string): string | null {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export default function BlockPanel({
  def,
  stepId,
  blockId,
  setDef,
  issues,
  onSelectBlock,
}: {
  def: FunnelDefinition;
  stepId: string;
  blockId: string | null;
  setDef: SetDef;
  issues: FunnelIssue[];
  onSelectBlock: (id: string | null) => void;
}) {
  const t = useT();
  const step = def.steps.find((s) => s.id === stepId);
  const block = step?.blocks.find((b) => b.id === blockId) ?? null;
  if (!step) return <p className="text-sm text-muted">{t("Pick a screen on the left.")}</p>;

  const stepOptions = def.steps.map((s, i) => ({ value: s.id, label: `${i + 1}. ${s.title || t("Untitled screen")}` }));
  const myIssues = issues.filter((i) => i.stepId === stepId && (block ? i.blockId === block.id : !i.blockId));

  const IssueList = myIssues.length > 0 && (
    <ul className="space-y-1.5">
      {myIssues.map((issue, i) => (
        <li
          key={i}
          className={`rounded-lg px-3 py-2 text-xs ${issue.level === "error" ? "bg-error/10 text-error" : "bg-warning/10 text-[#8a560c]"}`}
        >
          {issueText(t, issue)}
        </li>
      ))}
    </ul>
  );

  if (!block) {
    const header = step.header ?? {};
    const setHeader = (patch: Partial<typeof header>) => setDef((d) => updateStep(d, stepId, { header: { ...header, ...patch } }));
    return (
      <div className="space-y-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">{t("Screen")}</p>
          <p className="text-sm text-muted">{t("Pick a block in the list to edit it, or change the screen here.")}</p>
        </div>
        {IssueList}
        <TextField
          label={t("Screen name (only you see it)")}
          value={step.title}
          maxLength={120}
          onChange={(v) => setDef((d) => updateStep(d, stepId, { title: v }))}
          hint={t("Shows in Results, in the destinations and in the list of screens.")}
        />
        <fieldset className="space-y-1">
          <legend className="mb-1 text-xs font-semibold">{t("Top of the screen")}</legend>
          <CheckField label={t("Back button")} checked={Boolean(header.showBack)} onChange={(v) => setHeader({ showBack: v })} />
          <CheckField label={t("Progress bar")} checked={Boolean(header.showProgress)} onChange={(v) => setHeader({ showProgress: v })} />
          <CheckField
            label={t("Logo")}
            hint={t("Uses the logo link from Settings.")}
            checked={Boolean(header.showLogo)}
            onChange={(v) => setHeader({ showLogo: v })}
          />
        </fieldset>
      </div>
    );
  }

  const set = (patch: Record<string, unknown>) => setDef((d) => updateBlock(d, stepId, block.id, patch));

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">{t(BLOCK_TYPE_LABEL[block.type])}</p>
          <p className="text-sm text-muted">{t("Changes show in the preview right away. Save to keep them.")}</p>
        </div>
        <button type="button" onClick={() => onSelectBlock(null)} className="min-h-11 shrink-0 rounded-lg px-2 text-xs font-semibold text-accent hover:bg-surface-hover">
          {t("Screen settings")}
        </button>
      </div>
      {IssueList}
      <BlockFields key={block.id} block={block} set={set} stepOptions={stepOptions} />
      <NumberField
        label={t("Appears after (seconds)")}
        value={block.delaySec}
        min={0}
        max={600}
        placeholder="0"
        onChange={(v) => set({ delaySec: v || undefined })}
        hint={t("Ex.: the buy button shows up only after a part of the video. 0 = right away.")}
      />
    </div>
  );
}

function BlockFields({
  block,
  set,
  stepOptions,
}: {
  block: FunnelBlock;
  set: (patch: Record<string, unknown>) => void;
  stepOptions: { value: string; label: string }[];
}) {
  const t = useT();
  const alignOptions = [
    { value: "center" as const, label: t("Centered") },
    { value: "left" as const, label: t("Left") },
  ];

  switch (block.type) {
    case "heading":
      return (
        <>
          <TextField label={t("Text")} value={block.text} multiline rows={2} maxLength={2000} onChange={(v) => set({ text: v })} hint={t("{resposta.name} shows an answer.")} />
          <SelectField
            label={t("Size")}
            value={String(block.level ?? 1) as "1" | "2"}
            onChange={(v) => set({ level: v === "2" ? 2 : 1 })}
            options={[
              { value: "1", label: t("Main title") },
              { value: "2", label: t("Subtitle") },
            ]}
          />
          <SelectField label={t("Alignment")} value={block.align ?? "center"} onChange={(v) => set({ align: v })} options={alignOptions} />
        </>
      );

    case "text":
      return (
        <>
          <TextField label={t("Text")} value={block.text} multiline rows={5} maxLength={2000} onChange={(v) => set({ text: v })} hint={t(RICH_HINT)} />
          <SelectField
            label={t("Size")}
            value={block.size ?? "md"}
            onChange={(v) => set({ size: v })}
            options={[
              { value: "sm", label: t("Small") },
              { value: "md", label: t("Medium") },
              { value: "lg", label: t("Large") },
            ]}
          />
          <SelectField label={t("Alignment")} value={block.align ?? "center"} onChange={(v) => set({ align: v })} options={alignOptions} />
        </>
      );

    case "image":
      return (
        <>
          <ImageUrlField label={t("Image or GIF link")} value={block.url} onChange={(v) => set({ url: v })} required />
          <TextField
            label={t("Description for screen readers")}
            value={block.alt}
            maxLength={120}
            onChange={(v) => set({ alt: v })}
            hint={t("Say what the image shows. Leave empty only if it is decorative.")}
          />
          <div className="grid grid-cols-2 gap-3">
            <NumberField label={t("Width (px)")} value={block.width} min={1} max={4000} onChange={(v) => set({ width: v })} />
            <NumberField label={t("Height (px)")} value={block.height} min={1} max={4000} onChange={(v) => set({ height: v })} />
          </div>
          <p className="text-xs text-muted">{t("Width and height of the original image keep the page from jumping while it loads.")}</p>
          <CheckField label={t("Rounded corners")} checked={block.rounded !== false} onChange={(v) => set({ rounded: v })} />
        </>
      );

    case "video": {
      const parsed = parseVideoUrl(block.url);
      return (
        <>
          <VideoUrlField value={block.url} onChange={(v) => set({ url: v })} />
          {parsed && (
            <p className="text-xs text-muted">
              {parsed.provider === "file"
                ? t("Recognized: your own video file")
                : t("Recognized: {provider}", { provider: parsed.provider === "youtube" ? "YouTube" : parsed.provider === "vimeo" ? "Vimeo" : "Panda Video" })}
            </p>
          )}
          {parsed?.provider === "file" && (
            <>
              <CheckField
                label={t("Start by itself without sound (tap to turn on the sound)")}
                hint={t("Like a VSL: the video starts muted and shows a button to turn on the sound, which plays it from the start.")}
                checked={block.autoplay === true}
                onChange={(v) => set({ autoplay: v || undefined })}
              />
              <ImageUrlField label={t("Cover image (optional)")} value={block.posterUrl ?? ""} onChange={(v) => set({ posterUrl: v || undefined })} />
            </>
          )}
          <TextField
            label={t("Video title (for screen readers)")}
            value={block.title}
            maxLength={120}
            onChange={(v) => set({ title: v })}
            hint={t("Ex.: Video: how the Chat Sem Frescura works.")}
          />
          <CheckField label={t("Vertical video (9:16)")} checked={Boolean(block.vertical)} onChange={(v) => set({ vertical: v })} />
          <p className="text-xs text-muted">{t("The video only loads on its own screen and never starts with sound by itself.")}</p>
        </>
      );
    }

    case "button":
      return <ButtonFields block={block} set={set} stepOptions={stepOptions} />;

    case "options":
      return <OptionsFields block={block} set={set} stepOptions={stepOptions} />;

    case "field":
      return (
        <>
          <SelectField<LeadField>
            label={t("What it asks")}
            value={block.field}
            onChange={(v) => set({ field: v })}
            options={[
              { value: "name", label: t("Name") },
              { value: "email", label: t("Email") },
              { value: "whatsapp", label: t("WhatsApp") },
            ]}
          />
          <TextField label={t("Label")} value={block.label} maxLength={120} onChange={(v) => set({ label: v })} />
          <TextField label={t("Example inside the field")} value={block.placeholder ?? ""} maxLength={120} onChange={(v) => set({ placeholder: v || undefined })} />
          <CheckField label={t("Required")} checked={block.required !== false} onChange={(v) => set({ required: v })} />
          <p className="rounded-lg bg-surface-hover px-3 py-2 text-xs text-muted">
            {t("A screen with data fields always shows the consent box with the privacy policy link (Settings). Only ask what you will use.")}
          </p>
        </>
      );

    case "compare": {
      const side = (key: "before" | "after", s: CompareSide, title: string) => (
        <fieldset className="space-y-3 rounded-xl border border-border p-3">
          <legend className="px-1 text-xs font-semibold">{title}</legend>
          <TextField label={t("Title")} value={s.title} maxLength={120} onChange={(v) => set({ [key]: { ...s, title: v } })} />
          <ImageUrlField label={t("Image (optional)")} value={s.imageUrl ?? ""} onChange={(v) => set({ [key]: { ...s, imageUrl: v || undefined } })} />
          <StringListField label={t("Items")} items={s.items} addLabel={t("Item")} onChange={(v) => set({ [key]: { ...s, items: v } })} />
        </fieldset>
      );
      return (
        <>
          {side("before", block.before, t("Before"))}
          {side("after", block.after, t("After"))}
          <AuthorizedBox checked={Boolean(block.authorized)} onChange={(v) => set({ authorized: v })} />
        </>
      );
    }

    case "testimonial":
      return (
        <>
          <TextField label={t("Testimonial")} value={block.quote} multiline rows={4} maxLength={2000} onChange={(v) => set({ quote: v })} />
          <TextField label={t("Name")} value={block.author} maxLength={120} onChange={(v) => set({ author: v })} />
          <TextField label={t("Who the person is (optional)")} value={block.role ?? ""} maxLength={120} onChange={(v) => set({ role: v || undefined })} />
          <ImageUrlField label={t("Photo (optional)")} value={block.imageUrl ?? ""} onChange={(v) => set({ imageUrl: v || undefined })} />
          <AuthorizedBox checked={block.authorized} onChange={(v) => set({ authorized: v })} />
        </>
      );

    case "checklist":
      return (
        <>
          <TextField label={t("Title (optional)")} value={block.title ?? ""} maxLength={120} onChange={(v) => set({ title: v || undefined })} />
          <StringListField label={t("Items")} items={block.items} addLabel={t("Item")} onChange={(v) => set({ items: v })} />
        </>
      );

    case "countdown":
      return (
        <>
          <TextField label={t("Text above the countdown")} value={block.label} maxLength={120} onChange={(v) => set({ label: v })} />
          <TextField
            label={t("Real deadline (date and time)")}
            type="datetime-local"
            value={isoToLocalInput(block.deadline)}
            onChange={(v) => {
              const iso = localInputToIso(v);
              if (iso) set({ deadline: iso });
            }}
            hint={t("Only a real deadline. When it passes, the block disappears. There is no timer per visit.")}
          />
        </>
      );

    case "loading":
      return <LoadingFields block={block} set={set} stepOptions={stepOptions} />;

    case "offer":
      return (
        <>
          <TextField label={t("Title (optional)")} value={block.title ?? ""} maxLength={120} onChange={(v) => set({ title: v || undefined })} />
          <MoneyField label={t("Price")} cents={block.priceCents} onChange={(v) => set({ priceCents: v })} hint={t("Empty = the quiz cannot be published yet.")} />
          <MoneyField
            label={t("Full price \"from\" (optional)")}
            cents={block.compareAtCents ?? null}
            onChange={(v) => set({ compareAtCents: v })}
            hint={t("Only use it if this full price is real.")}
            error={
              block.compareAtCents != null && block.priceCents != null && block.compareAtCents <= block.priceCents
                ? t("The \"from\" price must be higher than {price}.", { price: formatCents(block.priceCents) })
                : null
            }
          />
          <TextField
            label={t("Installments (optional)")}
            value={block.installmentsText ?? ""}
            maxLength={120}
            placeholder={t("ex.: or 12x of R$ 9,74")}
            onChange={(v) => set({ installmentsText: v || undefined })}
          />
          <StringListField label={t("Bonuses (only real ones)")} items={block.bonuses ?? []} addLabel={t("Bonus")} onChange={(v) => set({ bonuses: v })} />
          <NumberField
            label={t("Guarantee (days)")}
            value={block.guaranteeDays}
            min={0}
            max={365}
            onChange={(v) => set({ guaranteeDays: v ?? null })}
          />
          <TextField
            label={t("Guarantee text (optional)")}
            value={block.guaranteeText ?? ""}
            multiline
            rows={2}
            maxLength={500}
            onChange={(v) => set({ guaranteeText: v || undefined })}
          />
          <TextField
            label={t("Deadline line (optional)")}
            value={block.deadlineText ?? ""}
            maxLength={120}
            onChange={(v) => set({ deadlineText: v || undefined })}
            hint={t("Only a real deadline. Empty = nothing shows.")}
          />
        </>
      );

    case "gallery":
      return (
        <fieldset className="space-y-3">
          <legend className="mb-1 text-xs font-semibold">{t("Images")}</legend>
          {block.images.map((img, i) => (
            <div key={i} className="space-y-2 rounded-xl border border-border p-3">
              <ImageUrlField
                label={t("Image {n}", { n: i + 1 })}
                value={img.url}
                required
                onChange={(v) => set({ images: block.images.map((x, j) => (j === i ? { ...x, url: v } : x)) })}
              />
              <TextField
                label={t("Description")}
                value={img.alt}
                maxLength={120}
                onChange={(v) => set({ images: block.images.map((x, j) => (j === i ? { ...x, alt: v } : x)) })}
              />
              <button
                type="button"
                onClick={() => set({ images: block.images.filter((_, j) => j !== i) })}
                className="min-h-11 rounded-lg px-2 text-xs font-semibold text-error hover:bg-error/10"
              >
                {t("Remove image")}
              </button>
            </div>
          ))}
          {block.images.length < 20 && (
            <button
              type="button"
              onClick={() => set({ images: [...block.images, { url: PLACEHOLDER_IMAGE, alt: "" }] })}
              className="min-h-11 rounded-lg px-2 text-sm font-semibold text-accent hover:bg-surface-hover"
            >
              + {t("Image")}
            </button>
          )}
        </fieldset>
      );

    case "faq":
      return (
        <fieldset className="space-y-3">
          <legend className="mb-1 text-xs font-semibold">{t("Questions and answers")}</legend>
          {block.items.map((item, i) => (
            <div key={i} className="space-y-2 rounded-xl border border-border p-3">
              <TextField
                label={t("Question {n}", { n: i + 1 })}
                value={item.q}
                maxLength={300}
                onChange={(v) => set({ items: block.items.map((x, j) => (j === i ? { ...x, q: v } : x)) })}
              />
              <TextField
                label={t("Answer")}
                value={item.a}
                multiline
                rows={3}
                maxLength={2000}
                onChange={(v) => set({ items: block.items.map((x, j) => (j === i ? { ...x, a: v } : x)) })}
              />
              <button
                type="button"
                onClick={() => set({ items: block.items.filter((_, j) => j !== i) })}
                className="min-h-11 rounded-lg px-2 text-xs font-semibold text-error hover:bg-error/10"
              >
                {t("Remove question")}
              </button>
            </div>
          ))}
          {block.items.length < 20 && (
            <button
              type="button"
              onClick={() => set({ items: [...block.items, { q: "", a: "" }] })}
              className="min-h-11 rounded-lg px-2 text-sm font-semibold text-accent hover:bg-surface-hover"
            >
              + {t("Question")}
            </button>
          )}
        </fieldset>
      );

    case "spacer":
      return (
        <SelectField
          label={t("Size")}
          value={block.size}
          onChange={(v) => set({ size: v })}
          options={[
            { value: "sm", label: t("Small") },
            { value: "md", label: t("Medium") },
            { value: "lg", label: t("Large") },
          ]}
        />
      );
  }
}

function AuthorizedBox({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  const t = useT();
  return (
    <div className={`rounded-xl px-3 py-1 ${checked ? "bg-success/10" : "bg-warning/10"}`}>
      <CheckField
        label={t("I have permission and the result is real")}
        hint={t("Without this the block does not show on the live page and the quiz cannot be published.")}
        checked={checked}
        onChange={onChange}
      />
    </div>
  );
}

/**
 * Link field that only hands valid links to the definition (the zod refuses
 * the rest). What the owner types stays in the field, with the error under
 * it, until it becomes valid; a change from outside (another block, undo)
 * resets it.
 */
function LinkInput({
  label,
  value,
  shown,
  accept,
  onValid,
  placeholder,
  hint,
  error,
}: {
  label: string;
  value: string;
  shown: string;
  /** Typed text -> value to store, or null when it is not valid yet. */
  accept: (text: string) => string | null;
  onValid: (v: string) => void;
  placeholder: string;
  hint?: React.ReactNode;
  error: string;
}) {
  const [local, setLocal] = useState({ text: shown, synced: value });
  let text = local.text;
  if (local.synced !== value) {
    text = shown;
    setLocal({ text: shown, synced: value });
  }
  const bad = accept(text) === null;
  return (
    <TextField
      label={label}
      value={text}
      type="url"
      inputMode="url"
      placeholder={placeholder}
      onChange={(v) => {
        const out = accept(v);
        if (out === null) {
          setLocal((s) => ({ ...s, text: v }));
          return;
        }
        setLocal({ text: v, synced: out });
        if (out !== value) onValid(out);
      }}
      hint={hint}
      error={bad ? error : null}
    />
  );
}

function ImageUrlField({ label, value, onChange, required = false }: { label: string; value: string; onChange: (v: string) => void; required?: boolean }) {
  const t = useT();
  const { uploader } = useMediaUpload();
  const placeholder = Boolean(value.trim()) && isPlaceholderUrl(value);
  const real = Boolean(value.trim()) && !placeholder && isAllowedImageUrl(value.trim());
  return (
    <div className="space-y-2">
      <LinkInput
        label={label}
        value={value}
        shown={placeholder ? "" : value}
        accept={(v) => {
          const x = v.trim();
          if (!x) return required ? PLACEHOLDER_IMAGE : "";
          return isAllowedImageUrl(x) ? x : null;
        }}
        onValid={onChange}
        placeholder="https://"
        hint={placeholder ? t("Paste the link of your image (it shows a gray box until then).") : undefined}
        error={t("Use a link that starts with https://")}
      />
      {real && <img src={value} alt="" aria-hidden="true" className="max-h-28 rounded-lg border border-border object-contain" loading="lazy" />}
      {uploader ? (
        <MediaUploadControl kind="image" onUploaded={onChange} />
      ) : (
        <p className="text-xs text-muted">{t("File upload comes later; for now paste the image link.")}</p>
      )}
    </div>
  );
}

function VideoUrlField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useT();
  const { uploader } = useMediaUpload();
  const parsed = parseVideoUrl(value);
  const placeholder = parsed?.id === "XXXXXXXXXXX";
  return (
    <div className="space-y-2">
      <LinkInput
        label={t("Video link")}
        value={value}
        shown={placeholder ? "" : value}
        accept={(v) => {
          const x = v.trim();
          if (!x) return PLACEHOLDER_VIDEO;
          return parseVideoUrl(x) ? x : null;
        }}
        onValid={onChange}
        placeholder="https://www.youtube.com/watch?v=..."
        hint={
          placeholder
            ? t("Paste the video link. Use YouTube (unlisted works too), Vimeo or Panda Video.")
            : t("Use YouTube (unlisted works too), Vimeo or Panda Video.")
        }
        error={t("This link is not from YouTube, Vimeo or Panda Video. Paste the link of the video page or the embed link.")}
      />
      {parsed?.provider === "file" && (
        <video src={parsed.embedUrl} preload="metadata" muted playsInline controls className="max-h-40 w-full rounded-lg border border-border bg-black" />
      )}
      {uploader && <MediaUploadControl kind="video" onUploaded={onChange} />}
    </div>
  );
}

function ButtonFields({
  block,
  set,
  stepOptions,
}: {
  block: Extract<FunnelBlock, { type: "button" }>;
  set: (patch: Record<string, unknown>) => void;
  stepOptions: { value: string; label: string }[];
}) {
  const t = useT();
  const action = block.action;
  const setAction = (a: ButtonAction) => set({ action: a });
  return (
    <>
      <TextField label={t("Button text")} value={block.label} maxLength={120} onChange={(v) => set({ label: v })} hint={t("Say exactly what happens, like \"Quero o Chat Sem Frescura\".")} />
      <SelectField
        label={t("When tapped")}
        value={action.kind}
        onChange={(kind) =>
          setAction(kind === "goto" ? { kind, stepId: stepOptions[0]?.value ?? "" } : kind === "checkout" ? { kind } : { kind: "next" })
        }
        options={[
          { value: "next", label: t("Go to the next screen") },
          { value: "goto", label: t("Go to a specific screen") },
          { value: "checkout", label: t("Open the checkout") },
        ]}
      />
      {action.kind === "goto" && (
        <SelectField label={t("Screen")} value={action.stepId} onChange={(v) => setAction({ kind: "goto", stepId: v })} options={stepOptions} />
      )}
      {action.kind === "checkout" && (
        <>
          <TextField
            label={t("Checkout link (optional)")}
            value={action.url ?? ""}
            type="url"
            inputMode="url"
            placeholder="https://pay.hotmart.com/..."
            onChange={(v) => setAction({ ...action, url: v.trim() || undefined })}
            error={action.url && !/^https:\/\//i.test(action.url) ? t("Use a link that starts with https://") : null}
            hint={t("Empty = uses the default checkout from Settings. The entry UTMs go along by themselves.")}
          />
          <CheckField label={t("Open in a new tab")} checked={Boolean(action.newTab)} onChange={(v) => setAction({ ...action, newTab: v || undefined })} />
        </>
      )}
      <SelectField
        label={t("Style")}
        value={block.style ?? "primary"}
        onChange={(v) => set({ style: v })}
        options={[
          { value: "primary", label: t("Main (filled)") },
          { value: "secondary", label: t("Secondary (outline)") },
        ]}
      />
      <CheckField label={t("Pulse gently")} checked={Boolean(block.pulse)} onChange={(v) => set({ pulse: v || undefined })} hint={t("Off for people who asked for less motion.")} />
      <CheckField label={t("Fixed at the bottom of the screen")} checked={Boolean(block.sticky)} onChange={(v) => set({ sticky: v || undefined })} />
    </>
  );
}

function OptionsFields({
  block,
  set,
  stepOptions,
}: {
  block: Extract<FunnelBlock, { type: "options" }>;
  set: (patch: Record<string, unknown>) => void;
  stepOptions: { value: string; label: string }[];
}) {
  const t = useT();
  const setOption = (i: number, patch: Partial<FunnelOption>) =>
    set({
      options: block.options.map((o, j) => {
        if (j !== i) return o;
        const next: FunnelOption = { ...o, ...patch };
        for (const k of Object.keys(next) as (keyof FunnelOption)[]) if (next[k] === undefined || next[k] === "") delete next[k];
        next.id = o.id;
        next.label = patch.label ?? o.label;
        return next;
      }),
    });
  const swap = (i: number, j: number) => {
    const out = block.options.slice();
    [out[i], out[j]] = [out[j], out[i]];
    set({ options: out });
  };
  const nameOk = /^[a-z0-9_-]{1,40}$/.test(block.name);

  return (
    <>
      <TextField label={t("Question")} value={block.question ?? ""} maxLength={120} onChange={(v) => set({ question: v || undefined })} />
      <TextField
        label={t("Answer name")}
        value={block.name}
        maxLength={40}
        onChange={(v) => set({ name: v.toLowerCase().replace(/[^a-z0-9_-]/g, "") || block.name })}
        hint={t("Used in {resposta.name} and as a column of the leads file. Lowercase letters, numbers, - and _.")}
        error={nameOk ? null : t("Use only a-z, 0-9, - and _.")}
      />
      <CheckField
        label={t("Several answers allowed")}
        checked={block.multiple}
        onChange={(v) => set({ multiple: v })}
        hint={block.multiple ? t("Shows a Continue button.") : t("A single tap moves on by itself.")}
      />
      <CheckField label={t("Answer required")} checked={block.required !== false} onChange={(v) => set({ required: v })} />
      {block.multiple && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <NumberField label={t("At least")} value={block.minChoices} min={0} max={MAX_OPTIONS_PER_BLOCK} placeholder="1" onChange={(v) => set({ minChoices: v })} />
            <NumberField label={t("At most")} value={block.maxChoices} min={1} max={MAX_OPTIONS_PER_BLOCK} onChange={(v) => set({ maxChoices: v })} />
          </div>
          <TextField
            label={t("Continue button text")}
            value={block.continueLabel ?? ""}
            maxLength={120}
            placeholder={t("Continue")}
            onChange={(v) => set({ continueLabel: v || undefined })}
          />
        </>
      )}
      <SelectField
        label={t("Layout")}
        value={block.layout ?? "list"}
        onChange={(v) => set({ layout: v })}
        options={[
          { value: "list", label: t("List") },
          { value: "grid", label: t("Grid (2 columns, good with images)") },
        ]}
      />
      <SelectField
        label={t("Option image size")}
        value={block.imageSize ?? "photo"}
        onChange={(v) => set({ imageSize: v === "photo" ? undefined : v })}
        options={[
          { value: "photo", label: t("Large photo (on top of the text)") },
          { value: "icon", label: t("Small icon (next to the text)") },
        ]}
      />

      <fieldset className="space-y-3">
        <legend className="mb-1 text-xs font-semibold">{t("Options")}</legend>
        {block.options.map((o, i) => (
          <div key={o.id} className="space-y-2 rounded-xl border border-border p-3">
            <div className="flex items-end gap-1">
              <div className="w-16 shrink-0">
                <TextField label={t("Emoji")} value={o.emoji ?? ""} maxLength={16} onChange={(v) => setOption(i, { emoji: v || undefined })} />
              </div>
              <div className="min-w-0 flex-1">
                <TextField label={t("Option {n}", { n: i + 1 })} value={o.label} maxLength={120} onChange={(v) => setOption(i, { label: v })} />
              </div>
            </div>
            <ImageUrlField label={t("Image (optional)")} value={o.imageUrl ?? ""} onChange={(v) => setOption(i, { imageUrl: v || undefined })} />
            <div className="grid grid-cols-2 gap-3">
              <TextField
                label={t("Tag (optional)")}
                value={o.tag ?? ""}
                maxLength={60}
                placeholder="quiz:nivel-zero"
                onChange={(v) => setOption(i, { tag: v || undefined })}
              />
              <NumberField label={t("Points")} value={o.score} min={-100} max={100} placeholder="0" onChange={(v) => setOption(i, { score: v })} />
            </div>
            {!block.multiple && (
              <SelectField
                label={t("Goes to")}
                value={o.goto ?? ""}
                onChange={(v) => setOption(i, { goto: v || undefined })}
                options={[{ value: "", label: t("Next screen") }, ...stepOptions]}
              />
            )}
            <div className="flex justify-end gap-1">
              <IconButton label={t("Move up")} onClick={() => swap(i, i - 1)} disabled={i === 0}>
                {Icons.up}
              </IconButton>
              <IconButton label={t("Move down")} onClick={() => swap(i, i + 1)} disabled={i === block.options.length - 1}>
                {Icons.down}
              </IconButton>
              <IconButton label={t("Remove option")} tone="danger" onClick={() => set({ options: block.options.filter((_, j) => j !== i) })}>
                {Icons.remove}
              </IconButton>
            </div>
          </div>
        ))}
        {block.options.length < MAX_OPTIONS_PER_BLOCK && (
          <button
            type="button"
            onClick={() => set({ options: [...block.options, newOption(block.options.length + 1)] })}
            className="min-h-11 rounded-lg px-2 text-sm font-semibold text-accent hover:bg-surface-hover"
          >
            + {t("Option")}
          </button>
        )}
        <p className="text-xs text-muted">{t("The tag goes to the contact in the CRM when the person came from a Direct link. Points are added up by the Loading block to pick the result.")}</p>
      </fieldset>
    </>
  );
}

function LoadingFields({
  block,
  set,
  stepOptions,
}: {
  block: Extract<FunnelBlock, { type: "loading" }>;
  set: (patch: Record<string, unknown>) => void;
  stepOptions: { value: string; label: string }[];
}) {
  const t = useT();
  const routes = block.routes ?? [];
  const setRoute = (i: number, patch: Partial<ScoreRoute>) =>
    set({
      routes: routes.map((r, j) => {
        if (j !== i) return r;
        const next = { ...r, ...patch };
        if (next.min === undefined) delete next.min;
        if (next.max === undefined) delete next.max;
        return next;
      }),
    });
  return (
    <>
      <TextField
        label={t("Text")}
        value={block.text}
        maxLength={120}
        onChange={(v) => set({ text: v })}
        hint={t("Be honest: \"from your answers\". Never say an AI analyzed something it did not.")}
      />
      <NumberField label={t("Duration (seconds, 1 to 8)")} value={block.durationSec ?? 3} min={1} max={8} onChange={(v) => set({ durationSec: v ?? 3 })} />
      <fieldset className="space-y-3">
        <legend className="mb-1 text-xs font-semibold">{t("Result by points")}</legend>
        <p className="text-xs text-muted">{t("Adds up the points of the chosen options. The first range that matches decides the screen. None = next screen.")}</p>
        {routes.map((r, i) => (
          <div key={i} className="space-y-2 rounded-xl border border-border p-3">
            <div className="grid grid-cols-2 gap-3">
              <NumberField label={t("From (points)")} value={r.min} min={-10000} max={10000} placeholder={t("any")} onChange={(v) => setRoute(i, { min: v })} />
              <NumberField label={t("To (points)")} value={r.max} min={-10000} max={10000} placeholder={t("any")} onChange={(v) => setRoute(i, { max: v })} />
            </div>
            <SelectField label={t("Goes to")} value={r.stepId} onChange={(v) => setRoute(i, { stepId: v })} options={stepOptions} />
            <button
              type="button"
              onClick={() => set({ routes: routes.filter((_, j) => j !== i) })}
              className="min-h-11 rounded-lg px-2 text-xs font-semibold text-error hover:bg-error/10"
            >
              {t("Remove range")}
            </button>
          </div>
        ))}
        {routes.length < 10 && stepOptions.length > 0 && (
          <button
            type="button"
            onClick={() => set({ routes: [...routes, { min: 0, stepId: stepOptions[stepOptions.length - 1].value }] })}
            className="min-h-11 rounded-lg px-2 text-sm font-semibold text-accent hover:bg-surface-hover"
          >
            + {t("Range")}
          </button>
        )}
      </fieldset>
    </>
  );
}

