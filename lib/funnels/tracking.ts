/**
 * Etapa 6: what the public player records (server-only). Visits, screen
 * views, answers, checkout clicks and leads. Never trusts the browser for
 * anything that matters: answers are checked against the PUBLISHED version,
 * purchases only come from the Hotmart webhook.
 *
 * A visitor is anonymous (visitorId from the browser). It becomes a CRM
 * contact only through the signed ?c= token of a link sent by Direct; then
 * the option tags land on the contact.
 */
import { z } from "zod";
import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import {
  FUNNEL_EVENT_TYPES,
  LEAD_FIELDS,
  type FunnelBlock,
  type FunnelEventBody,
  type FunnelLeadBody,
  type FunnelPublicOk,
  type PublicStep,
  type TrackingParams,
} from "@/lib/funnels/types";
import { pickTrackingParams } from "@/lib/funnels/checkout";
import { answerLabels, type Answers } from "@/lib/funnels/navigation";
import { contactFromToken } from "@/lib/funnels/contact-link";
import type { LivePublicFunnel } from "@/lib/funnels/public";
import { addTag, AUTO_TAGS, recordEvent, type ContactRef } from "@/lib/contacts/record";
import { getRequestIp, hashClickIp } from "@/lib/tracking/server";
import {
  EVENT_ID_RE,
  fbcFromFbclid,
  isCapiReady,
  newEventId,
  quizSourceUrl,
  scheduleCapi,
  sendCapiEvent,
  validFbc,
  validFbp,
  type CapiEventName,
} from "@/lib/meta/capi";

const ID = /^[A-Za-z0-9_-]{1,40}$/;

/** Pixel/CAPI signals from the browser. A bad fbp/fbc is just ignored. */
const adSignals = {
  adConsent: z.enum(["accepted", "declined"]).optional(),
  fbp: z.string().max(100).optional(),
  fbc: z.string().max(600).optional(),
  eventId: z.string().regex(EVENT_ID_RE).optional(),
};

export const funnelEventBodySchema = z.object({
  visitorId: z.string().regex(/^[a-f0-9]{32}$/),
  version: z.number().int().min(0),
  type: z.enum(FUNNEL_EVENT_TYPES),
  stepId: z.string().regex(ID),
  blockId: z.string().regex(ID).optional(),
  optionIds: z.array(z.string().regex(ID)).max(12).optional(),
  tracking: z.record(z.string(), z.unknown()).optional(),
  contactToken: z.string().max(200).optional(),
  referrer: z.string().max(2048).optional(),
  ...adSignals,
});

export const funnelLeadBodySchema = z.object({
  visitorId: z.string().regex(/^[a-f0-9]{32}$/),
  version: z.number().int().min(0),
  stepId: z.string().regex(ID),
  fields: z.partialRecord(z.enum(LEAD_FIELDS), z.string().max(300)),
  consent: z.boolean(),
  website: z.string().max(300).optional(),
  ...adSignals,
});

