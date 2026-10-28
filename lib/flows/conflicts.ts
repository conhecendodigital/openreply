/**
 * 28/10/2026: quem mais está LIGADO e responderia ao mesmo evento (mesmo post/story e palavras).
 * Dois ligados no mesmo gatilho mandam DM duplicada. Vale para fluxo x fluxo, fluxo x campanha
 * e campanha x campanha. Só detecta; quem desliga é o chamador (nunca apaga).
 */
import { prisma } from "@/lib/db/client";
import { wordsOverlap } from "@/lib/flows/service";

type Words = { keywords: string[]; matchAnyWord: boolean; wholeWordMatch: boolean };
/** Um jeito de ser acionado: evento + (post ou story ou link) + palavras. */
export type Handler = Words & {
  event: "COMMENT" | "DM" | "STORY_REPLY" | "STORY_MENTION" | "LIVE_COMMENT" | "CONVERSATION_LINK";
  postId: string | null;
  anyPost: boolean;
  storyId: string | null;
  linkId: string | null;
};

type FlowCols = {
  triggerType: string | null;
  triggerPostId: string | null;
  triggerMatchAnyPost: boolean;
  triggerStoryId: string | null;
  conversationLinkId: string | null;
  keywords: string[];
  matchAnyWord: boolean;
  wholeWordMatch: boolean;
};
type AutoCols = {
  trigger: string;
  postId: string | null;
  matchAnyPost: boolean;
  storyId: string | null;
  keywords: string[];
  matchAnyWord: boolean;
  wholeWordMatch: boolean;
  dmTriggerEnabled: boolean;
};

const EVENTS = new Set(["COMMENT", "DM", "STORY_REPLY", "STORY_MENTION", "LIVE_COMMENT", "CONVERSATION_LINK"]);

export function flowHandlers(f: FlowCols): Handler[] {
  if (!f.triggerType || !EVENTS.has(f.triggerType)) return [];
  return [
    {
      event: f.triggerType as Handler["event"],
      postId: f.triggerPostId,
      anyPost: f.triggerMatchAnyPost,
      storyId: f.triggerStoryId,
      linkId: f.conversationLinkId,
      keywords: f.keywords,
      matchAnyWord: f.matchAnyWord,
      wholeWordMatch: f.wholeWordMatch,
    },
  ];
}

export function automationHandlers(a: AutoCols): Handler[] {
  const base = { keywords: a.keywords, matchAnyWord: a.matchAnyWord, wholeWordMatch: a.wholeWordMatch, linkId: null };
  const out: Handler[] = [];
  if (EVENTS.has(a.trigger)) {
    out.push({ ...base, event: a.trigger as Handler["event"], postId: a.postId, anyPost: a.matchAnyPost, storyId: a.storyId });
  }
  if (a.dmTriggerEnabled && a.trigger !== "DM") out.push({ ...base, event: "DM", postId: null, anyPost: false, storyId: null });
  return out;
}

export function handlersOverlap(a: Handler, b: Handler): boolean {
  if (a.event !== b.event) return false;
  switch (a.event) {
    case "COMMENT":
      return (a.anyPost || b.anyPost || (Boolean(a.postId) && a.postId === b.postId)) && wordsOverlap(a, b);
    case "STORY_REPLY":
      return (!a.storyId || !b.storyId || a.storyId === b.storyId) && wordsOverlap(a, b);
    case "STORY_MENTION":
      return true;
    case "CONVERSATION_LINK":
      return Boolean(a.linkId) && a.linkId === b.linkId;
    default:
      return wordsOverlap(a, b);
  }
}

export type Conflict = { tipo: "fluxo" | "campanha"; id: string; nome: string; gatilho: string };

/** Fluxos e campanhas LIGADOS na mesma conta que respondem ao mesmo evento. `self` fica de fora. */
export async function findActiveConflicts(input: {
  instagramAccountId: string;
  handlers: Handler[];
  self: { tipo: "fluxo" | "campanha"; id: string };
}): Promise<Conflict[]> {
  if (input.handlers.length === 0) return [];
  const hits = (other: Handler[]) => other.some((o) => input.handlers.some((h) => handlersOverlap(h, o)));
  const [flows, autos] = await Promise.all([
    prisma.flow.findMany({
      where: { instagramAccountId: input.instagramAccountId, isActive: true },
      select: {
        id: true, name: true, triggerType: true, triggerPostId: true, triggerMatchAnyPost: true, triggerStoryId: true,
        conversationLinkId: true, keywords: true, matchAnyWord: true, wholeWordMatch: true,
      },
    }),
    prisma.automation.findMany({
      where: { instagramAccountId: input.instagramAccountId, isActive: true },
      select: {
        id: true, name: true, trigger: true, postId: true, matchAnyPost: true, storyId: true,
        keywords: true, matchAnyWord: true, wholeWordMatch: true, dmTriggerEnabled: true,
      },
    }),
  ]);
  const out: Conflict[] = [];
  for (const f of Array.isArray(flows) ? flows : []) {
    if (input.self.tipo === "fluxo" && f.id === input.self.id) continue;
    if (hits(flowHandlers(f))) out.push({ tipo: "fluxo", id: f.id, nome: f.name, gatilho: f.triggerType ?? "" });
  }
  for (const a of Array.isArray(autos) ? autos : []) {
    if (input.self.tipo === "campanha" && a.id === input.self.id) continue;
    if (hits(automationHandlers(a))) out.push({ tipo: "campanha", id: a.id, nome: a.name, gatilho: a.trigger });
  }
  return out;
}
