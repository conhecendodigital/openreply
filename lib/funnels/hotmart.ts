/**
 * Etapa 6: Hotmart purchase webhook (server-only). The ONLY source of
 * "bought": the browser never says it.
 *
 * - Auth: HOTMART_HOTTOK (env). Without it the endpoint answers 503.
 * - Idempotent: FunnelPurchase is unique on (provider, transaction, event).
 * - Link to the visit: xcod = visitorId (the checkout button adds it to the
 *   Hotmart link). Without xcod, the most recent lead with the buyer e-mail.
 * - Approved/complete: visit + lead purchasedAt, contact tag
 *   "comprou:<produto>" + PURCHASE event. Refund/chargeback: refundedAt and
 *   tag "reembolso:<produto>". Other events: only the row.
 * - The buyer e-mail is never stored here, only a salted hash.
 * - Meta Conversions API: the first approved event of a visit sends a
 *   Purchase (value + currency of the sale) with the IP, user agent, fbc and
 *   fbp kept from the visit. Only when the visit had ad consent and the
 *   account has Pixel + token. event_id = purchase_<transaction>.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db/client";
import { addTag, AUTO_TAGS, recordEvent, type ContactRef } from "@/lib/contacts/record";
import { definitionOrNull } from "@/lib/funnels/schema";
import { fbcFromFbclid, PIXEL_ID_RE, quizSourceUrl, sendCapiEvent, type CapiResult } from "@/lib/meta/capi";

export type HotmartPurchase = {
  event: string;
  transaction: string;
  status: string | null;
  productId: string | null;
  productName: string | null;
  offerCode: string | null;
  amountCents: number | null;
  currency: string | null;
  buyerEmail: string | null;
  src: string | null;
  sck: string | null;
  xcod: string | null;
  occurredAt: Date;
};

export const APPROVED_EVENTS = new Set(["PURCHASE_APPROVED", "PURCHASE_COMPLETE"]);
export const REFUND_EVENTS = new Set(["PURCHASE_REFUNDED", "PURCHASE_CHARGEBACK"]);

/** Same length and same bytes, in constant time; never throws. */
export function hottokMatches(given: string | null | undefined, expected: string | null | undefined): boolean {
  if (!given || !expected) return false;
  // Compare fixed-size digests so neither the bytes nor the length of the
  // secret leak through timing.
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

const str = (v: unknown, max = 200): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : typeof v === "number" ? String(v) : null;

function dateOf(v: unknown): Date {
  if (typeof v === "number" && Number.isFinite(v)) return new Date(v);
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    const d = Number.isFinite(n) ? new Date(n) : new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

function cents(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(",", ".")) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

const V1_STATUS: Record<string, string> = {
  approved: "PURCHASE_APPROVED",
  completed: "PURCHASE_COMPLETE",
  complete: "PURCHASE_COMPLETE",
  refunded: "PURCHASE_REFUNDED",
  chargeback: "PURCHASE_CHARGEBACK",
  canceled: "PURCHASE_CANCELED",
  cancelled: "PURCHASE_CANCELED",
};

/** Hotmart v2 payload (with a v1 fallback). null = not a purchase we can store. */
export function parseHotmartPayload(json: unknown): HotmartPurchase | null {
  if (!json || typeof json !== "object") return null;
  const body = json as Record<string, unknown>;
  const data = body.data as Record<string, unknown> | undefined;
  if (data && typeof data === "object") {
    const purchase = (data.purchase ?? {}) as Record<string, unknown>;
    const product = (data.product ?? {}) as Record<string, unknown>;
    const buyer = (data.buyer ?? {}) as Record<string, unknown>;
    const origin = (purchase.origin ?? {}) as Record<string, unknown>;
    const price = (purchase.price ?? {}) as Record<string, unknown>;
    const offer = (purchase.offer ?? {}) as Record<string, unknown>;
    const event = str(body.event, 60);
    const transaction = str(purchase.transaction, 100);
    if (!event || !transaction) return null;
    return {
      event: event.toUpperCase(),
      transaction,
      status: str(purchase.status, 60),
      productId: str(product.id, 60),
      productName: str(product.name, 120),
      offerCode: str(offer.code, 60),
      amountCents: cents(price.value),
      currency: str(price.currency_value, 10),
      buyerEmail: str(buyer.email, 254)?.toLowerCase() ?? null,
      src: str(origin.src),
      sck: str(origin.sck),
      xcod: str(origin.xcod),
      occurredAt: dateOf(body.creation_date ?? purchase.approved_date),
    };
  }
  // v1 (form fields, hottok in the body).
  const transaction = str(body.transaction, 100);
  const status = str(body.status, 60)?.toLowerCase() ?? null;
  const event = str(body.event, 60)?.toUpperCase() ?? (status ? V1_STATUS[status] : null);
  if (!transaction || !event) return null;
  return {
    event,
    transaction,
    status,
    productId: str(body.prod, 60),
    productName: str(body.prod_name, 120),
    offerCode: str(body.off, 60),
    amountCents: cents(body.price),
    currency: str(body.currency, 10),
    buyerEmail: str(body.email, 254)?.toLowerCase() ?? null,
    src: str(body.src),
    sck: str(body.sck),
    xcod: str(body.xcod),
    occurredAt: dateOf(body.purchase_date),
  };
}

export function buyerEmailHash(email: string | null): string | null {
  if (!email) return null;
  const salt = process.env.NEXTAUTH_SECRET ?? "lead-engine-buyer-salt";
  return createHash("sha256").update(`${salt}:${email.trim().toLowerCase()}`).digest("hex");
}

const VISITOR_ID = /^[a-f0-9]{32}$/;

export async function applyHotmartPurchase(
  parsed: HotmartPurchase
): Promise<{ matched: boolean; duplicate: boolean }> {
  type Match = { visitId: string | null; funnelId: string; workspaceId: string; leadId: string | null; contactId: string | null };
  let match: Match | null = null;

  if (parsed.xcod && VISITOR_ID.test(parsed.xcod)) {
    const visit = await prisma.funnelVisit.findFirst({
      where: { visitorId: parsed.xcod },
      orderBy: { createdAt: "desc" },
      select: { id: true, funnelId: true, workspaceId: true, contactId: true },
    });
    if (visit) {
      const lead = await prisma.funnelLead.findUnique({ where: { visitId: visit.id }, select: { id: true, contactId: true } });
      match = {
        visitId: visit.id,
        funnelId: visit.funnelId,
        workspaceId: visit.workspaceId,
        leadId: lead?.id ?? null,
        contactId: visit.contactId ?? lead?.contactId ?? null,
      };
    }
  }
  if (!match && parsed.buyerEmail) {
    const lead = await prisma.funnelLead.findFirst({
      where: { email: parsed.buyerEmail },
      orderBy: { createdAt: "desc" },
      select: { id: true, visitId: true, funnelId: true, workspaceId: true, contactId: true },
    });
    if (lead) {
      match = { visitId: lead.visitId, funnelId: lead.funnelId, workspaceId: lead.workspaceId, leadId: lead.id, contactId: lead.contactId };
    }
  }

  const { count } = await prisma.funnelPurchase.createMany({
    data: [
      {
        workspaceId: match?.workspaceId ?? null,
        funnelId: match?.funnelId ?? null,
        visitId: match?.visitId ?? null,
        leadId: match?.leadId ?? null,
        contactId: match?.contactId ?? null,
        provider: "hotmart",
        transaction: parsed.transaction,
        event: parsed.event,
        status: parsed.status,
        productId: parsed.productId,
        productName: parsed.productName,
        offerCode: parsed.offerCode,
        amountCents: parsed.amountCents,
        currency: parsed.currency,
        buyerEmailHash: buyerEmailHash(parsed.buyerEmail),
        src: parsed.src,
        sck: parsed.sck,
        xcod: parsed.xcod,
        occurredAt: parsed.occurredAt,
      },
    ],
    skipDuplicates: true,
  });
  // Hotmart retries: the same (transaction, event) changes nothing twice.
  if (count !== 1) return { matched: Boolean(match), duplicate: true };
  if (!match) return { matched: false, duplicate: false };

  const at = parsed.occurredAt;
  const product = parsed.productName || parsed.productId || "produto";
  const contact: ContactRef | null = match.contactId ? { id: match.contactId, workspaceId: match.workspaceId } : null;

  if (APPROVED_EVENTS.has(parsed.event)) {
    let firstPurchase = false;
    if (match.visitId) {
      const marked = await prisma.funnelVisit.updateMany({ where: { id: match.visitId, purchasedAt: null }, data: { purchasedAt: at } });
      firstPurchase = marked?.count === 1;
    }
    if (match.leadId) {
      await prisma.funnelLead.updateMany({ where: { id: match.leadId, purchasedAt: null }, data: { purchasedAt: at } });
    }
    if (firstPurchase && match.visitId) await sendPurchaseCapi(match.visitId, parsed).catch(() => null);
    if (contact) {
      await safe(async () => {
        await addTag(contact, AUTO_TAGS.bought(product), "auto", at);
        await recordEvent(contact, { type: "PURCHASE", refId: parsed.transaction, occurredAt: at, text: product });
      });
    }
  } else if (REFUND_EVENTS.has(parsed.event)) {
    if (match.visitId) {
      await prisma.funnelVisit.updateMany({ where: { id: match.visitId, refundedAt: null }, data: { refundedAt: at } });
    }
    if (contact) await safe(() => addTag(contact, AUTO_TAGS.refunded(product), "auto", at));
  }
  return { matched: true, duplicate: false };
}

/**
 * Purchase on the Meta Conversions API for a matched visit. null = not sent
 * (no consent, no Pixel/token, visit gone). Never throws.
 */
export async function sendPurchaseCapi(visitId: string, parsed: HotmartPurchase): Promise<CapiResult | null> {
  const visit = await prisma.funnelVisit.findUnique({
    where: { id: visitId },
    select: {
      visitorId: true,
      createdAt: true,
      tracking: true,
      adConsent: true,
      clientIp: true,
      clientUserAgent: true,
      fbp: true,
      fbc: true,
      workspaceId: true,
      lead: { select: { name: true, email: true, phone: true } },
      funnel: {
        select: {
          slug: true,
          name: true,
          published: true,
          workspace: { select: { metaCapi: { select: { pixelId: true, accessTokenEnc: true, testEventCode: true } } } },
        },
      },
    },
  });
  if (!visit || visit.adConsent !== true) return null;
  const capi = visit.funnel?.workspace?.metaCapi ?? null;
  const own = definitionOrNull(visit.funnel?.published)?.settings.pixelId?.trim();
  const pixelId = own && PIXEL_ID_RE.test(own) ? own : capi?.pixelId ?? null;
  if (!capi?.accessTokenEnc || !pixelId) return null;

  const fbclid = (visit.tracking as { fbclid?: string } | null)?.fbclid;
  const customData: { value?: number; currency?: string; content_name?: string } = {};
  if (parsed.amountCents !== null && parsed.currency) {
    customData.value = parsed.amountCents / 100;
    customData.currency = parsed.currency.toUpperCase();
  }
  const product = parsed.productName || parsed.productId;
  if (product) customData.content_name = product;
  return sendCapiEvent(
    capi,
    {
      eventName: "Purchase",
      eventId: `purchase_${parsed.transaction}`.slice(0, 80),
      eventTime: parsed.occurredAt,
      eventSourceUrl: visit.funnel?.slug ? quizSourceUrl(visit.funnel.slug) : null,
      user: {
        email: parsed.buyerEmail ?? visit.lead?.email,
        phone: visit.lead?.phone,
        name: visit.lead?.name,
        externalId: visit.visitorId,
        ip: visit.clientIp,
        userAgent: visit.clientUserAgent,
        fbc: visit.fbc ?? fbcFromFbclid(fbclid, visit.createdAt),
        fbp: visit.fbp,
      },
      customData,
    },
    { workspaceId: visit.workspaceId, pixelId }
  );
}

async function safe(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (error) {
    console.warn("[Hotmart] CRM step failed:", error instanceof Error ? error.message : "error");
  }
}
