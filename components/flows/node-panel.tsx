"use client";

/**
 * Side panel of the flow builder: edits the selected step (or the trigger).
 *
 * Every link of the step has a "goes to" select, so the whole flow can be
 * built here without the canvas (that is the phone version). Picking
 * "+ New …" in a select creates the step and links it in one go.
 */

import { useState } from "react";
import KeywordInput from "@/components/keyword-input";
import PostPicker from "@/components/post-picker";
import { CollapsibleSection, SectionsProvider } from "@/components/ui/collapsible-section";
import { useT } from "@/components/lang-provider";
import type { TFunction } from "@/lib/i18n";
import {
  FLOW_TRIGGERS,
  MAX_BUTTON_LABEL,
  MAX_BUTTON_TEXT,
  MAX_FLOW_KEYWORDS,
  MAX_FLOW_TEXT,
  MAX_TAG,
  MAX_WAIT_MIN,
  NODE_TYPES,
  TRIGGER_NODE_ID,
  triggerIsComment,
  type ActionNode,
  type ConditionNode,
  type FlowDefinition,
  type FlowNode,
  type FlowNodeType,
  type FlowTrigger,
  type FlowTriggerType,
  type MessageNode,
  type WaitNode,
} from "@/lib/flows/schema";
import { isHttpsUrl, type FlowIssue } from "@/lib/flows/validate";
import {
  addNode,
  canAddButton,
  clampWaitMinutes,
  linkMessageNodes,
  linkOf,
  newButtonId,
  removeNode,
  setLink,
  updateNode,
  type HandleId,
} from "@/components/flows/flow-model";
import { NODE_TONE, NODE_TYPE_HINT, NODE_TYPE_LABEL, TRIGGER_TYPE_LABEL, issueText, nodeSummary } from "@/components/flows/flow-labels";

export type PanelContext = {
  accountId: string;
  tags: string[];
  conversationLinks: { id: string; code: string; origin: string; automation: { name: string; isActive: boolean } | null }[];
  stories: { id: string; thumb: string | null }[] | null;
};

export const inputClass =
  "w-full rounded-lg border border-border bg-surface-hover px-3 py-2 text-sm outline-none focus:border-border-hover disabled:opacity-60";

type SetDef = (update: (def: FlowDefinition) => FlowDefinition) => void;

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-semibold text-muted">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  );
}

function Check({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-[#0095f6]" />
      <span>{label}</span>
    </label>
  );
}

const NEW_PREFIX = "__new:";

/** "Goes to" select: an existing step, nothing, or a brand new step. */
export function TargetSelect({
  def,
  sourceId,
  handle,
  label,
  setDef,
  onCreated,
}: {
  def: FlowDefinition;
  sourceId: string;
  handle: HandleId;
  label: string;
  setDef: SetDef;
  onCreated?: (id: string) => void;
}) {
  const t = useT();
  const value = linkOf(def, sourceId, handle) ?? "";
  const missing = value && !def.nodes.some((n) => n.id === value);
  return (
    <Field label={label}>
      <select
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          if (v.startsWith(NEW_PREFIX)) {
            const type = v.slice(NEW_PREFIX.length) as FlowNodeType;
            const out = addNode(def, type, { sourceId, handle });
            setDef(() => out.def);
            onCreated?.(out.id);
            return;
          }
          setDef((d) => setLink(d, sourceId, handle, v || null));
        }}
        className={inputClass}
      >
        <option value="">{t("— Nothing (the flow ends) —")}</option>
        {missing && <option value={value}>{t("Missing step ({id})", { id: value })}</option>}
        {def.nodes
          .filter((n) => n.id !== sourceId || handle.startsWith("btn:"))
          .map((n) => (
            <option key={n.id} value={n.id}>
              {t(NODE_TYPE_LABEL[n.type])}: {nodeSummary(t, n)}
            </option>
          ))}
        <optgroup label={t("Create a new step")}>
          {NODE_TYPES.map((type) => (
            <option key={type} value={`${NEW_PREFIX}${type}`}>
              + {t(NODE_TYPE_LABEL[type])}
            </option>
          ))}
        </optgroup>
      </select>
    </Field>
  );
}

