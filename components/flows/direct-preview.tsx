"use client";

/**
 * Direct preview of a flow (Instagram DM look): walks the flow from the
 * trigger like a person would. Buttons are tappable, conditions ask which
 * way to go and "wait for reply" lets you type the reply. Nothing is sent:
 * it only reads the draft on the screen.
 */

import { useMemo, useState } from "react";
import { useT } from "@/components/lang-provider";
import type { TFunction } from "@/lib/i18n";
import { renderFlowText } from "@/lib/flows/render";
import { isHttpsUrl } from "@/lib/flows/validate";
import { MAX_RUN_STEPS, triggerIsComment, type FlowDefinition, type FlowNode } from "@/lib/flows/schema";
import { minutesText, nodeSummary } from "@/components/flows/flow-labels";

const SAMPLE = { username: "maria.silva", name: "Maria Silva" };

type Choice = { nodeId: string; value: string };

type Bubble =
  | { kind: "in"; text: string; note?: string }
  | { kind: "out"; nodeId: string; text: string; image: string | null; buttons: { id: string; label: string; link: boolean; url?: string }[] }
  | { kind: "system"; text: string; nodeId?: string };

type Pause =
  | { kind: "tap"; nodeId: string }
  | { kind: "condition"; nodeId: string; question: string }
  | { kind: "reply"; nodeId: string }
  | { kind: "end"; text: string };

/** Walk the flow with the choices made so far (pure: the preview re-runs it). */
function walkFlow(def: FlowDefinition, choices: Choice[], sampleIn: { text: string; note?: string }, t: TFunction): { bubbles: Bubble[]; pause: Pause } {
  const out: Bubble[] = [{ kind: "in", ...sampleIn }];
  const byId = new Map<string, FlowNode>(def.nodes.map((n) => [n.id, n]));
  const answers = [...choices];
  let current: string | null | undefined = def.trigger.next;
  let firstMessage = true;
  for (let steps = 0; steps < MAX_RUN_STEPS; steps++) {
    if (!current) return { bubbles: out, pause: { kind: "end", text: t("End of the flow") } as Pause };
    const node = byId.get(current);
    if (!node) return { bubbles: out, pause: { kind: "end", text: t("Missing step ({id})", { id: current }) } as Pause };
    const take = () => (answers[0]?.nodeId === node.id ? answers.shift()!.value : null);
    switch (node.type) {
      case "message": {
        out.push({
          kind: "out",
          nodeId: node.id,
          text: renderFlowText(node.text, SAMPLE) || t("(no text yet)"),
          image: firstMessage && triggerIsComment(def.trigger.type) ? null : node.imageUrl || null,
          buttons: node.buttons.map((b) => ({ id: b.id, label: b.label, link: b.kind === "link", url: b.kind === "link" ? b.url : undefined })),
        });
        firstMessage = false;
        if (node.buttons.some((b) => b.kind === "next")) {
          const tapped = take();
          if (!tapped) return { bubbles: out, pause: { kind: "tap", nodeId: node.id } as Pause };
          const button = node.buttons.find((b) => b.id === tapped);
          out.push({ kind: "in", text: button?.label || "…" });
          current = button && button.kind === "next" ? button.next : null;
        } else {
          current = node.next;
        }
        break;
      }
      case "condition": {
        const answer = take();
        if (!answer) return { bubbles: out, pause: { kind: "condition", nodeId: node.id, question: nodeSummary(t, node) } as Pause };
        out.push({ kind: "system", nodeId: node.id, text: `${nodeSummary(t, node)} ${answer === "yes" ? t("Yes") : t("No")}` });
        current = answer === "yes" ? node.yes : node.no;
        break;
      }
      case "action":
        out.push({ kind: "system", nodeId: node.id, text: nodeSummary(t, node) });
        current = node.action.kind === "handoff" ? null : node.next;
        if (node.action.kind === "handoff") return { bubbles: out, pause: { kind: "end", text: t("A human takes it from here") } as Pause };
        break;
      case "wait":
        if (node.mode === "delay") {
          out.push({ kind: "system", nodeId: node.id, text: t("{time} later", { time: minutesText(t, node.minutes) }) });
          current = node.next;
        } else {
          const answer = take();
          if (answer === null) return { bubbles: out, pause: { kind: "reply", nodeId: node.id } as Pause };
          if (answer === "\u0000timeout") {
            out.push({ kind: "system", nodeId: node.id, text: t("No reply in time") });
            current = node.onTimeout;
          } else {
            out.push({ kind: "in", text: answer });
            current = node.next;
          }
        }
        break;
      case "end":
        return { bubbles: out, pause: { kind: "end", text: t("End of the flow") } as Pause };
    }
  }
  return { bubbles: out, pause: { kind: "end", text: t("Stopped: too many steps") } as Pause };
}