export class LeadError extends Error {
  constructor(
    public code: string,
    message: string,
    public extra: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

const IGNORED: FunnelPublicOk = { ok: true, ignored: true };
const OK: FunnelPublicOk = { ok: true };

export function deviceOf(userAgent: string | null | undefined): "mobile" | "tablet" | "desktop" {
  const ua = userAgent ?? "";
  if (/iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(ua)) return "tablet";
  if (/Mobi|iPhone|iPod|Android|IEMobile|Opera Mini/i.test(ua)) return "mobile";
  return "desktop";
}

export function sourceOf(tracking: TrackingParams | null | undefined): string {
  const s = tracking?.utm_source?.trim().toLowerCase().slice(0, 60);
  return s || "direto";
}

export function referrerHostOf(referrer: string | null | undefined): string | null {
  if (!referrer) return null;
  try {
    const u = new URL(referrer);
    return u.protocol === "https:" || u.protocol === "http:" ? u.hostname.slice(0, 200) : null;
  } catch {
    return null;
  }
}

type VisitRow = {
  id: string;
  contactId: string | null;
  createdAt?: Date | null;
  tracking?: unknown;
  adConsent?: boolean | null;
  clientIp?: string | null;
  clientUserAgent?: string | null;
  fbp?: string | null;
  fbc?: string | null;
};

type AdBody = { adConsent?: "accepted" | "declined"; fbp?: string; fbc?: string };

/**
 * Consent for Pixel/CAPI of this visit, decided on the server with the
 * quiz mode: "banner" (default) = only after Accept; "notice" and "off" = already on.
 * IP, user agent and the Pixel cookies are kept only with consent AND with
 * the Conversions API set up (the Hotmart Purchase needs them later).
 */
export function adConsentFields(funnel: LivePublicFunnel, body: AdBody, request: Request) {
  const mode = funnel.settings.pixelConsent ?? "banner";
  const allowed = Boolean(funnel.settings.pixelId) && (mode === "notice" || mode === "off" || body.adConsent === "accepted");
  if (!allowed) return { adConsent: false, clientIp: null, clientUserAgent: null, fbp: null, fbc: null };
  if (!isCapiReady(funnel.capi, funnel.settings.pixelId)) return { adConsent: true };
  const fbp = validFbp(body.fbp);
  const fbc = validFbc(body.fbc);
  return {
    adConsent: true,
    clientIp: getRequestIp(request)?.slice(0, 64) ?? null,
    clientUserAgent: request.headers.get("user-agent")?.slice(0, 500) ?? null,
    ...(fbp ? { fbp } : {}),
    ...(fbc ? { fbc } : {}),
  };
}

const VISIT_SELECT = {
  id: true,
  contactId: true,
  createdAt: true,
  tracking: true,
  adConsent: true,
  clientIp: true,
  clientUserAgent: true,
  fbp: true,
  fbc: true,
} as const;

async function ensureVisit(
  funnel: LivePublicFunnel,
  body: { visitorId: string; tracking?: Record<string, unknown>; contactToken?: string; referrer?: string } & AdBody,
  request: Request
): Promise<{ visit: VisitRow; contact: ContactRef | null }> {
  const contact = body.contactToken ? await contactFromToken(funnel.workspaceId, funnel.slug, body.contactToken) : null;
  const tracking = pickTrackingParams(body.tracking ?? null);
  const ad = adConsentFields(funnel, body, request);
  const visit = await prisma.funnelVisit.upsert({
    where: { funnelId_visitorId: { funnelId: funnel.id, visitorId: body.visitorId } },
    create: {
      workspaceId: funnel.workspaceId,
      funnelId: funnel.id,
      visitorId: body.visitorId,
      funnelVersion: funnel.version,
      contactId: contact?.id ?? null,
      tracking: Object.keys(tracking).length > 0 ? (tracking as Prisma.InputJsonValue) : undefined,
      source: sourceOf(tracking),
      referrerHost: referrerHostOf(body.referrer),
      device: deviceOf(request.headers.get("user-agent")),
      ipHash: hashClickIp(getRequestIp(request)),
      ...ad,
    },
    // A valid token later in the visit (rare) links the person. The consent
    // follows the last choice of the cookie notice.
    update: contact ? { contactId: contact.id, ...ad } : { ...ad },
    select: VISIT_SELECT,
  });
  const linked: ContactRef | null =
    contact ?? (visit.contactId ? { id: visit.contactId, workspaceId: funnel.workspaceId } : null);
  return { visit, contact: linked };
}

async function markOnce(visitId: string, field: "startedAt" | "completedAt" | "checkoutAt" | "leadAt", at: Date) {
  await prisma.funnelVisit.updateMany({ where: { id: visitId, [field]: null }, data: { [field]: at } });
}

async function addEvent(input: {
  funnel: LivePublicFunnel;
  visitId: string;
  type: string;
  stepId: string;
  blockId?: string;
}) {
  await prisma.funnelEvent.createMany({
    data: [
      {
        workspaceId: input.funnel.workspaceId,
        funnelId: input.funnel.id,
        visitId: input.visitId,
        type: input.type,
        stepId: input.stepId,
        blockId: input.blockId ?? "",
      },
    ],
    skipDuplicates: true,
  });
}

type OptionsBlock = Extract<FunnelBlock, { type: "options" }>;

/** Answers of a visit (options.name -> option ids), from its answer events. */
async function visitAnswers(funnel: LivePublicFunnel, visitId: string): Promise<Answers> {
  const byBlock = new Map<string, OptionsBlock>();
  for (const step of funnel.steps) for (const b of step.blocks) if (b.type === "options") byBlock.set(b.id, b);
  const rows = await prisma.funnelEvent.findMany({
    where: { visitId, type: "answer" },
    select: { blockId: true, value: true },
  });
  const answers: Answers = {};
  for (const r of Array.isArray(rows) ? rows : []) {
    const block = byBlock.get(r.blockId);
    const ids = (r.value as { optionIds?: unknown } | null)?.optionIds;
    if (block && Array.isArray(ids)) answers[block.name] = ids.filter((x): x is string => typeof x === "string");
  }
  return answers;
}

function tagsOf(funnel: LivePublicFunnel, answers: Answers): string[] {
  const tags = new Set<string>();
  for (const step of funnel.steps) {
    for (const b of step.blocks) {
      if (b.type !== "options") continue;
      const picked = new Set(answers[b.name] ?? []);
      for (const o of b.options) if (picked.has(o.id) && o.tag?.trim()) tags.add(o.tag.trim());
    }
  }
  return [...tags];
}

const safe = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
  } catch (error) {
    console.warn("[Funnel] CRM step failed:", error instanceof Error ? error.message : "error");
  }
};

