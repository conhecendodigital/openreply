"use client";

/**
 * Pop-ups of the quiz (pedido do Matheus, 14/10): list, add, remove and edit
 * each pop-up (story text, image, main button, "Quero sair mesmo" button) and
 * when it opens by itself (leaving the page, N seconds on a screen). A button
 * block with "Open a pop-up" opens it any time.
 */

import { useT } from "@/components/lang-provider";
import { MAX_LABEL, MAX_POPUPS, MAX_TEXT } from "@/lib/funnels/schema";
import { isAllowedImageUrl, isHttpsUrl } from "@/lib/funnels/media";
import type { FunnelDefinition, FunnelPopup, PopupAction, PopupButton } from "@/lib/funnels/types";
import { addPopup, removePopup, updatePopup } from "@/components/funnels/editor-model";
import { MediaUploadControl } from "@/components/funnels/media-upload";
import { CheckField, FieldShell, IconButton, Icons, NumberField, SelectField, TextField } from "@/components/funnels/form-controls";

type SetDef = (update: (d: FunnelDefinition) => FunnelDefinition) => void;
type StepOption = { value: string; label: string };

function ActionFields({
  action,
  onChange,
  stepOptions,
}: {
  action: PopupAction;
  onChange: (a: PopupAction) => void;
  stepOptions: StepOption[];
}) {
  const t = useT();
  return (
    <>
      <SelectField
        label={t("When tapped")}
        value={action.kind}
        onChange={(kind) =>
          onChange(
            kind === "goto" ? { kind, stepId: stepOptions[0]?.value ?? "" } : kind === "checkout" ? { kind } : kind === "next" ? { kind } : { kind: "close" },
          )
        }
        options={[
          { value: "close", label: t("Close the pop-up (stay on the screen)") },
          { value: "next", label: t("Go to the next screen") },
          { value: "goto", label: t("Go to a specific screen") },
          { value: "checkout", label: t("Open the checkout") },
        ]}
      />
      {action.kind === "goto" && (
        <SelectField label={t("Screen")} value={action.stepId} onChange={(v) => onChange({ kind: "goto", stepId: v })} options={stepOptions} />
      )}
      {action.kind === "checkout" && (
        <>
          <TextField
            label={t("Checkout link (optional)")}
            value={action.url ?? ""}
            type="url"
            placeholder="https://pay.hotmart.com/..."
            onChange={(v) => onChange({ ...action, url: v.trim() || undefined })}
            error={action.url && !isHttpsUrl(action.url) ? t("Use a link that starts with https://") : null}
            hint={t("Empty = uses the default checkout link of the quiz.")}
          />
          <CheckField label={t("Open in a new tab")} checked={Boolean(action.newTab)} onChange={(v) => onChange({ ...action, newTab: v || undefined })} />
        </>
      )}
    </>
  );
}