function Issues({ t, issues }: { t: TFunction; issues: FlowIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <ul className="space-y-1.5">
      {issues.map((i, n) => (
        <li
          key={n}
          className={`rounded-lg px-3 py-2 text-xs ${
            i.code === "follows_before_window" || i.code === "draft_before_window" || i.code === "message_text_and_buttons"
              ? "bg-warning/10 text-[#8a560c]"
              : "bg-error/10 text-error"
          }`}
        >
          {issueText(t, i)}
        </li>
      ))}
    </ul>
  );
}

// ── Trigger ──────────────────────────────────────────────────────────────────

function TriggerEditor({ def, setDef, ctx, onCreated }: { def: FlowDefinition; setDef: SetDef; ctx: PanelContext; onCreated: (id: string) => void }) {
  const t = useT();
  const trig = def.trigger;
  const [pickPost, setPickPost] = useState(!trig.postId && !trig.matchAnyPost);
  const [oneStory, setOneStory] = useState(Boolean(trig.storyId));
  const patch = (p: Partial<FlowTrigger>) => setDef((d) => ({ ...d, trigger: { ...d.trigger, ...p } }));
  const needsWords = trig.type !== "STORY_MENTION" && trig.type !== "CONVERSATION_LINK";
  const isCommentLike = trig.type === "COMMENT" || trig.type === "LIVE_COMMENT";

  return (
    <div className="space-y-4">
      <Field label={t("What starts the flow")}>
        <select value={trig.type} onChange={(e) => patch({ type: e.target.value as FlowTriggerType })} className={inputClass}>
          {FLOW_TRIGGERS.map((type) => (
            <option key={type} value={type}>
              {t(TRIGGER_TYPE_LABEL[type])}
            </option>
          ))}
        </select>
      </Field>

      {trig.type === "COMMENT" && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => patch({ matchAnyPost: false })}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold ${!trig.matchAnyPost ? "border-foreground" : "border-border text-muted"}`}
            >
              {t("One post")}
            </button>
            <button
              type="button"
              onClick={() => patch({ matchAnyPost: true })}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold ${trig.matchAnyPost ? "border-foreground" : "border-border text-muted"}`}
            >
              {t("Any post")}
            </button>
          </div>
          {!trig.matchAnyPost && (
            <div className="space-y-2">
              {trig.postId && (
                <p className="text-xs text-muted">
                  {t("Chosen post")}:{" "}
                  {trig.postUrl && isHttpsUrl(trig.postUrl) ? (
                    <a href={trig.postUrl} target="_blank" rel="noreferrer" className="font-semibold text-accent">
                      {t("open")}
                    </a>
                  ) : (
                    <span className="font-mono">{trig.postId}</span>
                  )}
                  {" · "}
                  <button type="button" className="font-semibold text-accent" onClick={() => setPickPost((v) => !v)}>
                    {pickPost ? t("Hide posts") : t("Change")}
                  </button>
                </p>
              )}
              {(pickPost || !trig.postId) && ctx.accountId && (
                <div className="max-h-80 overflow-y-auto rounded-lg border border-border p-2">
                  <PostPicker
                    selectedPostId={trig.postId ?? null}
                    instagramAccountId={ctx.accountId}
                    onSelect={(postId, postUrl) => {
                      patch({ postId, postUrl: postUrl ?? null });
                      setPickPost(false);
                    }}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {trig.type === "STORY_REPLY" && (
        <div className="space-y-2">
          <Check
            checked={!oneStory}
            onChange={(any) => {
              setOneStory(!any);
              if (any) patch({ storyId: null });
            }}
            label={t("Any of my stories")}
          />
          {oneStory && (
            <div className="flex flex-wrap gap-2">
              {ctx.stories === null && <p className="text-xs text-muted">{t("Loading…")}</p>}
              {ctx.stories?.length === 0 && <p className="text-xs text-muted">{t("No story up right now.")}</p>}
              {ctx.stories?.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => patch({ storyId: s.id })}
                  aria-pressed={trig.storyId === s.id}
                  className={`h-20 w-12 overflow-hidden rounded-lg border-2 ${trig.storyId === s.id ? "border-accent" : "border-transparent"}`}
                >
                  {s.thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.thumb} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="grid h-full w-full place-items-center bg-surface-hover text-[10px]">{t("Story")}</span>
                  )}
                </button>
              ))}
              {!trig.storyId && ctx.stories && ctx.stories.length > 0 && (
                <p className="w-full text-xs text-muted">{t("Tap the story. Until you pick one, any story counts.")}</p>
              )}
            </div>
          )}
        </div>
      )}

      {trig.type === "CONVERSATION_LINK" && (
        <Field label={t("Conversation link")} hint={t("Only links without an active campaign reach the flow.")}>
          <select value={trig.conversationLinkId ?? ""} onChange={(e) => patch({ conversationLinkId: e.target.value || null })} className={inputClass}>
            <option value="">{t("Choose a link")}</option>
            {ctx.conversationLinks.map((l) => (
              <option key={l.id} value={l.id}>
                {l.code} · {l.origin}
                {l.automation?.isActive ? ` · ${t("campaign on: {name}", { name: l.automation.name })}` : ""}
              </option>
            ))}
          </select>
        </Field>
      )}

      {needsWords && (
        <CollapsibleSection
          id="fluxo-palavras"
          variant="group"
          hideFromIndex
          title={isCommentLike ? t("And the comment has") : t("And the message has")}
          summary={trig.matchAnyWord ? t("Any word") : trig.keywords.join(", ") || t("No word yet")}
          badge={trig.matchAnyWord ? null : { text: String(trig.keywords.length) }}
        >
          <Check checked={trig.matchAnyWord} onChange={(v) => patch({ matchAnyWord: v })} label={t("Any word")} />
          {!trig.matchAnyWord && (
            <>
              <KeywordInput keywords={trig.keywords} onChange={(keywords) => patch({ keywords })} max={MAX_FLOW_KEYWORDS} />
              <Check checked={trig.wholeWordMatch} onChange={(v) => patch({ wholeWordMatch: v })} label={t("Whole word only")} />
            </>
          )}
        </CollapsibleSection>
      )}

      {triggerIsComment(trig.type) && (
        <p className="rounded-lg bg-surface-hover px-3 py-2 text-xs text-muted">
          {t("The first message answers the comment in private. After it, Instagram only lets the flow write again once the person taps a button or replies.")}
        </p>
      )}

      <TargetSelect def={def} sourceId={TRIGGER_NODE_ID} handle="next" label={t("First step")} setDef={setDef} onCreated={onCreated} />
    </div>
  );
}

