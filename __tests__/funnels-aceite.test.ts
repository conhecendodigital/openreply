/**
 * Etapa 6, teste de aceite (QA): o Claude monta o quiz "Chat Sem Frescura"
 * pela conversa (ferramentas MCP de verdade -> rotas /api/funnels de verdade
 * -> banco em memória), com o modelo "Escada de sim + VSL".
 *
 * Confere: nasce DRAFT, 6 telas e todos os blocos válidos no zod, 1 botão
 * por tela nas 5 primeiras, VSL só na 6ª, botão final de checkout, a chave
 * de API não publica (não existe ferramenta, a rota não está na lista da
 * chave e a rota responde 403 human_only), só o humano publica, e editar
 * depois de publicado não mexe no que está no ar.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const rows: Row[] = [];
  let seq = 0;
  const isDefinition = (v: unknown) => Boolean(v && typeof v === "object" && Array.isArray((v as { steps?: unknown }).steps));
  const clone = <T>(v: T): T => (v === null || v === undefined ? v : JSON.parse(JSON.stringify(v)));
  const pick = (row: Row | undefined) => (row ? clone({ ...row, createdAt: new Date(row.createdAt as string), updatedAt: new Date(row.updatedAt as string) }) : null);
  const matches = (row: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === "object" && "not" in (v as object)) return row[k] !== (v as { not: unknown }).not;
      return row[k] === v;
    });
  const funnel = {
    findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) => pick(rows.find((r) => matches(r, where)))),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => pick(rows.find((r) => matches(r, where)))),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => rows.filter((r) => matches(r, where)).map((r) => pick(r))),
    create: vi.fn(async ({ data }: { data: Row }) => {
      if (rows.some((r) => r.slug === data.slug)) throw Object.assign(new Error("unique"), { code: "P2002" });
      const now = new Date().toISOString();
      const row: Row = {
        id: `f_${++seq}`,
        publishedAt: null,
        publishedBy: null,
        templateId: null,
        ...clone(data),
        published: isDefinition(data.published) ? clone(data.published) : null,
        createdAt: now,
        updatedAt: now,
      };
      rows.push(row);
      return pick(row);
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Row }) => {
      const row = rows.find((r) => r.id === where.id);
      if (!row) throw new Error("not found");
      for (const [k, v] of Object.entries(data)) {
        if (v && typeof v === "object" && "increment" in (v as object)) row[k] = (row[k] as number) + (v as { increment: number }).increment;
        else if (v instanceof Date) row[k] = v.toISOString();
        else row[k] = clone(v);
      }
      row.updatedAt = new Date().toISOString();
      return pick(row);
    }),
    delete: vi.fn(async () => null),
  };
  const prisma = new Proxy({} as Record<string, unknown>, {
    get(_t, name: string) {
      if (name === "funnel") return funnel;
      if (name === "$queryRaw") return vi.fn(async () => []);
      if (name === "$transaction") return vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma));
      return new Proxy({}, { get: () => vi.fn(async () => null) });
    },
  });
  return { rows, prisma, mockCaller: vi.fn(), mockContext: vi.fn() };
});

vi.mock("@/lib/db/client", () => ({ prisma: h.prisma }));
vi.mock("@/lib/auth", () => ({ getApiCaller: h.mockCaller, getCurrentWorkspaceId: vi.fn() }));
vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext: h.mockContext,
  canManageWorkspace: () => true,
}));

import { handleMcpMessage, type InternalCall } from "../lib/mcp/server";
import { resolveHandler } from "../lib/mcp/routes";
import { isApiKeyRouteAllowed } from "../lib/api-key-routes";
import * as publishRoute from "../app/api/funnels/[id]/publish/route";
import * as unpublishRoute from "../app/api/funnels/[id]/unpublish/route";
import * as funnelRoute from "../app/api/funnels/[id]/route";
import { funnelDefinitionSchema } from "../lib/funnels/schema";
import { validateFunnel } from "../lib/funnels/validate";
import { getDraftPreview, getPublishedFunnelBySlug } from "../lib/funnels/public";
import { buildCheckoutUrl } from "../lib/funnels/checkout";
import type { FunnelDefinition } from "../lib/funnels/types";

const CTX = { userId: "u_dono", workspaceId: "ws_A", workspace: { id: "ws_A" }, role: "OWNER" };
const TOKEN = { kind: "token", tokenId: "tok_mcp", scopes: [] };
const SESSION = { kind: "session" };

// Igual a app/api/mcp/route.ts: o MCP só alcança as rotas de resolveHandler.
const internalCall: InternalCall = async (method, path, body) => {
  const url = new URL(path, "http://localhost");
  const resolved = resolveHandler(method, url.pathname);
  if (!resolved) return { status: 404, json: { success: false, error: "No route" } };
  const request = new NextRequest(url, {
    method,
    headers: { authorization: "Bearer x", "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const response = await resolved.handler(request, { params: Promise.resolve({ [resolved.param]: resolved.id }) });
  return { status: response.status, json: await response.json().catch(() => null) };
};

async function tool(name: string, args: Record<string, unknown>) {
  const res = (await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, internalCall)) as {
    result: { content: { text: string }[]; isError?: boolean };
  };
  const text = res.result.content[0].text;
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { isError: Boolean(res.result.isError), text, json };
}

const req = (path: string, method = "POST", body?: unknown) =>
  new NextRequest(new URL(path, "http://localhost"), {
    method,
    headers: { "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

/** O que o dono manda amanhã (aqui com valores de teste): troca todo [colchete] e preenche preço, garantia, checkout, mídia. */
function fillRealData(def: FunnelDefinition): FunnelDefinition {
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      if (v.startsWith("https://troque.invalid/")) return v.replace("https://troque.invalid/", "https://cdn.exemplo.com.br/");
      if (v.includes("XXXXXXXXXXX")) return "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
      return v.replace(/\[[^\]]*\]/g, "texto de teste");
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  const out = walk(def) as FunnelDefinition;
  out.settings.checkoutUrl = "https://pay.hotmart.com/TESTE123";
  for (const step of out.steps) {
    for (const block of step.blocks) {
      if (block.type === "offer") Object.assign(block, { priceCents: 9700, guaranteeDays: 7 });
      if (block.type === "compare" || block.type === "testimonial") Object.assign(block, { authorized: true });
    }
  }
  return out;
}

