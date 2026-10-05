/**
 * Etapa 6 (Quiz): public page of a funnel, /q/<slug>.
 *
 *  - Only a PUBLISHED funnel shows. Draft, archived or unknown slug = the same
 *    clean 404 (it never says a draft exists).
 *  - ?preview=1 shows the DRAFT, only to someone signed in whose workspace
 *    owns the funnel (anyone else gets the same 404). The preview records
 *    nothing and the checkout does not open.
 *  - The entry UTMs/fbclid/gclid/src/sck and the contact token ?c= go to the
 *    player, which passes them to the checkout link and to the first event.
 */

import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { getPrimaryWorkspace } from "@/lib/workspace";
import { getDraftPreview, getPublishedFunnelBySlug } from "@/lib/funnels/public";
import { pickTrackingParams } from "@/lib/funnels/checkout";
import type { PublicFunnel } from "@/lib/funnels/types";
import FunnelPlayer from "@/components/funnels/funnel-player";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<SearchParams> };

const SLUG_RE = /^[a-z0-9-]{1,80}$/;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** One lookup per request (the page and its metadata share it). */
const loadFunnel = cache(async (slug: string, preview: boolean): Promise<PublicFunnel | null> => {
  if (!SLUG_RE.test(slug)) return null;
  if (!preview) return getPublishedFunnelBySlug(slug).catch(() => null);
  const session = await auth().catch(() => null);
  const userId = session?.user?.id;
  if (!userId) return null;
  const workspace = await getPrimaryWorkspace(userId).catch(() => null);
  if (!workspace) return null;
  return getDraftPreview(slug, workspace.id).catch(() => null);
});

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { slug } = await params;
  const preview = first((await searchParams).preview) === "1";
  const funnel = await loadFunnel(slug, preview);
  if (!funnel) return { title: "Página não encontrada", robots: { index: false, follow: false } };
  const seo = funnel.settings.seo ?? {};
  const title = seo.title?.trim() || funnel.name;
  const description = seo.description?.trim() || undefined;
  const image = seo.imageUrl?.trim() && !seo.imageUrl.includes(".invalid") ? seo.imageUrl.trim() : undefined;
  const indexable = !preview && seo.indexable === true;
  return {
    title,
    description,
    robots: { index: indexable, follow: indexable },
    openGraph: { title, description, type: "website", ...(image ? { images: [{ url: image }] } : {}) },
    twitter: { card: image ? "summary_large_image" : "summary", title, description, ...(image ? { images: [image] } : {}) },
  };
}

export default async function FunnelPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const query = await searchParams;
  const preview = first(query.preview) === "1";
  const funnel = await loadFunnel(slug, preview);
  if (!funnel) notFound();

  const entryParams = pickTrackingParams(query as Record<string, unknown>);
  const contactToken = first(query.c)?.slice(0, 500) || null;

  return (
    <FunnelPlayer
      key={`${funnel.id}:${funnel.version}`}
      funnel={funnel}
      mode={preview ? "preview" : "live"}
      entryParams={entryParams}
      contactToken={preview ? null : contactToken}
    />
  );
}