// ── Message ──────────────────────────────────────────────────────────────────

function MessageEditor({ def, node, setDef, onCreated }: { def: FlowDefinition; node: MessageNode; setDef: SetDef; onCreated: (id: string) => void }) {
  const t = useT();
  const patch = (fn: (n: MessageNode) => MessageNode) =>
    setDef((d) => updateNode(d, node.id, (n) => (n.type === "message" ? fn(n) : n)));
  const max = node.buttons.length > 0 ? MAX_BUTTON_TEXT : MAX_FLOW_TEXT;
  const hasTapButton = node.buttons.some((b) => b.kind === "next");

  function insertVar(v: string) {
    patch((n) => ({ ...n, text: `${n.text}${n.text && !n.text.endsWith(" ") ? " " : ""}${v}`.slice(0, MAX_FLOW_TEXT) }));
  }

  return (
    <div className="space-y-4">
      <Field label={t("Text")}>
        <textarea
          value={node.text}
          maxLength={MAX_FLOW_TEXT}
          rows={5}
          onChange={(e) => patch((n) => ({ ...n, text: e.target.value }))}
          placeholder={t("Hi {first_name}! Here is what you asked for…")}
          className={`${inputClass} resize-y`}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted">{t("Insert")}:</span>
        <button type="button" onClick={() => insertVar("{first_name}")} className="rounded-full bg-surface-hover px-2.5 py-1 font-semibold">
          {"{first_name}"}
        </button>
        <button type="button" onClick={() => insertVar("{username}")} className="rounded-full bg-surface-hover px-2.5 py-1 font-semibold">
          {"{username}"}
        </button>
        <span className={`ml-auto ${node.text.length > max ? "text-error" : "text-muted"}`}>
          {node.text.length}/{max}
        </span>
      </div>

      <CollapsibleSection
        id="fluxo-imagem"
        variant="group"
        hideFromIndex
        defaultOpen={Boolean(node.imageUrl)}
        title={t("Image (optional)")}
        summary={node.imageUrl ? node.imageUrl : t("No image")}
      >
        <Field label={t("Image (optional)")} hint={t("An https:// link to a JPG or PNG. It goes before the text.")}>
          <input
            value={node.imageUrl ?? ""}
            onChange={(e) => patch((n) => ({ ...n, imageUrl: e.target.value.trim() || null }))}
            placeholder="https://"
            inputMode="url"
            className={inputClass}
          />
        </Field>
      </CollapsibleSection>

      <CollapsibleSection
        id="fluxo-botoes"
        variant="group"
        hideFromIndex
        title={t("Buttons (up to 3)")}
        badge={{ text: String(node.buttons.length) }}
        summary={node.buttons.map((b) => b.label || t("No text")).join(" · ") || t("No button")}
      >
        {node.buttons.map((b, i) => (
          <div key={b.id} className="space-y-2 rounded-xl border border-border p-3">
            <div className="flex items-center gap-2">
              <select
                value={b.kind}
                onChange={(e) =>
                  patch((n) => ({
                    ...n,
                    buttons: n.buttons.map((x) =>
                      x.id !== b.id
                        ? x
                        : e.target.value === "link"
                          ? { id: x.id, kind: "link", label: x.label, url: "" }
                          : { id: x.id, kind: "next", label: x.label, next: null }
                    ),
                  }))
                }
                className={`${inputClass} flex-1`}
              >
                <option value="next">{t("Goes to another step")}</option>
                <option value="link">{t("Opens a link (tracked)")}</option>
              </select>
              <button
                type="button"
                aria-label={t("Remove button")}
                onClick={() => patch((n) => ({ ...n, buttons: n.buttons.filter((x) => x.id !== b.id) }))}
                className="shrink-0 rounded-lg px-2 py-2 text-sm text-error hover:bg-error/10"
              >
                {t("Remove")}
              </button>
            </div>
            <input
              value={b.label}
              maxLength={MAX_BUTTON_LABEL}
              onChange={(e) =>
                patch((n) => ({ ...n, buttons: n.buttons.map((x) => (x.id === b.id ? { ...x, label: e.target.value } : x)) }))
              }
              placeholder={t("Button {n} text", { n: i + 1 })}
              className={inputClass}
            />
            {b.kind === "link" ? (
              <input
                value={b.url}
                onChange={(e) =>
                  patch((n) => ({
                    ...n,
                    buttons: n.buttons.map((x) => (x.id === b.id && x.kind === "link" ? { ...x, url: e.target.value.trim() } : x)),
                  }))
                }
                placeholder="https://"
                inputMode="url"
                className={inputClass}
              />
            ) : (
              <TargetSelect def={def} sourceId={node.id} handle={`btn:${b.id}`} label={t("When tapped, goes to")} setDef={setDef} onCreated={onCreated} />
            )}
          </div>
        ))}
        {canAddButton(node) && (
          <button
            type="button"
            onClick={() =>
              patch((n) => ({ ...n, buttons: [...n.buttons, { id: newButtonId(n), kind: "next", label: "", next: null }] }))
            }
            className="w-full rounded-lg border border-dashed border-border px-3 py-2 text-sm font-semibold text-accent hover:bg-surface-hover"
          >
            + {t("Add button")}
          </button>
        )}
      </CollapsibleSection>

      {hasTapButton ? (
        <p className="rounded-lg bg-surface-hover px-3 py-2 text-xs text-muted">
          {t("This message waits for the person to tap a button. Each button decides where the flow goes.")}
        </p>
      ) : (
        <TargetSelect def={def} sourceId={node.id} handle="next" label={t("Then goes to")} setDef={setDef} onCreated={onCreated} />
      )}
    </div>
  );
}

