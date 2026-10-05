/**
 * Etapa 6: MCP tools for quizzes (funis). Through the API key the AI lists,
 * reads, creates and edits DRAFTS and reads the numbers. No tool publishes,
 * unpublishes, archives, deletes or reads leads: those are only on the
 * screen, with the account owner (the routes answer 403 human_only to a key).
 *
 * Self-contained (own tiny helpers) so lib/mcp/server.ts only spreads
 * FUNNEL_TOOLS at the end of TOOLS, with no import cycle.
 */
import type { InternalCall } from "@/lib/mcp/server";
import { getBaseUrl } from "@/lib/env";
import { translate } from "@/lib/i18n";
import { ptFunnelsApi } from "@/lib/i18n/pt-funnels-api";
import { FUNNEL_TEMPLATES, getFunnelTemplate } from "@/lib/funnels/templates";
import { ISSUE_MESSAGES } from "@/lib/funnels/validate";
import type { FunnelDetail, FunnelIssue, FunnelResults, FunnelSummary } from "@/lib/funnels/types";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
export type FunnelTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (args: Record<string, unknown>, call: InternalCall) => Promise<ToolResult>;
};

const str = { type: "string" };

function text(value: unknown, isError = false): ToolResult {
  return {
    content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

async function api(
  call: InternalCall,
  method: "GET" | "POST" | "PATCH",
  path: string,
  body?: unknown
): Promise<{ ok: true; data: unknown } | { ok: false; result: ToolResult }> {
  const { status, json } = await call(method, path, body);
  const envelope = (json ?? {}) as { success?: boolean; data?: unknown; error?: unknown; details?: unknown };
  if (status >= 400 || envelope.success === false) {
    return { ok: false, result: text({ status, error: envelope.error ?? "Request failed", details: envelope.details }, true) };
  }
  return { ok: true, data: envelope.data ?? json };
}

function requireString(args: Record<string, unknown>, key: string): string | null {
  const value = args[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

const link = (slug: string, preview = false) => `${getBaseUrl().replace(/\/+$/, "")}/q/${slug}${preview ? "?preview=1" : ""}`;

/** PT message of a validation issue (with its {step}/{text}/{n}). */
export function issueTextPt(issue: FunnelIssue): string {
  const key = ISSUE_MESSAGES[issue.code] ?? issue.code;
  const pt = ptFunnelsApi[key];
  const base = pt ?? translate("pt", key);
  const vars = issue.params ?? {};
  return base.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

function whatIsMissing(detail: Pick<FunnelDetail, "validation"> | null | undefined) {
  const v = detail?.validation;
  if (!v) return null;
  return {
    podePublicar: v.ok,
    erros: v.errors.map((i) => ({ codigo: i.code, tela: i.stepId ?? null, bloco: i.blockId ?? null, mensagem: issueTextPt(i) })),
    avisos: v.warnings.map((i) => ({ codigo: i.code, tela: i.stepId ?? null, bloco: i.blockId ?? null, mensagem: issueTextPt(i) })),
  };
}

const PUBLISH_NOTE = "Publicar só pela tela, com o dono da conta.";

export const FUNNEL_DRAFT_HELP =
  "Rascunho = { schemaVersion: 1, settings: { theme: { mode: \"light\"|\"dark\", primary, background, text (#RRGGBB), radius? }, checkoutUrl? (https), pixelId? (só dígitos), pixelConsent? (\"banner\"|\"notice\"), seo?, privacyUrl?, consentText?, footerText? }, steps: [{ id, title, header?: { showBack?, showProgress?, showLogo? }, blocks: [...] }] }. " +
  "ids: letras, números, - ou _ (até 40), únicos no funil. Blocos (todos com id e delaySec? em segundos): " +
  '{type:"heading", text, level?:1|2, align?}; {type:"text", text (**negrito**, *itálico*, "- " vira item, {resposta.<name>})}; ' +
  '{type:"image", url (https, GIF ok), alt}; {type:"video", url (YouTube, inclusive não listado, Vimeo, Panda Video ou link de um vídeo já enviado pelo editor), title, vertical?, autoplay? e posterUrl? (só vídeo enviado)};' +
  '{type:"button", label, action:{kind:"next"}|{kind:"goto",stepId}|{kind:"checkout",url?}, style?, sticky?}; ' +
  '{type:"options", name (a-z0-9_-, único), question?, multiple:false|true, options:[{id,label,emoji?,imageUrl?,tag? (etiqueta no contato),goto? (só escolha única),score?}]} (no máximo 1 por tela); ' +
  '{type:"field", field:"name"|"email"|"whatsapp", label, required?}; {type:"compare", before:{title,imageUrl?,items[]}, after:{...}, authorized?}; ' +
  '{type:"testimonial", quote, author, role?, imageUrl?, authorized}; {type:"checklist", title?, items[]}; {type:"countdown", deadline (ISO com fuso, prazo REAL), label}; ' +
  '{type:"loading", text, durationSec? (1 a 8), routes?:[{min?,max?,stepId}] por soma de score}; ' +
  '{type:"offer", title?, priceCents (centavos ou null), compareAtCents?, installmentsText?, bonuses?[], guaranteeDays?, guaranteeText?, deadlineText?}; ' +
  '{type:"gallery", images:[{url,alt}]}; {type:"faq", items:[{q,a}]}; {type:"spacer", size:"sm"|"md"|"lg"}. ' +
  "Onde falta dado real (preço, depoimento, número, prazo, link), deixe [colchetes]: o funil não publica enquanto houver colchete. Nunca invente preço, depoimento, aluno, número ou escassez.";

type SummaryRow = FunnelSummary;

export const FUNNEL_TOOLS: FunnelTool[] = [
  {
    name: "listar_funis",
    description: "Lista os quizzes (funis) com status (rascunho, no ar, arquivado), link público, nº de telas e números dos últimos 7 dias.",
    inputSchema: { type: "object", properties: {} },
    async run(_args, call) {
      const res = await api(call, "GET", "/api/funnels");
      if (!res.ok) return res.result;
      const rows = (Array.isArray(res.data) ? (res.data as SummaryRow[]) : []).map((f) => ({
        id: f.id,
        nome: f.name,
        slug: f.slug,
        status: f.status,
        link: link(f.slug),
        telas: f.stepCount,
        rascunhoMudou: f.hasUnpublishedChanges,
        numeros7d: { visitas: f.stats?.visits7d ?? 0, checkouts: f.stats?.checkouts7d ?? 0, leads: f.stats?.leads7d ?? 0 },
      }));
      return text(rows);
    },
  },
  {
    name: "ver_funil",
    description:
      "Mostra um quiz: rascunho completo (telas e blocos), status, o que falta pra publicar (em português) e o link de prévia do rascunho (só abre logado).",
    inputSchema: { type: "object", properties: { id: { ...str, description: "ID do funil" } }, required: ["id"] },
    async run(args, call) {
      const id = requireString(args, "id");
      if (!id) return text("Informe o id.", true);
      const res = await api(call, "GET", `/api/funnels/${encodeURIComponent(id)}`);
      if (!res.ok) return res.result;
      const f = res.data as FunnelDetail;
      return text({
        id: f.id,
        nome: f.name,
        slug: f.slug,
        status: f.status,
        versaoPublicada: f.publishedVersion,
        rascunhoMudou: f.hasUnpublishedChanges,
        link: link(f.slug),
        previa: link(f.slug, true),
        oQueFaltaPraPublicar: whatIsMissing(f),
        rascunho: f.draft,
      });
    },
  },
  {
    name: "listar_modelos_funil",
    description: "Lista os modelos prontos de quiz (id, nome, pra que serve e nº de telas). Use o id em criar_funil ou duplicar_modelo.",
    inputSchema: { type: "object", properties: {} },
    async run() {
      return text(
        FUNNEL_TEMPLATES.map((t) => ({
          id: t.id,
          nome: t.namePt,
          praQueServe: ptFunnelsApi[t.description] ?? t.description,
          telas: t.build().steps.length,
        }))
      );
    },
  },
  {
    name: "criar_funil",
    description:
      "Cria um quiz SEMPRE como RASCUNHO (nunca vai ao ar por aqui). Pode partir de um modelo (listar_modelos_funil) ou de um rascunho completo. " +
      PUBLISH_NOTE +
      " " +
      FUNNEL_DRAFT_HELP,
    inputSchema: {
      type: "object",
      properties: {
        nome: { ...str, description: "Nome do quiz" },
        slug: { ...str, description: "Endereço /q/<slug> (a-z, 0-9 e -). Ocupado ganha -2, -3..." },
        modelo: { ...str, description: "ID do modelo (opcional)" },
        rascunho: { type: "object", description: "Definição completa (opcional)" },
      },
      required: ["nome"],
    },
    async run(args, call) {
      const name = requireString(args, "nome");
      if (!name) return text("Informe o nome.", true);
      const body: Record<string, unknown> = { name };
      const slug = requireString(args, "slug");
      if (slug) body.slug = slug;
      const modelo = requireString(args, "modelo");
      if (modelo) body.templateId = modelo;
      if (args.rascunho !== undefined) body.draft = args.rascunho;
      const res = await api(call, "POST", "/api/funnels", body);
      if (!res.ok) return res.result;
      return text(created(res.data as FunnelDetail));
    },
  },
  {
    name: "duplicar_modelo",
    description:
      "Cria um quiz NOVO, como RASCUNHO, a partir de um modelo pronto (ex.: escada-sim-vsl) ou copiando o rascunho de um quiz que já existe (id do funil). " +
      PUBLISH_NOTE,
    inputSchema: {
      type: "object",
      properties: {
        modelo: { ...str, description: "ID do modelo OU id de um funil existente" },
        nome: { ...str, description: "Nome do novo quiz" },
        slug: { ...str, description: "Endereço /q/<slug> (opcional)" },
      },
      required: ["modelo", "nome"],
    },
    async run(args, call) {
      const modelo = requireString(args, "modelo");
      const name = requireString(args, "nome");
      if (!modelo || !name) return text("Informe modelo e nome.", true);
      const slug = requireString(args, "slug");
      const res = getFunnelTemplate(modelo)
        ? await api(call, "POST", "/api/funnels", { name, templateId: modelo, ...(slug ? { slug } : {}) })
        : await api(call, "POST", `/api/funnels/${encodeURIComponent(modelo)}/duplicate`, { name, ...(slug ? { slug } : {}) });
      if (!res.ok) return res.result;
      return text(created(res.data as FunnelDetail));
    },
  },
  {
    name: "editar_funil",
    description:
      "Altera o nome, o endereço ou o RASCUNHO de um quiz: manda o rascunho inteiro OU só alterações [{stepId, blockId?, set}] (merge raso no bloco; sem blockId muda title/header da tela). " +
      "Não publica: o que está no ar continua igual até o dono publicar na tela. " +
      FUNNEL_DRAFT_HELP,
    inputSchema: {
      type: "object",
      properties: {
        id: { ...str, description: "ID do funil" },
        nome: { ...str, description: "Novo nome" },
        slug: { ...str, description: "Novo endereço (só com o quiz fora do ar)" },
        rascunho: { type: "object", description: "Definição inteira nova" },
        alteracoes: {
          type: "array",
          description: "Ex.: [{\"stepId\":\"s_capa\",\"blockId\":\"b_capa_titulo\",\"set\":{\"text\":\"Novo título\"}}]",
          items: {
            type: "object",
            properties: { stepId: str, blockId: str, set: { type: "object" } },
            required: ["stepId", "set"],
          },
        },
      },
      required: ["id"],
    },
    async run(args, call) {
      const id = requireString(args, "id");
      if (!id) return text("Informe o id.", true);
      const body: Record<string, unknown> = {};
      const name = requireString(args, "nome");
      if (name) body.name = name;
      const slug = requireString(args, "slug");
      if (slug) body.slug = slug;
      if (args.rascunho !== undefined) body.draft = args.rascunho;
      if (Array.isArray(args.alteracoes)) body.patches = args.alteracoes;
      if (Object.keys(body).length === 0) return text("Nada pra alterar.", true);
      const res = await api(call, "PATCH", `/api/funnels/${encodeURIComponent(id)}`, body);
      if (!res.ok) return res.result;
      const f = res.data as FunnelDetail;
      return text({
        editado: true,
        id: f.id,
        slug: f.slug,
        status: f.status,
        publicadoContinuaNoAr: f.status === "PUBLISHED",
        rascunhoMudou: f.hasUnpublishedChanges,
        previa: link(f.slug, true),
        oQueFaltaPraPublicar: whatIsMissing(f),
      });
    },
  },
  {
    name: "ver_resultados_funil",
    description:
      "Números de um quiz no período (7, 30 ou 90 dias), sem dados pessoais: visitantes, começaram, chegaram ao fim, cliques no checkout, leads, compras e reembolsos; funil por tela com desistência; respostas por pergunta; origens.",
    inputSchema: {
      type: "object",
      properties: {
        id: { ...str, description: "ID do funil" },
        dias: { type: "integer", enum: [7, 30, 90], description: "Período (padrão 30)" },
        origem: { ...str, description: "Filtrar por utm_source (opcional)" },
      },
      required: ["id"],
    },
    async run(args, call) {
      const id = requireString(args, "id");
      if (!id) return text("Informe o id.", true);
      const q = new URLSearchParams();
      if (typeof args.dias === "number") q.set("days", String(args.dias));
      const origem = requireString(args, "origem");
      if (origem) q.set("source", origem);
      const qs = q.toString();
      const res = await api(call, "GET", `/api/funnels/${encodeURIComponent(id)}/results${qs ? `?${qs}` : ""}`);
      if (!res.ok) return res.result;
      const r = res.data as FunnelResults;
      return text({
        dias: r.days,
        origem: r.source,
        totais: {
          visitantes: r.totals.visits,
          comecaram: r.totals.started,
          chegaramAoFim: r.totals.completed,
          cliquesNoCheckout: r.totals.checkouts,
          leads: r.totals.leads,
          compras: r.totals.purchases,
          reembolsos: r.totals.refunds,
        },
        porTela: r.steps.map((s) => ({
          tela: s.index + 1,
          titulo: s.title,
          visitas: s.views,
          pctDoInicio: s.pctOfFirst,
          desistenciaDaAnterior: s.dropFromPrev,
        })),
        respostas: r.answers.map((a) => ({ pergunta: a.question, opcoes: a.options.map((o) => ({ opcao: o.label, vezes: o.count })) })),
        origens: r.sources.map((s) => ({ origem: s.source, visitas: s.visits, checkouts: s.checkouts, compras: s.purchases })),
      });
    },
  },
];

function created(f: FunnelDetail) {
  return {
    criado: true,
    status: f.status ?? "DRAFT",
    publicado: f.status === "PUBLISHED",
    id: f.id,
    nome: f.name,
    slug: f.slug,
    telas: f.stepCount,
    previa: link(f.slug, true),
    oQueFaltaPraPublicar: whatIsMissing(f),
    aviso: PUBLISH_NOTE,
  };
}