export default function DirectPreview({
  def,
  username,
  onSelect,
}: {
  def: FlowDefinition;
  username: string | null;
  onSelect?: (id: string) => void;
}) {
  const t = useT();
  const [choices, setChoices] = useState<Choice[]>([]);
  const [reply, setReply] = useState("");

  const sampleIn = useMemo(() => {
    const word = def.trigger.matchAnyWord ? t("I want it!") : def.trigger.keywords[0] ?? t("I want it!");
    switch (def.trigger.type) {
      case "COMMENT":
      case "LIVE_COMMENT":
        return { text: word, note: def.trigger.type === "LIVE_COMMENT" ? t("Commented on your live") : t("Commented on your post") };
      case "STORY_REPLY":
        return { text: word, note: t("Replied to your story") };
      case "STORY_MENTION":
        return { text: t("@{username} in my story", { username: username ?? "voce" }), note: t("Mentioned you in their story") };
      case "CONVERSATION_LINK":
        return { text: t("Hi!"), note: t("Opened your conversation link") };
      default:
        return { text: word };
    }
  }, [def.trigger, t, username]);

  const { bubbles, pause } = useMemo(() => walkFlow(def, choices, sampleIn, t), [def, choices, sampleIn, t]);

  const choose = (nodeId: string, value: string) => setChoices((c) => [...c, { nodeId, value }]);

  return (
    <div className="mx-auto w-full max-w-[340px] overflow-hidden rounded-[28px] border-[6px] border-zinc-900 bg-black text-white">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2.5">
        <span className="ig-gradient grid h-7 w-7 place-items-center rounded-full text-[11px] font-bold">
          {(username ?? "?").slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{username ?? t("your account")}</p>
          <p className="text-[11px] text-zinc-400">{t("Preview · nothing is sent")}</p>
        </div>
      </div>

      <div className="max-h-[520px] min-h-[360px] space-y-2.5 overflow-y-auto px-3 py-4">
        {bubbles.map((b, i) => {
          if (b.kind === "in") {
            return (
              <div key={i} className="flex flex-col items-end gap-1">
                {b.note && <p className="text-[10px] text-zinc-500">{b.note}</p>}
                <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent px-3 py-2 text-sm">{b.text}</div>
              </div>
            );
          }
          if (b.kind === "system") {
            return (
              <button
                key={i}
                type="button"
                onClick={() => b.nodeId && onSelect?.(b.nodeId)}
                className="block w-full py-0.5 text-center text-[11px] text-zinc-500 hover:text-zinc-300"
              >
                {b.text}
              </button>
            );
          }
          const waitingTap = pause.kind === "tap" && pause.nodeId === b.nodeId && i === bubbles.length - 1;
          return (
            <div key={i} className="flex items-end gap-2">
              <span className="ig-gradient h-6 w-6 shrink-0 rounded-full" />
              <div className="max-w-[80%] overflow-hidden rounded-2xl rounded-bl-md bg-zinc-800">
                {b.image && isHttpsUrl(b.image) && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={b.image} alt="" className="max-h-48 w-full object-cover" />
                )}
                <button type="button" onClick={() => onSelect?.(b.nodeId)} className="block w-full whitespace-pre-wrap px-3 py-2 text-left text-sm">
                  {b.text}
                </button>
                {b.buttons.map((btn) =>
                  btn.link ? (
                    <a
                      key={btn.id}
                      // Draft content (an API key can write it): only https links open.
                      href={isHttpsUrl(btn.url) ? btn.url : undefined}
                      target="_blank"
                      rel="noreferrer"
                      className="mx-1.5 mb-1.5 block rounded-xl bg-zinc-700 px-4 py-1.5 text-center text-sm font-medium"
                    >
                      {btn.label || "…"} ↗
                    </a>
                  ) : (
                    <button
                      key={btn.id}
                      type="button"
                      disabled={!waitingTap}
                      onClick={() => choose(b.nodeId, btn.id)}
                      className="mx-1.5 mb-1.5 block w-[calc(100%-0.75rem)] rounded-xl bg-zinc-700 px-4 py-1.5 text-center text-sm font-medium enabled:hover:bg-zinc-600 disabled:opacity-70"
                    >
                      {btn.label || "…"}
                    </button>
                  )
                )}
              </div>
            </div>
          );
        })}
        {def.nodes.length === 0 && <p className="pt-6 text-center text-xs text-zinc-500">{t("Add a message to see it here.")}</p>}
      </div>

      <div className="space-y-2 border-t border-zinc-800 px-3 py-3">
        {pause.kind === "tap" && <p className="text-center text-xs text-zinc-400">{t("Tap a button to continue")}</p>}
        {pause.kind === "condition" && (
          <div className="space-y-2">
            <p className="text-center text-xs text-zinc-400">{pause.question}</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => choose(pause.nodeId, "yes")} className="flex-1 rounded-lg bg-zinc-800 py-1.5 text-sm font-semibold text-[#7ee05a]">
                {t("Yes")}
              </button>
              <button type="button" onClick={() => choose(pause.nodeId, "no")} className="flex-1 rounded-lg bg-zinc-800 py-1.5 text-sm font-semibold text-[#ff7b86]">
                {t("No")}
              </button>
            </div>
          </div>
        )}
        {pause.kind === "reply" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              choose(pause.nodeId, reply.trim() || t("ok"));
              setReply("");
            }}
            className="space-y-2"
          >
            <div className="flex gap-2">
              <input
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder={t("Type their reply…")}
                className="min-w-0 flex-1 rounded-full bg-zinc-800 px-3 py-1.5 text-sm text-white outline-none placeholder:text-zinc-500"
              />
              <button type="submit" className="rounded-full px-3 text-sm font-semibold text-accent">
                {t("Send")}
              </button>
            </div>
            <button type="button" onClick={() => choose(pause.nodeId, "\u0000timeout")} className="w-full text-xs text-zinc-400 hover:text-zinc-200">
              {t("Simulate: nobody replied")}
            </button>
          </form>
        )}
        {pause.kind === "end" && <p className="text-center text-xs text-zinc-400">{pause.text}</p>}
        {choices.length > 0 && (
          <button type="button" onClick={() => setChoices([])} className="w-full text-xs font-semibold text-zinc-300 hover:text-white">
            {t("Start over")}
          </button>
        )}
      </div>
    </div>
  );
}