// ── Condition ────────────────────────────────────────────────────────────────

function ConditionEditor({ def, node, setDef, ctx, onCreated }: { def: FlowDefinition; node: ConditionNode; setDef: SetDef; ctx: PanelContext; onCreated: (id: string) => void }) {
  const t = useT();
  const patch = (fn: (n: ConditionNode) => ConditionNode) =>
    setDef((d) => updateNode(d, node.id, (n) => (n.type === "condition" ? fn(n) : n)));
  const linkNodes = linkMessageNodes(def);
  return (
    <div className="space-y-4">
      <Field label={t("Check")}>
        <select
          value={node.check.kind}
          onChange={(e) => {
            const kind = e.target.value;
            patch((n) => ({
              ...n,
              check: kind === "has_tag" ? { kind: "has_tag", tag: "" } : kind === "clicked" ? { kind: "clicked", nodeId: null } : { kind: "follows" },
            }));
          }}
          className={inputClass}
        >
          <option value="follows">{t("Follows the account?")}</option>
          <option value="has_tag">{t("Has a tag?")}</option>
          <option value="clicked">{t("Clicked the link?")}</option>
        </select>
      </Field>
      {node.check.kind === "has_tag" && (
        <Field label={t("Tag")}>
          <input
            list="flow-tags"
            value={node.check.tag}
            maxLength={MAX_TAG}
            onChange={(e) => patch((n) => ({ ...n, check: { kind: "has_tag", tag: e.target.value } }))}
            className={inputClass}
          />
          <datalist id="flow-tags">
            {ctx.tags.map((tag) => (
              <option key={tag} value={tag} />
            ))}
          </datalist>
        </Field>
      )}
      {node.check.kind === "clicked" && (
        <Field label={t("Which link")}>
          <select
            value={node.check.nodeId ?? ""}
            onChange={(e) => patch((n) => ({ ...n, check: { kind: "clicked", nodeId: e.target.value || null } }))}
            className={inputClass}
          >
            <option value="">{t("Any link of this flow")}</option>
            {linkNodes.map((n) => (
              <option key={n.id} value={n.id}>
                {t("Links of: {summary}", { summary: nodeSummary(t, n) })}
              </option>
            ))}
          </select>
        </Field>
      )}
      <TargetSelect def={def} sourceId={node.id} handle="yes" label={t("If yes, goes to")} setDef={setDef} onCreated={onCreated} />
      <TargetSelect def={def} sourceId={node.id} handle="no" label={t("If no, goes to")} setDef={setDef} onCreated={onCreated} />
    </div>
  );
}