beforeEach(() => {
  h.rows.length = 0;
  h.mockContext.mockResolvedValue(CTX);
  h.mockCaller.mockResolvedValue(TOKEN);
});

describe("aceite: Claude monta o quiz Chat Sem Frescura pelo MCP", () => {
  it("duplicar_modelo cria DRAFT com as 6 telas da escada de sim + VSL, válido no zod", async () => {
    const res = await tool("duplicar_modelo", { modelo: "escada-sim-vsl", nome: "Chat Sem Frescura", slug: "chat-sem-frescura" });
    expect(res.isError).toBe(false);
    expect(res.json).toMatchObject({ criado: true, status: "DRAFT", publicado: false, slug: "chat-sem-frescura", telas: 6 });

    expect(h.rows).toHaveLength(1);
    const row = h.rows[0];
    expect(row).toMatchObject({ status: "DRAFT", published: null, publishedVersion: 0, workspaceId: "ws_A", templateId: "escada-sim-vsl" });

    const parsed = funnelDefinitionSchema.safeParse(row.draft);
    expect(parsed.success, JSON.stringify(parsed.error?.issues?.slice(0, 3))).toBe(true);
    const def = parsed.data!;
    expect(def.steps).toHaveLength(6);

    // Modelo do Dailton: sem voltar / progresso, 1 botão por tela nas 5 primeiras, vídeo só na 6ª.
    for (const step of def.steps) expect(step.header?.showBack ?? false).toBe(false);
    for (const step of def.steps.slice(0, 5)) {
      const buttons = step.blocks.filter((b) => b.type === "button");
      expect(buttons, step.id).toHaveLength(1);
      expect(buttons[0].type === "button" && buttons[0].action.kind).toBe("next");
      expect(step.blocks.some((b) => b.type === "video"), step.id).toBe(false);
      expect(step.blocks.some((b) => b.type === "field"), step.id).toBe(false);
    }
    const offer = def.steps[5];
    expect(offer.blocks.filter((b) => b.type === "video")).toHaveLength(1);
    const last = offer.blocks[offer.blocks.length - 1];
    expect(last.type === "button" && last.action.kind).toBe("checkout");
    expect(offer.blocks.some((b) => b.type === "offer")).toBe(true);
    // Sem pedir dados em nenhuma tela.
    expect(def.steps.flatMap((s) => s.blocks).some((b) => b.type === "field")).toBe(false);

    // Só faltam dados reais (nada estrutural: sem destino quebrado, sem beco sem saída).
    const v = validateFunnel(def);
    expect(v.ok).toBe(false);
    const allowed = ["placeholder_left", "offer_no_price", "compare_not_authorized", "testimonial_not_authorized", "checkout_no_url", "last_step_no_checkout", "guarantee_no_days"];
    for (const e of v.errors) expect(allowed, e.code).toContain(e.code);
  });

  it("ver_funil lista em PT o que falta (colchetes, preço, checkout) e editar_funil troca texto sem publicar", async () => {
    const created = await tool("duplicar_modelo", { modelo: "escada-sim-vsl", nome: "Chat Sem Frescura", slug: "chat-sem-frescura" });
    const id = created.json!.id as string;

    const ver = await tool("ver_funil", { id });
    const falta = ver.json!.oQueFaltaPraPublicar as { podePublicar: boolean; erros: { mensagem: string }[] };
    expect(falta.podePublicar).toBe(false);
    const msgs = falta.erros.map((e) => e.mensagem).join("\n");
    expect(msgs).toMatch(/colchetes/);
    expect(msgs).toMatch(/preço/);
    expect(msgs).toMatch(/checkout/i);
    for (const m of falta.erros.map((e) => e.mensagem)) expect(m).not.toMatch(/[—–]|prompt|Skill/);

    const editar = await tool("editar_funil", {
      id,
      alteracoes: [{ stepId: "s_capa", blockId: "b_capa_titulo", set: { text: "Descubra como usar o Chat sem frescura" } }],
    });
    expect(editar.isError).toBe(false);
    expect(editar.json).toMatchObject({ editado: true, status: "DRAFT", publicadoContinuaNoAr: false });
    const def = h.rows[0].draft as FunnelDefinition;
    expect(def.steps[0].blocks.find((b) => b.id === "b_capa_titulo")).toMatchObject({ text: "Descubra como usar o Chat sem frescura" });
    expect(h.rows[0].status).toBe("DRAFT");
  });

  it("a chave de API não publica: sem ferramenta, sem rota, e a rota responde 403 human_only", async () => {
    await tool("duplicar_modelo", { modelo: "escada-sim-vsl", nome: "Chat Sem Frescura", slug: "chat-sem-frescura" });
    const id = h.rows[0].id as string;

    // Mesmo com o rascunho pronto, a chave não publica.
    h.rows[0].draft = fillRealData(h.rows[0].draft as FunnelDefinition);

    const list = (await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" }, internalCall)) as { result: { tools: { name: string }[] } };
    expect(list.result.tools.some((t) => /publi|publish/i.test(t.name))).toBe(false);

    // Tentar mandar status pelo editar_funil / criar_funil não passa.
    await tool("editar_funil", { id, nome: "Chat Sem Frescura", status: "PUBLISHED" });
    expect(h.rows[0].status).toBe("DRAFT");
    const direct = await internalCall("PATCH", `/api/funnels/${id}`, { status: "PUBLISHED" });
    expect(direct.status).toBe(400);
    expect((direct.json as { details?: { code?: string } }).details?.code ?? JSON.stringify(direct.json)).toMatch(/draft_only/);

    for (const p of [`/api/funnels/${id}/publish`, `/api/funnels/${id}/unpublish`, `/api/funnels/${id}/leads`, `/api/funnels/${id}/leads/export`]) {
      expect(resolveHandler("POST", p), p).toBeNull();
      expect(isApiKeyRouteAllowed("POST", p), p).toBe(false);
      expect(isApiKeyRouteAllowed("GET", p), p).toBe(false);
    }
    expect(isApiKeyRouteAllowed("DELETE", `/api/funnels/${id}`)).toBe(false);

    const pub = await publishRoute.POST(req(`/api/funnels/${id}/publish`), params(id));
    expect(pub.status).toBe(403);
    expect(JSON.stringify(await pub.json())).toContain("human_only");
    const unpub = await unpublishRoute.POST(req(`/api/funnels/${id}/unpublish`, "POST", {}), params(id));
    expect(unpub.status).toBe(403);
    const del = await funnelRoute.DELETE(req(`/api/funnels/${id}`, "DELETE"), params(id));
    expect(del.status).toBe(403);

    expect(h.rows[0]).toMatchObject({ status: "DRAFT", published: null, publishedVersion: 0 });
    expect(await getPublishedFunnelBySlug("chat-sem-frescura")).toBeNull();
  });

  it("só o humano publica, e só com tudo preenchido; depois o público vê 6 telas e o checkout com UTM + xcod", async () => {
    await tool("duplicar_modelo", { modelo: "escada-sim-vsl", nome: "Chat Sem Frescura", slug: "chat-sem-frescura" });
    const id = h.rows[0].id as string;

    // Rascunho: deslogado não vê; prévia do mesmo workspace vê; de outro, não.
    expect(await getPublishedFunnelBySlug("chat-sem-frescura")).toBeNull();
    expect(await getDraftPreview("chat-sem-frescura", "ws_A")).not.toBeNull();
    expect(await getDraftPreview("chat-sem-frescura", "ws_B")).toBeNull();

    // Humano tenta publicar com colchetes: bloqueado com a lista.
    h.mockCaller.mockResolvedValue(SESSION);
    const blocked = await publishRoute.POST(req(`/api/funnels/${id}/publish`), params(id));
    expect(blocked.status).toBe(400);
    expect(JSON.stringify(await blocked.json())).toContain("fix_before_publish");

    // O Claude preenche pela chave (rascunho inteiro), o humano publica.
    h.mockCaller.mockResolvedValue(TOKEN);
    const filled = fillRealData(h.rows[0].draft as FunnelDefinition);
    const editar = await tool("editar_funil", { id, rascunho: filled });
    expect(editar.isError, editar.text).toBe(false);
    expect((editar.json!.oQueFaltaPraPublicar as { podePublicar: boolean }).podePublicar).toBe(true);
    expect(h.rows[0].status).toBe("DRAFT");

    h.mockCaller.mockResolvedValue(SESSION);
    const ok = await publishRoute.POST(req(`/api/funnels/${id}/publish`), params(id));
    expect(ok.status, JSON.stringify(await ok.clone().json())).toBe(200);
    expect(h.rows[0]).toMatchObject({ status: "PUBLISHED", publishedVersion: 1 });

    const live = await getPublishedFunnelBySlug("chat-sem-frescura");
    expect(live).not.toBeNull();
    expect(live!.steps).toHaveLength(6);
    expect(live!.steps.slice(0, 5).every((s) => !s.blocks.some((b) => b.type === "video"))).toBe(true);
    const video = live!.steps[5].blocks.find((b) => b.type === "video");
    expect(video && "embedUrl" in video && video.embedUrl).toMatch(/^https:\/\/www\.youtube-nocookie\.com\/embed\//);
    const finalButton = live!.steps[5].blocks[live!.steps[5].blocks.length - 1];
    expect(finalButton.type).toBe("button");
    const checkoutUrl = (finalButton as { checkoutUrl?: string }).checkoutUrl!;
    expect(checkoutUrl).toBe("https://pay.hotmart.com/TESTE123");
    const out = new URL(
      buildCheckoutUrl(checkoutUrl, { utm_source: "instagram", utm_campaign: "chat", fbclid: "abc" }, { visitorId: "a".repeat(32) })!
    );
    expect(out.searchParams.get("utm_source")).toBe("instagram");
    expect(out.searchParams.get("fbclid")).toBe("abc");
    expect(out.searchParams.get("xcod")).toBe("a".repeat(32));
    expect(out.searchParams.getAll("utm_source")).toHaveLength(1);

    // Editar depois de publicado (pela chave) não muda o que está no ar.
    h.mockCaller.mockResolvedValue(TOKEN);
    const depois = await tool("editar_funil", {
      id,
      alteracoes: [{ stepId: "s_capa", blockId: "b_capa_titulo", set: { text: "Título novo ainda não publicado" } }],
    });
    expect(depois.json).toMatchObject({ editado: true, status: "PUBLISHED", publicadoContinuaNoAr: true });
    const stillLive = await getPublishedFunnelBySlug("chat-sem-frescura");
    expect(JSON.stringify(stillLive)).not.toContain("Título novo ainda não publicado");
    expect(h.rows[0].publishedVersion).toBe(1);
  });
});