function PopupCard({
  popup,
  index,
  setDef,
  stepOptions,
}: {
  popup: FunnelPopup;
  index: number;
  setDef: SetDef;
  stepOptions: StepOption[];
}) {
  const t = useT();
  const set = (patch: Partial<Omit<FunnelPopup, "id">>) => setDef((d) => updatePopup(d, popup.id, patch));
  const setPrimary = (patch: Partial<PopupButton>) => set({ primary: { ...popup.primary, ...patch } });
  const secondary = popup.secondary;
  const setSecondary = (patch: Partial<NonNullable<FunnelPopup["secondary"]>>) =>
    secondary && set({ secondary: { ...secondary, ...patch } });
  const trigger = popup.trigger ?? {};
  const setTrigger = (patch: Partial<NonNullable<FunnelPopup["trigger"]>>) => {
    const next = { ...trigger, ...patch };
    if (!next.exit) delete next.exit;
    if (!next.afterSec) delete next.afterSec;
    if (!next.stepIds?.length) delete next.stepIds;
    set({ trigger: Object.keys(next).length ? next : undefined });
  };
  const onSteps = new Set(trigger.stepIds ?? []);
  const imageBad = Boolean(popup.imageUrl) && !isAllowedImageUrl(popup.imageUrl ?? "");

  return (
    <div className="space-y-3 rounded-xl border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">{t("Pop-up {n}", { n: index + 1 })}</p>
        <IconButton label={t("Remove pop-up")} tone="danger" onClick={() => setDef((d) => removePopup(d, popup.id))}>
          {Icons.remove}
        </IconButton>
      </div>
      <TextField label={t("Title")} value={popup.title} maxLength={MAX_LABEL} onChange={(v) => set({ title: v })} />
      <TextField
        label={t("Text")}
        value={popup.text ?? ""}
        multiline
        rows={4}
        maxLength={MAX_TEXT}
        onChange={(v) => set({ text: v || undefined })}
        hint={t("Tell the story: what the person loses if they leave now and what they get if they stay. Short sentences.")}
      />
      <TextField
        label={t("Image (optional)")}
        value={popup.imageUrl ?? ""}
        type="url"
        placeholder="https://"
        onChange={(v) => set({ imageUrl: v.trim() || undefined })}
        error={imageBad ? t("Use a link that starts with https://") : null}
      />
      <MediaUploadControl kind="image" onUploaded={(url) => set({ imageUrl: url })} />

      <FieldShell label={t("Main button")}>
        <div className="space-y-3 rounded-lg bg-surface-hover/40 p-3">
          <TextField label={t("Button text")} value={popup.primary.label} maxLength={MAX_LABEL} onChange={(v) => setPrimary({ label: v })} />
          <ActionFields action={popup.primary.action} onChange={(a) => setPrimary({ action: a })} stepOptions={stepOptions} />
        </div>
      </FieldShell>

      <CheckField
        label={t("Second button (\"Quero sair mesmo\")")}
        hint={t("A smaller link under the main button. Without it the person closes on the × or outside.")}
        checked={Boolean(secondary)}
        onChange={(v) =>
          set({ secondary: v ? { label: "Quero sair mesmo", action: { kind: "close" }, delaySec: 3 } : undefined })
        }
      />
      {secondary && (
        <div className="space-y-3 rounded-lg bg-surface-hover/40 p-3">
          <TextField label={t("Button text")} value={secondary.label} maxLength={MAX_LABEL} onChange={(v) => setSecondary({ label: v })} />
          <ActionFields action={secondary.action} onChange={(a) => setSecondary({ action: a })} stepOptions={stepOptions} />
          <NumberField
            label={t("Appears after (seconds)")}
            value={secondary.delaySec}
            min={0}
            max={15}
            placeholder="0"
            onChange={(v) => setSecondary({ delaySec: v || undefined })}
            hint={t("Gives time to read the story before the way out shows up. 0 = right away.")}
          />
        </div>
      )}

      <FieldShell label={t("Opens by itself")}>
        <div className="space-y-2 rounded-lg bg-surface-hover/40 p-3">
          <CheckField
            label={t("When the person tries to leave")}
            hint={t("Computer: mouse going to close the tab. Phone: the back button. Once per visit.")}
            checked={Boolean(trigger.exit)}
            onChange={(v) => setTrigger({ exit: v })}
          />
          <NumberField
            label={t("After seconds on the screen (optional)")}
            value={trigger.afterSec}
            min={1}
            max={600}
            placeholder={t("off")}
            onChange={(v) => setTrigger({ afterSec: v })}
            hint={t("Opens once if the person stays that long on the same screen.")}
          />
          <p className="pt-1 text-xs font-semibold">{t("On which screens")}</p>
          <p className="text-xs text-muted">{t("None marked = all screens.")}</p>
          <div className="max-h-48 space-y-0.5 overflow-y-auto">
            {stepOptions.map((o) => (
              <CheckField
                key={o.value}
                label={o.label}
                checked={onSteps.has(o.value)}
                onChange={(v) => {
                  const ids = new Set(onSteps);
                  if (v) ids.add(o.value);
                  else ids.delete(o.value);
                  setTrigger({ stepIds: stepOptions.map((s) => s.value).filter((id) => ids.has(id)) });
                }}
              />
            ))}
          </div>
        </div>
      </FieldShell>
    </div>
  );
}

export default function PopupsEditor({ def, setDef }: { def: FunnelDefinition; setDef: SetDef }) {
  const t = useT();
  const popups = def.settings.popups ?? [];
  const stepOptions = def.steps.map((s, i) => ({ value: s.id, label: `${i + 1}. ${s.title || t("Untitled screen")}` }));
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        {t("A pop-up holds the person before they leave: tell the story and give one clear next step. Open it with a button (\"When tapped\": Open a pop-up) or let it open by itself.")}
      </p>
      {popups.map((p, i) => (
        <PopupCard key={p.id} popup={p} index={i} setDef={setDef} stepOptions={stepOptions} />
      ))}
      <button
        type="button"
        disabled={popups.length >= MAX_POPUPS}
        onClick={() => setDef((d) => addPopup(d).def)}
        className="min-h-11 w-full rounded-lg border border-dashed border-border px-3 text-sm font-semibold text-accent hover:bg-surface-hover disabled:opacity-40"
      >
        {popups.length >= MAX_POPUPS ? t("Limit of {n} pop-ups", { n: MAX_POPUPS }) : t("+ Add pop-up")}
      </button>
    </div>
  );
}