// ── Action ───────────────────────────────────────────────────────────────────

function ActionEditor({ def, node, setDef, ctx, onCreated }: { def: FlowDefinition; node: ActionNode; setDef: SetDef; ctx: PanelContext; onCreated: (id: string) => void }) {
  const t = useT();
  const set = (action: ActionNode["action"]) =>
    setDef((d) => updateNode(d, node.id, (n) => (n.type === "action" ? { ...n, action } : n)));
  const a = node.action;
  return (
    <div className="space-y-4">
      <Field label={t("What to do")}>
        <select
          value={a.kind}
          onChange={(e) => {
            const kind = e.target.value;
            set(
              kind === "remove_tag"
                ? { kind: "remove_tag", tag: "tag" in a ? a.tag : "" }
                : kind === "notify_owner"
                  ? { kind: "notify_owner", note: null }
                  : kind === "propose_draft"
                    ? { kind: "propose_draft", text: "", reason: null }
                    : kind === "handoff"
                      ? { kind: "handoff", hours: null }
                      : { kind: "add_tag", tag: "tag" in a ? a.tag : "" }
            );
          }}
          className={inputClass}
        >
          <option value="add_tag">{t("Add a tag")}</option>
          <option value="remove_tag">{t("Remove a tag")}</option>
          <option value="notify_owner">{t("Notify the owner")}</option>
          <option value="propose_draft">{t("Propose a draft for approval")}</option>
          <option value="handoff">{t("Hand over to a human")}</option>
        </select>
      </Field>
      {(a.kind === "add_tag" || a.kind === "remove_tag") && (
        <Field label={t("Tag")} hint={t("Same tags as Contacts.")}>
          <input list="flow-tags-action" value={a.tag} maxLength={MAX_TAG} onChange={(e) => set({ ...a, tag: e.target.value })} className={inputClass} />
          <datalist id="flow-tags-action">
            {ctx.tags.map((tag) => (
              <option key={tag} value={tag} />
            ))}
          </datalist>
        </Field>
      )}
      {a.kind === "notify_owner" && (
        <Field label={t("Note (optional)")} hint={t("Shows up in the owner's notifications.")}>
          <input value={a.note ?? ""} maxLength={500} onChange={(e) => set({ ...a, note: e.target.value || null })} className={inputClass} />
        </Field>
      )}
      {a.kind === "propose_draft" && (
        <>
          <Field label={t("Draft text")}>
            <textarea value={a.text} maxLength={MAX_FLOW_TEXT} rows={4} onChange={(e) => set({ ...a, text: e.target.value })} className={`${inputClass} resize-y`} />
          </Field>
          <Field label={t("Why (optional)")}>
            <input value={a.reason ?? ""} maxLength={500} onChange={(e) => set({ ...a, reason: e.target.value || null })} className={inputClass} />
          </Field>
          <p className="rounded-lg bg-surface-hover px-3 py-2 text-xs text-muted">
            {t("The draft goes to Approvals. Nothing is sent until a person approves it.")}
          </p>
        </>
      )}
      {a.kind === "handoff" && (
        <>
          <Field label={t("For how many hours (empty = until released)")}>
            <input
              type="number"
              min={1}
              max={168}
              value={a.hours ?? ""}
              onChange={(e) => set({ ...a, hours: e.target.value ? Math.min(168, Math.max(1, Number(e.target.value) || 1)) : null })}
              className={inputClass}
            />
          </Field>
          <p className="rounded-lg bg-surface-hover px-3 py-2 text-xs text-muted">
            {t("The robot stops talking to this person and the conversation waits for you in the Inbox.")}
          </p>
        </>
      )}
      <TargetSelect def={def} sourceId={node.id} handle="next" label={t("Then goes to")} setDef={setDef} onCreated={onCreated} />
    </div>
  );
}