/**
 * CAPI copy of a quiz event, after the response. Only with consent on the
 * visit and the account Pixel + token. Never throws, never blocks.
 */
function sendQuizCapi(
  funnel: LivePublicFunnel,
  visit: VisitRow,
  input: { eventName: CapiEventName; eventId?: string; visitorId: string; lead?: { name?: string | null; email?: string | null; phone?: string | null } | null }
) {
  if (visit.adConsent !== true || !isCapiReady(funnel.capi, funnel.settings.pixelId)) return;
  const fbclid = (visit.tracking as TrackingParams | null | undefined)?.fbclid;
  const fbc = visit.fbc ?? fbcFromFbclid(fbclid, visit.createdAt ?? new Date());
  const eventId = input.eventId ?? newEventId(input.eventName.toLowerCase());
  scheduleCapi(async () => {
    const lead =
      input.lead !== undefined
        ? input.lead
        : await prisma.funnelLead
            .findUnique({ where: { visitId: visit.id }, select: { name: true, email: true, phone: true } })
            .catch(() => null);
    await sendCapiEvent(
      funnel.capi,
      {
        eventName: input.eventName,
        eventId,
        eventSourceUrl: quizSourceUrl(funnel.slug),
        user: {
          email: lead?.email,
          phone: lead?.phone,
          name: lead?.name,
          externalId: input.visitorId,
          ip: visit.clientIp,
          userAgent: visit.clientUserAgent,
          fbc,
          fbp: visit.fbp,
        },
        customData: { content_name: funnel.name.slice(0, 120) },
      },
      { workspaceId: funnel.workspaceId, pixelId: funnel.settings.pixelId }
    );
  });
}

export async function recordFunnelEvent(
  funnel: LivePublicFunnel,
  body: FunnelEventBody,
  request: Request,
  now: Date = new Date()
): Promise<FunnelPublicOk> {
  // Republished in the middle of the visit: the old screens no longer exist.
  if (body.version !== funnel.version) return IGNORED;
  const index = funnel.steps.findIndex((s) => s.id === body.stepId);
  if (index < 0) return IGNORED;
  const step: PublicStep = funnel.steps[index];
  const block = body.blockId ? step.blocks.find((b) => b.id === body.blockId) : undefined;
  if (body.blockId && !block) return IGNORED;

  let picked: string[] = [];
  let optionsBlock: OptionsBlock | null = null;
  if (body.type === "answer") {
    if (!block || block.type !== "options") return IGNORED;
    optionsBlock = block;
    const valid = new Set(block.options.map((o) => o.id));
    picked = [...new Set(body.optionIds ?? [])].filter((id) => valid.has(id));
    if (!block.multiple) picked = picked.slice(0, 1);
    else if (block.maxChoices) picked = picked.slice(0, block.maxChoices);
    if (picked.length === 0) return IGNORED;
  }

  const { visit, contact } = await ensureVisit(funnel, body, request);
  const last = funnel.steps.length - 1;

  switch (body.type) {
    case "view": {
      await addEvent({ funnel, visitId: visit.id, type: "view", stepId: step.id });
      await prisma.funnelVisit.updateMany({
        where: { id: visit.id, maxStepIndex: { lt: index } },
        data: { maxStepIndex: index },
      });
      if (index >= 1) await markOnce(visit.id, "startedAt", now);
      if (index === last) await markOnce(visit.id, "completedAt", now);
      break;
    }
    case "complete": {
      await addEvent({ funnel, visitId: visit.id, type: "complete", stepId: step.id });
      await markOnce(visit.id, "completedAt", now);
      break;
    }
    case "answer": {
      const value = { optionIds: picked } as Prisma.InputJsonValue;
      await prisma.funnelEvent.upsert({
        where: {
          visitId_type_stepId_blockId: { visitId: visit.id, type: "answer", stepId: step.id, blockId: optionsBlock!.id },
        },
        create: {
          workspaceId: funnel.workspaceId,
          funnelId: funnel.id,
          visitId: visit.id,
          type: "answer",
          stepId: step.id,
          blockId: optionsBlock!.id,
          value,
        },
        update: { value },
      });
      await markOnce(visit.id, "startedAt", now);
      const tags = optionsBlock!.options.filter((o) => picked.includes(o.id) && o.tag?.trim()).map((o) => o.tag!.trim());
      if (contact) {
        await safe(async () => {
          await addTag(contact, AUTO_TAGS.quizLead(funnel.slug), "auto", now);
          for (const tag of tags) await addTag(contact, tag, "auto", now);
        });
      }
      if (tags.length > 0) {
        await safe(async () => {
          const lead = await prisma.funnelLead.findUnique({ where: { visitId: visit.id }, select: { id: true, tags: true } });
          if (lead) {
            const merged = [...new Set([...(lead.tags ?? []), ...tags])];
            await prisma.funnelLead.update({ where: { id: lead.id }, data: { tags: merged } });
          }
        });
      }
      break;
    }
    case "checkout": {
      await addEvent({ funnel, visitId: visit.id, type: "checkout", stepId: step.id, blockId: body.blockId });
      await markOnce(visit.id, "checkoutAt", now);
      sendQuizCapi(funnel, visit, { eventName: "InitiateCheckout", eventId: body.eventId, visitorId: body.visitorId });
      if (contact) {
        await safe(() =>
          recordEvent(contact, { type: "FUNNEL_CHECKOUT", refId: visit.id, occurredAt: now, text: funnel.name })
        );
      }
      break;
    }
  }
  return OK;
}

