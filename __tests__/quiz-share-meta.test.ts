/**
 * Página pública do quiz (07/10/2026): quem compartilha o link direto do quiz
 * vê a capa do quiz no cartão (Instagram, WhatsApp), nunca o cartão do Lead
 * Engine. Mesmas tags da prévia do link rastreado.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ host: "quiz.cloudmatheus.com.br", funnel: null as unknown }));

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers({ host: h.host })) }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null) }));
vi.mock("@/lib/workspace", () => ({ getPrimaryWorkspace: vi.fn(async () => null) }));
vi.mock("@/lib/funnels/public", () => ({
  getPublishedFunnelBySlug: vi.fn(async () => h.funnel),
  getDraftPreview: vi.fn(async () => null),
}));
vi.mock("@/components/funnels/funnel-player", () => ({ default: () => null }));

import { generateMetadata } from "../app/q/[slug]/page";

const props = (slug = "diag") => ({ params: Promise.resolve({ slug }), searchParams: Promise.resolve({}) });

beforeEach(() => {
  vi.stubEnv("NEXTAUTH_URL", "https://many.leadenginer.com");
  h.host = "quiz.cloudmatheus.com.br";
  h.funnel = {
    id: "f1",
    slug: "diag",
    name: "Chat Sem Frescura (diagnóstico)",
    version: 3,
    settings: { theme: {}, seo: { description: "Descubra seu nível em 1 minuto." } },
    steps: [{ id: "s_capa", title: "Capa", blocks: [{ id: "b1", type: "image", url: "https://midia.zapcriativo.com/quiz/capa.gif", alt: "" }] }],
  };
});

describe("meta tags do quiz público", () => {
  it("capa do quiz no cartão, og:url do domínio do quiz, sem a marca do Lead Engine", async () => {
    const meta = await generateMetadata(props());
    expect(meta.openGraph).toEqual({
      title: "Chat Sem Frescura (diagnóstico)",
      description: "Descubra seu nível em 1 minuto.",
      type: "website",
      url: "https://quiz.cloudmatheus.com.br/diag",
      images: [{ url: "https://midia.zapcriativo.com/quiz/capa.gif" }],
    });
    expect(meta.twitter).toMatchObject({ card: "summary_large_image", images: ["https://midia.zapcriativo.com/quiz/capa.gif"] });
    expect(JSON.stringify(meta.openGraph)).not.toMatch(/og-lead-engine|siteName/);
  });

  it("no endereço do app, og:url é /q/<slug>; sem imagem nenhuma, cartão pequeno e sem a imagem do app", async () => {
    h.host = "many.leadenginer.com";
    h.funnel = { ...(h.funnel as object), steps: [{ id: "s", title: "Capa", blocks: [] }] };
    const meta = await generateMetadata(props());
    expect(meta.openGraph).toMatchObject({ url: "https://many.leadenginer.com/q/diag" });
    expect((meta.openGraph as { images?: unknown }).images).toBeUndefined();
    expect(meta.twitter).toMatchObject({ card: "summary" });
  });
});