// ── Wait ─────────────────────────────────────────────────────────────────────

function DurationInput({ minutes, onChange }: { minutes: number; onChange: (m: number) => void }) {
  const t = useT();
  const inHours = minutes >= 60 && minutes % 60 === 0;
  const [unit, setUnit] = useState<"min" | "h">(inHours ? "h" : "min");
  const shown = unit === "h" ? Math.round((minutes / 60) * 10) / 10 : minutes;
  return (
    <div className="flex gap-2">
      <input
        type="number"
        min={1}
        step={unit === "h" ? 0.5 : 1}
        max={unit === "h" ? MAX_WAIT_MIN / 60 : MAX_WAIT_MIN}
        value={shown}
        onChange={(e) => onChange(clampWaitMinutes((Number(e.target.value) || 1) * (unit === "h" ? 60 : 1)))}
        className={`${inputClass} flex-1`}
      />
      <select value={unit} onChange={(e) => setUnit(e.target.value as "min" | "h")} className={`${inputClass} w-28`}>
        <option value="min">{t("minutes")}</option>
        <option value="h">{t("hours")}</option>
      </select>
    </div>
  );
}

function WaitEditor({ def, node, setDef, onCreated }: { def: FlowDefinition; node: WaitNode; setDef: SetDef; onCreated: (id: string) => void }) {
  const t = useT();
  const replace = (next: WaitNode) => setDef((d) => updateNode(d, node.id, () => next));
  return (
    <div className="space-y-4">
      <Field label={t("Wait for")}>
        <select
          value={node.mode}
          onChange={(e) =>
            replace(
              e.target.value === "reply"
                ? { id: node.id, type: "wait", mode: "reply", position: node.position, timeoutMinutes: null, next: node.next ?? null, onTimeout: null }
                : { id: node.id, type: "wait", mode: "delay", position: node.position, minutes: 10, next: node.next ?? null }
            )
          }
          className={inputClass}
        >
          <option value="delay">{t("Some time")}</option>
          <option value="reply">{t("The person's reply")}</option>
        </select>
      </Field>
      {node.mode === "delay" ? (
        <>
          <Field label={t("How long")} hint={t("Up to 23 hours: Instagram closes the conversation after 24 h without a message from the person.")}>
            <DurationInput minutes={node.minutes} onChange={(minutes) => replace({ ...node, minutes })} />
          </Field>
          <TargetSelect def={def} sourceId={node.id} handle="next" label={t("Then goes to")} setDef={setDef} onCreated={onCreated} />
        </>
      ) : (
        <>
          <Field label={t("Give up after")} hint={t("Empty = 23 hours.")}>
            <DurationInput minutes={node.timeoutMinutes ?? MAX_WAIT_MIN} onChange={(m) => replace({ ...node, timeoutMinutes: m })} />
          </Field>
          <p className="rounded-lg bg-surface-hover px-3 py-2 text-xs text-muted">{t("Only a text reply counts (a photo alone does not).")}</p>
          <TargetSelect def={def} sourceId={node.id} handle="next" label={t("When they reply, goes to")} setDef={setDef} onCreated={onCreated} />
          <TargetSelect def={def} sourceId={node.id} handle="timeout" label={t("If nobody replies, goes to")} setDef={setDef} onCreated={onCreated} />
        </>
      )}
    </div>
  );
}