// ─── Lead ───────────────────────────────────────────────────────────────────

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeEmail(value: string | undefined): string | null {
  const v = value?.trim().toLowerCase() ?? "";
  if (!v) return null;
  return v.length <= 254 && EMAIL.test(v) ? v : "";
}

/** Digits with country code: 10 or 11 digits get 55 (Brazil) in front. */
export function normalizeWhatsapp(value: string | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length < 10 || digits.length > 13) return "";
  return digits.length <= 11 ? `55${digits}` : digits;
}

export function normalizeName(value: string | undefined): string | null {
  const v = (value ?? "").replace(/\s+/g, " ").trim();
  if (!v) return null;
  return v.length >= 2 && v.length <= 80 ? v : "";
}

/** Throws LeadError (consent_required / invalid_lead); the honeypot is handled by the route. */
export async function submitFunnelLead(
  funnel: LivePublicFunnel,
  body: FunnelLeadBody,
  request: Request,
  now: Date = new Date()
): Promise<FunnelPublicOk> {
  if (body.version !== funnel.version) return IGNORED;
  const step = funnel.steps.find((s) => s.id === body.stepId);
  if (!step) return IGNORED;
  const fieldBlocks = step.blocks.filter((b): b is Extract<FunnelBlock, { type: "field" }> => b.type === "field");
  if (fieldBlocks.length === 0) return IGNORED;
  if (body.consent !== true) throw new LeadError("consent_required", "Check the consent box to continue");

  const values = {
    name: normalizeName(body.fields.name),
    email: normalizeEmail(body.fields.email),
    whatsapp: normalizeWhatsapp(body.fields.whatsapp),
  };
  const wrong: string[] = [];
  for (const f of fieldBlocks) {
    const v = values[f.field];
    if (v === "") wrong.push(f.field);
    else if (v === null && f.required !== false) wrong.push(f.field);
  }
  // A value sent for a field that is not on the screen is dropped.
  const asked = new Set(fieldBlocks.map((f) => f.field));
  if (wrong.length > 0) throw new LeadError("invalid_lead", "Check the fields", { fields: wrong });
  const pick = (k: "name" | "email" | "whatsapp") => (asked.has(k) && values[k] ? values[k] : null);

  const { visit, contact } = await ensureVisit(funnel, body, request);
  const answers = await visitAnswers(funnel, visit.id);
  const labels = answerLabels(funnel, answers);
  const tags = tagsOf(funnel, answers);
  const data = {
    name: pick("name"),
    email: pick("email"),
    phone: pick("whatsapp"),
    answers: labels as Prisma.InputJsonValue,
    tags,
    consentAt: now,
    consentText: funnel.settings.consentText ?? null,
    contactId: contact?.id ?? visit.contactId ?? null,
  };
  const lead = await prisma.funnelLead.upsert({
    where: { visitId: visit.id },
    create: { workspaceId: funnel.workspaceId, funnelId: funnel.id, visitId: visit.id, ...data },
    update: data,
    select: { id: true },
  });
  await markOnce(visit.id, "leadAt", now);
  sendQuizCapi(funnel, visit, {
    eventName: "Lead",
    eventId: body.eventId,
    visitorId: body.visitorId,
    lead: { name: data.name, email: data.email, phone: data.phone },
  });
  if (contact) {
    await safe(async () => {
      await recordEvent(contact, { type: "FUNNEL_LEAD", refId: lead.id, occurredAt: now, text: funnel.name });
      await addTag(contact, AUTO_TAGS.quizLead(funnel.slug), "auto", now);
    });
  }
  return OK;
}

