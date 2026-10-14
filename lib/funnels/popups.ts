/**
 * Pop-ups of the quiz (pedido do Matheus, 14/10): "Quero sair" opens a
 * retention pop-up with a story, plus pop-ups that open alone when the
 * visitor tries to leave (mouse out the top / back button) or after N
 * seconds on a screen. Pure and browser-safe: the player and the tests use it.
 *
 * Rule: an automatic pop-up opens at most once per visit; a button can open
 * its pop-up as many times as the visitor taps it.
 */
import type { FunnelPopup, FunnelSettings } from "@/lib/funnels/types";

export type PopupTrigger = "button" | "exit" | "timer";

export function findPopup(settings: Pick<FunnelSettings, "popups"> | undefined, id: string): FunnelPopup | null {
  return settings?.popups?.find((p) => p.id === id) ?? null;
}

/** stepIds empty or absent = every screen. */
export function popupOnStep(popup: FunnelPopup, stepId: string): boolean {
  const ids = popup.trigger?.stepIds ?? [];
  return ids.length === 0 || ids.includes(stepId);
}

/** The exit-intent pop-up of this screen that has not opened yet (first in the list wins). */
export function exitPopupFor(
  settings: Pick<FunnelSettings, "popups"> | undefined,
  stepId: string,
  alreadyShown: ReadonlySet<string>
): FunnelPopup | null {
  return (
    settings?.popups?.find((p) => p.trigger?.exit === true && popupOnStep(p, stepId) && !alreadyShown.has(p.id)) ?? null
  );
}

/** Timed pop-ups of this screen that have not opened yet, soonest first. */
export function timedPopupsFor(
  settings: Pick<FunnelSettings, "popups"> | undefined,
  stepId: string,
  alreadyShown: ReadonlySet<string>
): { popup: FunnelPopup; afterMs: number }[] {
  return (settings?.popups ?? [])
    .filter((p) => (p.trigger?.afterSec ?? 0) > 0 && popupOnStep(p, stepId) && !alreadyShown.has(p.id))
    .map((p) => ({ popup: p, afterMs: (p.trigger?.afterSec ?? 0) * 1000 }))
    .sort((a, b) => a.afterMs - b.afterMs);
}

/** Does any pop-up of the funnel open alone on exit? (the player only listens if so) */
export function hasExitPopup(settings: Pick<FunnelSettings, "popups"> | undefined): boolean {
  return (settings?.popups ?? []).some((p) => p.trigger?.exit === true);
}