// ── Panel ────────────────────────────────────────────────────────────────────

export default function NodePanel({
  def,
  nodeId,
  setDef,
  ctx,
  issues,
  readOnlyNote,
  onSelect,
  onAdd,
}: {
  def: FlowDefinition;
  nodeId: string | null;
  setDef: SetDef;
  ctx: PanelContext;
  issues: FlowIssue[];
  readOnlyNote?: string | null;
  onSelect: (id: string | null) => void;
  onAdd: (type: FlowNodeType) => void;
}) {
  const t = useT();
  const node: FlowNode | undefined = nodeId ? def.nodes.find((n) => n.id === nodeId) : undefined;
  const isTrigger = nodeId === TRIGGER_NODE_ID;
  const own = issues.filter((i) => i.nodeId === nodeId);

  if (!isTrigger && !node) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted">{t("Tap a step on the canvas to edit it, or add a new one.")}</p>
        <div className="grid grid-cols-1 gap-2">
          {NODE_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => onAdd(type)}
              className="flex items-center gap-3 rounded-xl border border-border px-3 py-2.5 text-left hover:bg-surface-hover"
            >
              <span className={`h-3 w-3 shrink-0 rounded-full ${NODE_TONE[type]}`} />
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{t(NODE_TYPE_LABEL[type])}</span>
                <span className="block text-xs text-muted">{t(NODE_TYPE_HINT[type])}</span>
              </span>
            </button>
          ))}
        </div>
        <button type="button" onClick={() => onSelect(TRIGGER_NODE_ID)} className="text-sm font-semibold text-accent">
          {t("Edit the trigger")}
        </button>
      </div>
    );
  }

  const kind = isTrigger ? "trigger" : node!.type;
  return (
    <SectionsProvider page="fluxo-painel">
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className={`h-3 w-3 rounded-full ${NODE_TONE[kind]}`} />
        <h3 className="flex-1 text-sm font-semibold">{t(NODE_TYPE_LABEL[kind])}</h3>
        {!isTrigger && <span className="font-mono text-[11px] text-muted">{node!.id}</span>}
      </div>
      {readOnlyNote && <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-[#8a560c]">{readOnlyNote}</p>}
      <Issues t={t} issues={own} />
      {isTrigger && <TriggerEditor def={def} setDef={setDef} ctx={ctx} onCreated={onSelect} />}
      {node?.type === "message" && <MessageEditor def={def} node={node} setDef={setDef} onCreated={onSelect} />}
      {node?.type === "condition" && <ConditionEditor def={def} node={node} setDef={setDef} ctx={ctx} onCreated={onSelect} />}
      {node?.type === "action" && <ActionEditor def={def} node={node} setDef={setDef} ctx={ctx} onCreated={onSelect} />}
      {node?.type === "wait" && <WaitEditor def={def} node={node} setDef={setDef} onCreated={onSelect} />}
      {node?.type === "end" && <p className="text-sm text-muted">{t("The flow ends here for this person.")}</p>}
      {!isTrigger && node && (
        <button
          type="button"
          onClick={() => {
            if (!window.confirm(t("Delete this step? Links that pointed to it are removed."))) return;
            setDef((d) => removeNode(d, node.id));
            onSelect(null);
          }}
          className="w-full rounded-lg border border-error/30 px-3 py-2 text-sm font-semibold text-error hover:bg-error/10"
        >
          {t("Delete step")}
        </button>
      )}
    </div>
    </SectionsProvider>
  );
}
