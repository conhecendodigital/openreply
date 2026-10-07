/**
 * Minimal MCP (Model Context Protocol) server over JSON-RPC, served statelessly
 * from /api/mcp. Every tool goes through the existing API routes via `call`, so
 * validation, workspace scoping and Meta error handling stay in one place.
 */

import { AUTOMATION_TRIGGERS, triggerLabel, type AutomationTriggerValue } from "@/lib/automations/trigger";
import { FUNNEL_TOOLS } from "@/lib/mcp/funnel-tools";

export type InternalCall = (
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  body?: unknown
) => Promise<{ status: number; json: unknown }>;

type JsonRpcId = string | number | null;

export type JsonRpcMessage = {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: Record<string, unknown>;
};

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

type Tool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (args: Record<string, unknown>, call: InternalCall) => Promise<ToolResult>;
};

export const MCP_PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "openreply", version: "0.1.0" };

const str = { type: "string" };
const bool = { type: "boolean" };
const strList = { type: "array", items: { type: "string" } };

// Campaign fields accepted by POST/PATCH /api/automations. `isActive` is left
// out on purpose: campaigns are created paused and only a human turns them on
// in the app (the API answers 403 human_only to any key).
const campaignFields: Record<string, unknown> = {
  name: { ...str, description: "Nome interno da automação" },
  goal: { ...str, description: "Objetivo, em uma frase" },
  trigger: {
    type: "string",
    enum: [...AUTOMATION_TRIGGERS],
    description:
      "O que dispara: COMMENT = comentário em post (padrão); DM = mensagem no Direct com a palavra; " +
      "STORY_REPLY = resposta de story com a palavra; STORY_MENTION = quando te marcam no story (sem palavra); " +
      "LIVE_COMMENT = comentário com a palavra em qualquer live (só DM, sem resposta pública)",
  },
  storyId: { ...str, description: "Só STORY_REPLY: ID do story (vazio = qualquer story)" },
  storyUrl: { ...str, description: "Só STORY_REPLY: link do story escolhido" },
  postId: { ...str, description: "ID do post (quando é um post específico)" },
  postUrl: { ...str, description: "Link do post (quando é um post específico)" },
  matchAnyPost: { ...bool, description: "Dispara em qualquer post" },
  pendingNextReel: { ...bool, description: "Dispara no próximo Reel publicado" },
  keywords: { ...strList, description: "Palavras-chave (até 10)" },
  matchAnyWord: { ...bool, description: "Dispara com qualquer comentário" },
  wholeWordMatch: { ...bool, description: "Só palavra inteira (padrão true)" },
  dmTriggerEnabled: { ...bool, description: "Também dispara quando a palavra chega por DM" },
  dmMessage: { ...str, description: "Mensagem que entrega o link. {username} vira o @ da pessoa; {link} marca onde o link entra no formato text" },
  dmFormat: {
    type: "string",
    enum: ["button", "text"],
    description:
      "Formato da DM com o link. text = texto com o link clicável dentro (aparece pra todo mundo, inclusive em Solicitações; " +
      "sem {link} o link vai no fim, numa linha própria; o segundo link vai na linha de baixo com o rótulo). " +
      "button = cartão com botão (mais bonito, mas em algumas versões do Instagram não aparece). " +
      "Na criação, o padrão é text. Mudar exige a automação desligada, igual aos textos e links. " +
      "DM de abertura e pedido pra seguir continuam com botão.",
  },
  trackedDestinationUrl: { ...str, description: "URL do botão de link (com contagem de cliques)" },
  linkButtonLabel: { ...str, description: "Texto do botão de link (até 20 caracteres)" },
  secondaryDestinationUrl: { ...str, description: "URL de um segundo botão" },
  secondaryButtonLabel: { ...str, description: "Texto do segundo botão" },
  openingDmEnabled: { ...bool, description: "Manda antes uma DM de abertura com botão" },
  openingDmMessage: { ...str, description: "Texto da DM de abertura (sem link)" },
  openingDmButtonLabel: { ...str, description: "Botão da DM de abertura" },
  requireFollow: { ...bool, description: "Só entrega o link pra quem segue" },
  followPromptMessage: { ...str, description: "Pedido pra seguir antes do link" },
  followPromptButtonLabel: { ...str, description: "Botão do pedido pra seguir" },
  followUpEnabled: { ...bool, description: "Manda uma mensagem depois do link" },
  followUpMessage: { ...str, description: "Texto da mensagem depois do link" },
  followUpDelayMinutes: { type: "integer", description: "Minutos até a mensagem depois do link (0 a 1440)" },
  publicReplyEnabled: { ...bool, description: "Responde em público no comentário" },
  publicReplyMessages: { ...strList, description: "Respostas públicas (sorteia uma por vez)" },
};

function text(value: unknown, isError = false): ToolResult {
  return {
    content: [
      {
        type: "text",
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
    ...(isError ? { isError: true } : {}),
  };
}

type ApiEnvelope = { success?: boolean; data?: unknown; error?: unknown; details?: unknown };

async function api(
  call: InternalCall,
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  body?: unknown
): Promise<{ ok: true; data: unknown } | { ok: false; result: ToolResult }> {
  const { status, json } = await call(method, path, body);
  const envelope = (json ?? {}) as ApiEnvelope;
  if (status >= 400 || envelope.success === false) {
    return {
      ok: false,
      result: text(
        { status, error: envelope.error ?? "Request failed", details: envelope.details },
        true
      ),
    };
  }
  return { ok: true, data: envelope.data ?? json };
}

function pick(args: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(
    Object.entries(args).filter(([key, value]) => keys.includes(key) && value !== undefined)
  );
}

function requireString(args: Record<string, unknown>, key: string): string | null {
  const value = args[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

type CampaignRow = {
  id: string;
  name: string;
  isActive: boolean;
  keywords: string[];
  matchAnyPost: boolean;
  matchAnyWord: boolean;
  dmTriggerEnabled: boolean;
  postUrl: string | null;
  trigger?: AutomationTriggerValue;
  storyId?: string | null;
  dmFormat?: string;
  analytics?: unknown;
  trackedLinks?: { trackedUrl?: string; destinationUrl: string; _count?: { clicks: number } }[];
};

const campaignKeys = Object.keys(campaignFields);

type FlowSummaryRow = {
  id: string;
  name: string;
  isActive: boolean;
  published: boolean;
  publishedVersion: number;
  hasUnpublishedChanges: boolean;
  trigger: { type: string; label: string; keywords: string[] } | null;
  nodeCount: number;
  stats?: { entered: number; completed: number; open: number };
  sourceAutomationId: string | null;
};

const FLOW_DRAFT_HELP =
  "Rascunho = { trigger: { type, postId?, matchAnyPost?, storyId?, conversationLinkId?, keywords[], matchAnyWord, wholeWordMatch, next }, nodes: [...] }. " +
  'Nós: {id, type:"message", text, imageUrl?, buttons:[{id,label,kind:"link",url} | {id,label,kind:"next",next}] (até 3), next?}; ' +
  '{id, type:"condition", check:{kind:"follows"}|{kind:"has_tag",tag}|{kind:"clicked",nodeId?}, yes, no}; ' +
  '{id, type:"action", action:{kind:"add_tag"|"remove_tag",tag}|{kind:"notify_owner",note?}|{kind:"propose_draft",text,reason?}|{kind:"handoff",hours?}, next?}; ' +
  '{id, type:"wait", mode:"delay", minutes, next} | {id, type:"wait", mode:"reply", timeoutMinutes?, next, onTimeout?}; {id, type:"end"}. ' +
  "Variáveis no texto: {username} e {first_name}. Rascunho de resposta (propose_draft) nunca é enviado sem aprovação humana.";

export const TOOLS: Tool[] = [
  {
    name: "listar_automacoes",
    description:
      "Lista as automações (campanhas) com status, palavras-chave, DMs enviadas, cliques e CTR.",
    inputSchema: { type: "object", properties: {} },
    async run(_args, call) {
      const res = await api(call, "GET", "/api/automations");
      if (!res.ok) return res.result;
      const rows = (res.data as CampaignRow[]).map((a) => ({
        id: a.id,
        nome: a.name,
        ligada: a.isActive,
        gatilho: triggerLabel(a),
        palavras:
          a.trigger === "STORY_MENTION"
            ? "sem palavra (menção)"
            : a.matchAnyWord
              ? a.trigger === "DM" || a.trigger === "STORY_REPLY"
                ? "qualquer mensagem"
                : "qualquer comentário"
              : a.keywords,
        tambemPorDm: (a.trigger ?? "COMMENT") === "COMMENT" ? a.dmTriggerEnabled : a.trigger === "DM",
        formatoDm: a.dmFormat === "TEXT" ? "text" : "button",
        numeros: a.analytics,
        links: (a.trackedLinks ?? []).map((l) => ({
          destino: l.destinationUrl,
          cliques: l._count?.clicks ?? 0,
        })),
      }));
      return text(rows);
    },
  },
  {
    name: "ver_automacao",
    description: "Mostra todos os campos e textos de uma automação.",
    inputSchema: {
      type: "object",
      properties: { id: { ...str, description: "ID da automação" } },
      required: ["id"],
    },
    async run(args, call) {
      const id = requireString(args, "id");
      if (!id) return text("Informe o id.", true);
      const res = await api(call, "GET", "/api/automations");
      if (!res.ok) return res.result;
      const found = (res.data as CampaignRow[]).find((a) => a.id === id);
      return found ? text(found) : text("Automação não encontrada.", true);
    },
  },
  {
    name: "criar_automacao",
    description:
      "Cria uma automação SEMPRE DESLIGADA. Quem liga é o dono, no Lead Engine.",
    inputSchema: {
      type: "object",
      properties: campaignFields,
      required: ["name", "dmMessage"],
    },
    async run(args, call) {
      // Automação nova sai em texto com link (aparece em qualquer Instagram),
      // igual à tela; quem quiser o cartão manda dmFormat: "button".
      const body: Record<string, unknown> = { dmFormat: "text", ...pick(args, campaignKeys), isActive: false };
      if (Array.isArray(body.publicReplyMessages) && body.publicReplyEnabled === undefined) {
        body.publicReplyEnabled = body.publicReplyMessages.length > 0;
      }
      const res = await api(call, "POST", "/api/automations", body);
      if (!res.ok) return res.result;
      const created = res.data as { id: string; name: string };
      return text({ criada: true, ligada: false, id: created.id, nome: created.name });
    },
  },
  {
    name: "editar_automacao",
    description:
      "Altera campos ou textos de uma automação DESLIGADA (ligada, só nome e objetivo). Não liga nem desliga (desligar: desativar_automacao).",
    inputSchema: {
      type: "object",
      properties: { id: { ...str, description: "ID da automação" }, ...campaignFields },
      required: ["id"],
    },
    async run(args, call) {
      const id = requireString(args, "id");
      if (!id) return text("Informe o id.", true);
      const body = pick(args, campaignKeys);
      if (Object.keys(body).length === 0) return text("Nada pra alterar.", true);
      const res = await api(call, "PATCH", `/api/automations?id=${encodeURIComponent(id)}`, body);
      if (!res.ok) return res.result;
      return text({ editada: true, id, campos: Object.keys(body) });
    },
  },
  {
    name: "ativar_automacao",
    description:
      "Não liga nada: ligar uma automação é sempre do dono, no Lead Engine. Devolve o caminho pra ele ligar.",
    inputSchema: {
      type: "object",
      properties: { id: { ...str, description: "ID da automação" } },
      required: ["id"],
    },
    // Owner's rule: the AI never turns a campaign on. The API refuses it for
    // any key (403 human_only); this tool only tells where a human does it.
    async run(args) {
      const id = requireString(args, "id");
      if (!id) return text("Informe o id.", true);
      return text(
        {
          id,
          ligada: false,
          aviso: "Chave de API não liga automação. Peça pro dono ligar no Lead Engine.",
          caminho: `/campaigns/${encodeURIComponent(id)}`,
        },
        true
      );
    },
  },
  {
    name: "desativar_automacao",
    description: "DESLIGA uma automação. Ela para de responder na hora.",
    inputSchema: {
      type: "object",
      properties: { id: { ...str, description: "ID da automação" } },
      required: ["id"],
    },
    async run(args, call) {
      const id = requireString(args, "id");
      if (!id) return text("Informe o id.", true);
      const res = await api(call, "PATCH", `/api/automations?id=${encodeURIComponent(id)}`, {
        isActive: false,
      });
      if (!res.ok) return res.result;
      return text({ id, ligada: false });
    },
  },
  {
    name: "ver_envios",
    description:
      "Histórico de DMs que as automações mandaram (quem comentou, palavra, status, erro).",
    inputSchema: {
      type: "object",
      properties: {
        status: { ...str, description: "Filtro: SENT, FAILED, PENDING ou um SKIPPED_*" },
        limit: { type: "integer", description: "Quantos (até 50, padrão 20)" },
        page: { type: "integer", description: "Página (padrão 1)" },
      },
    },
    async run(args, call) {
      const params = new URLSearchParams();
      for (const key of ["status", "limit", "page"]) {
        if (args[key] !== undefined) params.set(key, String(args[key]));
      }
      const query = params.toString();
      const res = await api(call, "GET", `/api/logs${query ? `?${query}` : ""}`);
      if (!res.ok) return res.result;
      return text(res.data);
    },
  },
  {
    name: "analisar_posts",
    description:
      "Posts do perfil com métricas (views, alcance, curtidas, comentários, salvamentos, compartilhamentos) e totais. Legenda cortada em 120 caracteres; use listar_posts pra legenda inteira.",
    inputSchema: {
      type: "object",
      properties: {
        quantidade: {
          description: 'Últimos N posts (padrão 50) ou "all" pra todos (até 500)',
          oneOf: [{ type: "integer" }, { type: "string", enum: ["all"] }],
        },
      },
    },
    async run(args, call) {
      const q = args.quantidade === "all" ? "all" : String(Number(args.quantidade) || 50);
      const res = await api(call, "GET", `/api/instagram/overview?count=${q}`);
      if (!res.ok) return res.result;
      return text(res.data);
    },
  },
  {
    name: "listar_posts",
    description:
      "Posts do perfil com legenda inteira, link, tipo, data e link da imagem/capa (pra ler e ver o conteúdo).",
    inputSchema: {
      type: "object",
      properties: {
        todos: { ...bool, description: "true = biblioteca inteira (até 300); senão os mais recentes" },
        limite: { type: "integer", description: "Quantos recentes (1 a 50, padrão 25)" },
      },
    },
    async run(args, call) {
      const query = args.todos === true ? "all=true" : `limit=${Number(args.limite) || 25}`;
      const res = await api(call, "GET", `/api/instagram/posts?${query}`);
      if (!res.ok) return res.result;
      return text(res.data);
    },
  },
  {
    name: "listar_conversas",
    description:
      "Lista as conversas da DM com a última mensagem de cada uma. DM em cartão (botão) mostra o texto de dentro do cartão.",
    inputSchema: { type: "object", properties: {} },
    async run(_args, call) {
      const res = await api(call, "GET", "/api/instagram/conversations");
      if (!res.ok) return res.result;
      return text(res.data);
    },
  },
  {
    name: "ler_conversa",
    description: "As 20 mensagens mais recentes de uma conversa, em ordem.",
    inputSchema: {
      type: "object",
      properties: { conversationId: { ...str, description: "ID da conversa (de listar_conversas)" } },
      required: ["conversationId"],
    },
    async run(args, call) {
      const id = requireString(args, "conversationId");
      if (!id) return text("Informe o conversationId.", true);
      const res = await api(call, "GET", `/api/instagram/conversations/${encodeURIComponent(id)}`);
      if (!res.ok) return res.result;
      return text(res.data);
    },
  },
  // ─── Moderação de comentários ─────────────────────────────────────────────
  {
    name: "ver_moderacao",
    description:
      "Mostra a configuração da moderação de comentários (modo, categorias, palavras) e os 20 registros mais recentes.",
    inputSchema: {
      type: "object",
      properties: { instagramAccountId: { ...str, description: "Conta (padrão: a conectada)" } },
    },
    async run(args, call) {
      const account = requireString(args, "instagramAccountId");
      const q = account ? `?instagramAccountId=${encodeURIComponent(account)}` : "";
      const settings = await api(call, "GET", `/api/moderation/settings${q}`);
      if (!settings.ok) return settings.result;
      const log = await api(
        call,
        "GET",
        `/api/moderation/log?limit=20${account ? `&instagramAccountId=${encodeURIComponent(account)}` : ""}`
      );
      if (!log.ok) return log.result;
      return text({ configuracao: settings.data, registros: log.data });
    },
  },
  {
    name: "listar_moderados",
    description:
      "Registros da moderação: comentários que foram escondidos, que seriam escondidos (modo observar), protegidos, restaurados ou que falharam.",
    inputSchema: {
      type: "object",
      properties: {
        acao: {
          type: "string",
          enum: ["HIDDEN", "WOULD_HIDE", "SKIPPED_PROTECTED", "RESTORED", "FAILED"],
          description: "Filtro pela ação",
        },
        limite: { type: "integer", description: "Quantos (até 100, padrão 20)" },
        pagina: { type: "integer", description: "Página (padrão 1)" },
      },
    },
    async run(args, call) {
      const params = new URLSearchParams();
      if (typeof args.acao === "string") params.set("action", args.acao);
      if (args.limite !== undefined) params.set("limit", String(args.limite));
      if (args.pagina !== undefined) params.set("page", String(args.pagina));
      const res = await api(call, "GET", `/api/moderation/log?${params.toString()}`);
      if (!res.ok) return res.result;
      return text(res.data);
    },
  },
  {
    name: "testar_moderacao",
    description:
      "Testa um texto de comentário nas regras de moderação, sem gravar nada e sem mexer no Instagram.",
    inputSchema: {
      type: "object",
      properties: { texto: { ...str, description: "Texto do comentário" } },
      required: ["texto"],
    },
    async run(args, call) {
      const texto = requireString(args, "texto");
      if (!texto) return text("Informe o texto.", true);
      const res = await api(call, "POST", "/api/moderation/test", { text: texto });
      if (!res.ok) return res.result;
      return text(res.data);
    },
  },
  {
    name: "configurar_moderacao",
    description:
      'Muda a moderação de comentários. Só use com o ok do dono da conta. O modo "esconder" passa a esconder comentários de verdade e exige confirmar: true.',
    inputSchema: {
      type: "object",
      properties: {
        modo: {
          type: "string",
          enum: ["desligado", "observar", "esconder"],
          description: "desligado | observar (só registra) | esconder",
        },
        categorias: {
          type: "array",
          items: { type: "string", enum: ["spam_link", "scam", "politics", "offense"] },
          description: "Categorias prontas ligadas (lista completa)",
        },
        termosBloqueados: { ...strList, description: "Palavras/expressões que sempre marcam o comentário (lista completa)" },
        termosPermitidos: { ...strList, description: "Se o comentário tiver uma dessas, nunca é escondido (lista completa)" },
        usarJev: { ...bool, description: "Pedir a opinião do Jev quando as regras não acham nada" },
        confiancaMinimaJev: { type: "number", description: "0.5 a 1 (padrão 0.8)" },
        confirmar: { ...bool, description: 'Obrigatório (true) para o modo "esconder"' },
        instagramAccountId: { ...str, description: "Conta (padrão: a conectada)" },
      },
    },
    async run(args, call) {
      const modes: Record<string, string> = { desligado: "OFF", observar: "OBSERVE", esconder: "HIDE" };
      const body: Record<string, unknown> = {};
      if (args.modo !== undefined) {
        const mode = typeof args.modo === "string" ? modes[args.modo] : undefined;
        if (!mode) return text('modo deve ser "desligado", "observar" ou "esconder".', true);
        if (mode === "HIDE" && args.confirmar !== true) {
          return text(
            'Recusado: o modo "esconder" esconde comentários de pessoas reais. Peça o ok do dono da conta e mande confirmar: true.',
            true
          );
        }
        body.mode = mode;
      }
      if (Array.isArray(args.categorias)) body.categories = args.categorias;
      if (Array.isArray(args.termosBloqueados)) body.blockedTerms = args.termosBloqueados;
      if (Array.isArray(args.termosPermitidos)) body.allowedTerms = args.termosPermitidos;
      if (typeof args.usarJev === "boolean") body.useJev = args.usarJev;
      if (typeof args.confiancaMinimaJev === "number") body.jevMinConfidence = args.confiancaMinimaJev;
      if (Object.keys(body).length === 0) return text("Nada pra alterar.", true);
      const account = requireString(args, "instagramAccountId");
      if (account) body.instagramAccountId = account;
      const res = await api(call, "PATCH", "/api/moderation/settings", body);
      if (!res.ok) return res.result;
      return text({ salvo: true, configuracao: res.data });
    },
  },
  {
    name: "restaurar_comentario",
    description:
      "Desesconde no Instagram um comentário que a moderação escondeu. Use o id do registro (de listar_moderados).",
    inputSchema: {
      type: "object",
      properties: { id: { ...str, description: "ID do registro de moderação" } },
      required: ["id"],
    },
    async run(args, call) {
      const id = requireString(args, "id");
      if (!id) return text("Informe o id.", true);
      const res = await api(call, "POST", `/api/moderation/log/${encodeURIComponent(id)}/restore`);
      if (!res.ok) return res.result;
      return text({ restaurado: true, id });
    },
  },
  {
    name: "esconder_comentario",
    description:
      "Esconde agora um comentário que a moderação já registrou (ex.: um \"esconderia\" do modo observar). Só aceita id de registro, nunca um comentário qualquer. Só com o ok do dono da conta: exige confirmar: true.",
    inputSchema: {
      type: "object",
      properties: {
        id: { ...str, description: "ID do registro de moderação" },
        confirmar: { ...bool, description: "Obrigatório: true" },
      },
      required: ["id", "confirmar"],
    },
    async run(args, call) {
      const id = requireString(args, "id");
      if (!id) return text("Informe o id.", true);
      if (args.confirmar !== true) {
        return text("Recusado: esconder um comentário exige o ok do dono da conta (confirmar: true).", true);
      }
      const res = await api(call, "POST", `/api/moderation/log/${encodeURIComponent(id)}/hide`);
      if (!res.ok) return res.result;
      return text({ escondido: true, id });
    },
  },

  // ─── Contatos (CRM) ───────────────────────────────────────────────────────
  {
    name: "listar_contatos",
    description:
      "Lista os contatos (quem comentou, mandou DM ou clicou) com etiquetas e contadores. Busca por @ ou nome e filtra por etiqueta.",
    inputSchema: {
      type: "object",
      properties: {
        busca: { ...str, description: "@username ou nome" },
        etiqueta: { ...str, description: 'Etiqueta exata, ex.: "comentou:FOTO", "clicou"' },
        ordem: {
          type: "string",
          enum: ["lastSeen", "first", "comments", "clicks", "dms"],
          description: "Ordenação (padrão: visto por último)",
        },
        limite: { type: "integer", description: "Quantos (até 100, padrão 30)" },
        pagina: { type: "integer", description: "Página (padrão 1)" },
      },
    },
    async run(args, call) {
      const params = new URLSearchParams();
      const map: Record<string, string> = {
        busca: "q",
        etiqueta: "tag",
        ordem: "sort",
        limite: "limit",
        pagina: "page",
      };
      for (const [from, to] of Object.entries(map)) {
        if (args[from] !== undefined && args[from] !== "") params.set(to, String(args[from]));
      }
      const res = await api(call, "GET", `/api/contacts?${params.toString()}`);
      if (!res.ok) return res.result;
      return text(res.data);
    },
  },
  {
    name: "ver_contato",
    description: "Mostra um contato com etiquetas, nota, contadores e a linha do tempo (comentários, DMs, campanhas, cliques).",
    inputSchema: {
      type: "object",
      properties: {
        id: { ...str, description: "ID do contato (de listar_contatos)" },
        antes: { ...str, description: "Cursor pra eventos mais antigos (nextCursor)" },
      },
      required: ["id"],
    },
    async run(args, call) {
      const id = requireString(args, "id");
      if (!id) return text("Informe o id.", true);
      const before = requireString(args, "antes");
      const res = await api(
        call,
        "GET",
        `/api/contacts/${encodeURIComponent(id)}${before ? `?before=${encodeURIComponent(before)}` : ""}`
      );
      if (!res.ok) return res.result;
      return text(res.data);
    },
  },
  {
    name: "listar_etiquetas",
    description: "Todas as etiquetas em uso, com quantos contatos têm cada uma.",
    inputSchema: { type: "object", properties: {} },
    async run(_args, call) {
      const res = await api(call, "GET", "/api/contacts/tags");
      if (!res.ok) return res.result;
      return text(res.data);
    },
  },
  {
    name: "etiquetar_contato",
    description: "Adiciona e/ou remove etiquetas manuais de um contato. Não manda nada pra pessoa.",
    inputSchema: {
      type: "object",
      properties: {
        id: { ...str, description: "ID do contato" },
        adicionar: { ...strList, description: "Etiquetas pra adicionar" },
        remover: { ...strList, description: "Etiquetas pra remover" },
      },
      required: ["id"],
    },
    async run(args, call) {
      const id = requireString(args, "id");
      if (!id) return text("Informe o id.", true);
      const body: Record<string, unknown> = {};
      if (Array.isArray(args.adicionar)) body.add = args.adicionar;
      if (Array.isArray(args.remover)) body.remove = args.remover;
      if (Object.keys(body).length === 0) return text("Informe adicionar ou remover.", true);
      const res = await api(call, "POST", `/api/contacts/${encodeURIComponent(id)}/tags`, body);
      if (!res.ok) return res.result;
      return text(res.data);
    },
  },
  {
    name: "anotar_contato",
    description: "Salva (ou apaga, com nota vazia) a nota interna de um contato. Não manda nada pra pessoa.",
    inputSchema: {
      type: "object",
      properties: {
        id: { ...str, description: "ID do contato" },
        nota: { ...str, description: "Texto da nota" },
      },
      required: ["id", "nota"],
    },
    async run(args, call) {
      const id = requireString(args, "id");
      if (!id) return text("Informe o id.", true);
      const nota = typeof args.nota === "string" ? args.nota : "";
      const res = await api(call, "PATCH", `/api/contacts/${encodeURIComponent(id)}`, {
        notes: nota.trim() ? nota : null,
      });
      if (!res.ok) return res.result;
      return text({ salvo: true, id });
    },
  },

  // ─── Rascunhos (vendedor) — DM escrita por IA nunca sai sem aprovação ─────
  {
    name: "listar_dms_sem_resposta",
    description:
      "Pessoas que mandaram DM e ainda não têm resposta nossa, com etiquetas, últimas mensagens e quantas horas faltam da janela de 24 h. Nunca lista quem o Matheus assumiu. Pula quem só encerrou a conversa (obrigado, recebi, amém, emoji, coração no story): essas não precisam de rascunho.",
    inputSchema: {
      type: "object",
      properties: {
        limite: { type: "integer", description: "Quantas (até 50, padrão 20)" },
        incluirJanelaFechada: { ...bool, description: "true = também quem já passou das 24 h (não dá pra responder pela API)" },
        incluirEncerradas: { ...bool, description: "true = também quem só agradeceu ou mandou emoji (normalmente não precisa)" },
      },
    },
    async run(args, call) {
      const params = new URLSearchParams();
      if (args.limite !== undefined) params.set("limite", String(args.limite));
      if (args.incluirJanelaFechada === true) params.set("incluirFechadas", "true");
      if (args.incluirEncerradas === true) params.set("todas", "true");
      const res = await api(call, "GET", `/api/inbox/unanswered?${params.toString()}`);
      if (!res.ok) return res.result;
      return text(res.data);
    },
  },
  {
    name: "propor_resposta",
    description:
      "Cria um RASCUNHO de resposta pra uma pessoa. NÃO ENVIA NADA: o rascunho fica esperando o Matheus aprovar (no Lead Engine ou no botão do Telegram). Um rascunho pendente por pessoa; recusa se a janela de 24 h fechou ou se o Matheus assumiu a conversa.",
    inputSchema: {
      type: "object",
      properties: {
        contactId: { ...str, description: "ID do contato (de listar_dms_sem_resposta)" },
        texto: { ...str, description: "Texto da resposta (até 1000 caracteres)" },
        motivo: { ...str, description: "Por que essa resposta (o Matheus lê antes de aprovar)" },
        baseadoEmMid: { ...str, description: "mid da DM que você está respondendo (opcional)" },
      },
      required: ["contactId", "texto", "motivo"],
    },
    async run(args, call) {
      const contactId = requireString(args, "contactId");
      const texto = requireString(args, "texto");
      if (!contactId || !texto) return text("Informe contactId e texto.", true);
      const res = await api(call, "POST", "/api/drafts", {
        contactId,
        text: texto,
        reason: requireString(args, "motivo"),
        basedOnMid: requireString(args, "baseadoEmMid"),
        origin: "vendedor",
      });
      if (!res.ok) return res.result;
      return text({
        rascunhoCriado: true,
        enviado: false,
        aviso: "Rascunho criado, NADA foi enviado. Só sai quando um humano aprovar.",
        rascunho: res.data,
      });
    },
  },
  {
    name: "listar_rascunhos",
    description: "Lista os rascunhos (padrão: os pendentes) com o contexto de cada pessoa.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["PENDING", "SENT", "EXPIRED", "REJECTED", "FAILED", "APPROVED", "all"],
          description: "Filtro (padrão PENDING)",
        },
        limite: { type: "integer", description: "Quantos (até 100, padrão 30)" },
      },
    },
    async run(args, call) {
      const params = new URLSearchParams();
      if (typeof args.status === "string") params.set("status", args.status);
      if (args.limite !== undefined) params.set("limit", String(args.limite));
      const res = await api(call, "GET", `/api/drafts?${params.toString()}`);
      if (!res.ok) return res.result;
      return text(res.data);
    },
  },
  {
    name: "editar_rascunho",
    description: "Troca o texto (ou o motivo) de um rascunho pendente. Não envia.",
    inputSchema: {
      type: "object",
      properties: {
        id: { ...str, description: "ID do rascunho" },
        texto: { ...str, description: "Novo texto" },
        motivo: { ...str, description: "Novo motivo" },
      },
      required: ["id"],
    },
    async run(args, call) {
      const id = requireString(args, "id");
      if (!id) return text("Informe o id.", true);
      const body: Record<string, unknown> = {};
      const texto = requireString(args, "texto");
      if (texto) body.text = texto;
      if (typeof args.motivo === "string") body.reason = args.motivo;
      if (Object.keys(body).length === 0) return text("Nada pra alterar.", true);
      const res = await api(call, "PATCH", `/api/drafts/${encodeURIComponent(id)}`, body);
      if (!res.ok) return res.result;
      return text({ editado: true, id, enviado: false });
    },
  },
  {
    name: "aprovar_rascunho",
    description:
      "ENVIA um rascunho de verdade pela API do Instagram. Só com o ok explícito do Matheus: exige aprovadoPor (quem aprovou, ex.: \"Matheus via Telegram\") e confirmar: true, e a chave precisa ter a permissão drafts:approve (a chave do vendedor não tem). Se a janela de 24 h fechou, o rascunho vira EXPIRADO e nada é enviado.",
    inputSchema: {
      type: "object",
      properties: {
        id: { ...str, description: "ID do rascunho" },
        aprovadoPor: { ...str, description: "Quem aprovou (obrigatório)" },
        confirmar: { ...bool, description: "Obrigatório: true" },
        textoAprovado: {
          ...str,
          description:
            "Obrigatório: o texto exato que o Matheus viu e aprovou. Se o rascunho mudou depois, nada é enviado.",
        },
      },
      required: ["id", "aprovadoPor", "confirmar", "textoAprovado"],
    },
    async run(args, call) {
      const id = requireString(args, "id");
      const aprovadoPor = requireString(args, "aprovadoPor");
      const textoAprovado = requireString(args, "textoAprovado");
      if (!id) return text("Informe o id.", true);
      if (!aprovadoPor || args.confirmar !== true || !textoAprovado) {
        return text(
          "Recusado: enviar um rascunho exige a aprovação explícita do Matheus (aprovadoPor, confirmar: true e textoAprovado, o texto que ele viu). Nada foi enviado.",
          true
        );
      }
      const res = await api(call, "POST", `/api/drafts/${encodeURIComponent(id)}/approve`, {
        aprovadoPor,
        confirmar: true,
        textoAprovado,
      });
      if (!res.ok) return res.result;
      return text({ enviado: true, rascunho: res.data });
    },
  },
  {
    name: "descartar_rascunho",
    description: "Descarta um rascunho pendente. Nada é enviado.",
    inputSchema: {
      type: "object",
      properties: { id: { ...str, description: "ID do rascunho" } },
      required: ["id"],
    },
    async run(args, call) {
      const id = requireString(args, "id");
      if (!id) return text("Informe o id.", true);
      const res = await api(call, "POST", `/api/drafts/${encodeURIComponent(id)}/reject`);
      if (!res.ok) return res.result;
      return text({ descartado: true, id });
    },
  },
  {
    name: "assumir_conversa",
    description:
      "O Matheus assume a conversa com uma pessoa: nenhuma automação, sequência ou rascunho do vendedor fala com ela até devolver (ou até passar o prazo, padrão 24 h).",
    inputSchema: {
      type: "object",
      properties: {
        contactId: { ...str, description: "ID do contato" },
        horas: { type: "integer", description: "Por quantas horas (1 a 168, padrão o da conta: 24)" },
      },
      required: ["contactId"],
    },
    async run(args, call) {
      const contactId = requireString(args, "contactId");
      if (!contactId) return text("Informe o contactId.", true);
      const body: Record<string, unknown> = { on: true };
      if (args.horas !== undefined) body.hours = Number(args.horas);
      const res = await api(call, "POST", `/api/contacts/${encodeURIComponent(contactId)}/takeover`, body);
      if (!res.ok) return res.result;
      return text(res.data);
    },
  },
  {
    name: "devolver_conversa",
    description:
      "Devolve a conversa pro robô: as automações voltam a responder essa pessoa. Só um humano devolve: a chave precisa da permissão drafts:approve (a chave do vendedor não tem).",
    inputSchema: {
      type: "object",
      properties: { contactId: { ...str, description: "ID do contato" } },
      required: ["contactId"],
    },
    async run(args, call) {
      const contactId = requireString(args, "contactId");
      if (!contactId) return text("Informe o contactId.", true);
      const res = await api(call, "POST", `/api/contacts/${encodeURIComponent(contactId)}/takeover`, { on: false });
      if (!res.ok) return res.result;
      return text(res.data);
    },
  },

  // ─── Canais ───────────────────────────────────────────────────────────────
  {
    name: "ver_canais",
    description:
      "Mostra os canais ligados (só leitura): status de cada Instagram (Conectado / Precisa reconectar / Desconectado), token vence em, webhooks assinados, último aviso recebido, campanhas ligadas, modo da moderação, contatos, rascunhos pendentes e alertas. Não liga, não desliga e não apaga nada.",
    inputSchema: { type: "object", properties: {} },
    async run(_args, call) {
      const res = await api(call, "GET", "/api/channels");
      if (!res.ok) return res.result;
      const data = res.data as {
        instagram?: {
          id: string;
          username: string;
          status: string;
          tokenExpiresAt: string | null;
          tokenExpiresInDays: number | null;
          webhookSubscribed: boolean;
          webhookFields: string[];
          lastWebhookAt: string | null;
          webhooksStale: boolean;
          lastError: string | null;
          campaigns: { active: number; total: number };
          moderationMode: string;
          contacts: number;
          pendingDrafts: number;
          alerts: { message: string }[];
        }[];
        comingSoon?: { name: string; requirements: string[] }[];
        needsAttention?: boolean;
      };
      const STATUS: Record<string, string> = {
        ACTIVE: "Conectado",
        NEEDS_RECONNECT: "Precisa reconectar",
        DISCONNECTED: "Desconectado",
      };
      return text({
        precisaAtencao: Boolean(data.needsAttention),
        instagram: (data.instagram ?? []).map((c) => ({
          id: c.id,
          conta: `@${c.username}`,
          status: STATUS[c.status] ?? c.status,
          tokenVenceEm: c.tokenExpiresAt,
          diasAteVencer: c.tokenExpiresInDays,
          webhooksAssinados: c.webhookSubscribed ? c.webhookFields : [],
          ultimoAviso: c.lastWebhookAt,
          avisosParados: c.webhooksStale,
          ultimoErro: c.lastError,
          campanhas: { ligadas: c.campaigns.active, total: c.campaigns.total },
          moderacao: c.moderationMode,
          contatos: c.contacts,
          rascunhosPendentes: c.pendingDrafts,
          alertas: c.alerts.map((a) => a.message),
        })),
        emBreve: (data.comingSoon ?? []).map((c) => ({ canal: c.name, falta: c.requirements })),
      });
    },
  },
  // ─── Links de conversa (ig.me) ────────────────────────────────────────────
  {
    name: "listar_links_conversa",
    description: "Links ig.me/m/...?ref= com origem, campanha, etiqueta, cliques, aberturas e pessoas.",
    inputSchema: { type: "object", properties: {} },
    async run(_args, call) {
      const res = await api(call, "GET", "/api/conversation-links");
      if (!res.ok) return res.result;
      return text(res.data);
    },
  },
  {
    name: "criar_link_conversa",
    description:
      "Cria um link https://ig.me/m/<conta>?ref=<código> pra story, bio ou página. Quem abrir a DM por ele ganha a etiqueta \"veio:<origem>\" e, se tiver campanha ligada (e ela estiver ativa), recebe a campanha. Não manda nada sozinho pra ninguém.",
    inputSchema: {
      type: "object",
      properties: {
        origem: { ...str, description: "story | bio | pagina | outro texto curto" },
        codigo: { ...str, description: "Código (letras, números, - _ =; até 64). Vazio = aleatório" },
        automationId: { ...str, description: "Campanha disparada ao abrir a conversa (opcional)" },
        etiqueta: { ...str, description: "Etiqueta (padrão veio:<origem>)" },
      },
      required: ["origem"],
    },
    async run(args, call) {
      const origem = requireString(args, "origem");
      if (!origem) return text("Informe a origem.", true);
      const body: Record<string, unknown> = { origin: origem };
      const codigo = requireString(args, "codigo");
      if (codigo) body.code = codigo;
      const automationId = requireString(args, "automationId");
      if (automationId) body.automationId = automationId;
      const etiqueta = requireString(args, "etiqueta");
      if (etiqueta) body.tagName = etiqueta;
      const res = await api(call, "POST", "/api/conversation-links", body);
      if (!res.ok) return res.result;
      return text(res.data);
    },
  },
  // ─── Etapa 3: fluxos ───────────────────────────────────────────────────────
  // Pela chave de API só dá pra ler, criar e editar RASCUNHO. Publicar e
  // ligar um fluxo é só pela tela, com o Matheus logado (a API responde 403
  // human_only pra chave).
  {
    name: "listar_fluxos",
    description:
      "Lista os fluxos (construtor visual) com status (ligado/desligado, publicado), gatilho e quantos entraram/terminaram.",
    inputSchema: { type: "object", properties: {} },
    async run(_args, call) {
      const res = await api(call, "GET", "/api/flows");
      if (!res.ok) return res.result;
      const rows = (res.data as FlowSummaryRow[]).map((f) => ({
        id: f.id,
        nome: f.name,
        ligado: f.isActive,
        publicado: f.published,
        versao: f.publishedVersion,
        rascunhoMudou: f.hasUnpublishedChanges,
        gatilho: f.trigger?.label ?? "sem gatilho",
        palavras: f.trigger?.keywords ?? [],
        passos: f.nodeCount,
        numeros: { entraram: f.stats?.entered ?? 0, terminaram: f.stats?.completed ?? 0, emAndamento: f.stats?.open ?? 0 },
        copiadoDaCampanha: f.sourceAutomationId,
      }));
      return text(rows);
    },
  },
  {
    name: "ver_fluxo",
    description:
      "Mostra um fluxo: rascunho (gatilho e nós), versão publicada, o que falta pra publicar (validação), campanhas que ganham dele e o relatório por nó.",
    inputSchema: {
      type: "object",
      properties: { id: { ...str, description: "ID do fluxo" } },
      required: ["id"],
    },
    async run(args, call) {
      const id = requireString(args, "id");
      if (!id) return text("Informe o id.", true);
      const res = await api(call, "GET", `/api/flows/${encodeURIComponent(id)}`);
      if (!res.ok) return res.result;
      const report = await api(call, "GET", `/api/flows/${encodeURIComponent(id)}/report`);
      return text({ ...(res.data as Record<string, unknown>), relatorio: report.ok ? report.data : null });
    },
  },
  {
    name: "criar_fluxo",
    description:
      "Cria um fluxo SEMPRE DESLIGADO e só como rascunho. Publicar e ligar é só pela tela do Lead Engine, com o dono da conta. " +
      FLOW_DRAFT_HELP,
    inputSchema: {
      type: "object",
      properties: {
        name: { ...str, description: "Nome do fluxo" },
        instagramAccountId: { ...str, description: "Conta (opcional; padrão a conta conectada)" },
        gatilho: {
          type: "string",
          enum: ["COMMENT", "DM", "STORY_REPLY", "STORY_MENTION", "LIVE_COMMENT", "CONVERSATION_LINK"],
          description: "Tipo do gatilho do rascunho vazio (ignorado quando manda o rascunho)",
        },
        rascunho: { type: "object", description: "Definição do fluxo { trigger, nodes } (opcional)" },
      },
      required: ["name"],
    },
    async run(args, call) {
      const name = requireString(args, "name");
      if (!name) return text("Informe o nome.", true);
      const body: Record<string, unknown> = { name };
      const account = requireString(args, "instagramAccountId");
      if (account) body.instagramAccountId = account;
      if (typeof args.gatilho === "string") body.triggerType = args.gatilho;
      if (args.rascunho !== undefined) body.draft = args.rascunho;
      const res = await api(call, "POST", "/api/flows", body);
      if (!res.ok) return res.result;
      const created = res.data as { id: string; name: string; validation?: unknown };
      return text({
        criado: true,
        ligado: false,
        publicado: false,
        id: created.id,
        nome: created.name,
        oQueFaltaPraPublicar: created.validation ?? null,
        aviso: "Publicar e ligar só pela tela, com o dono da conta.",
      });
    },
  },
  {
    name: "editar_fluxo",
    description:
      "Altera o nome ou o RASCUNHO de um fluxo (troca a definição inteira). Não publica, não liga, não desliga: o que está rodando não muda até um humano publicar na tela. " +
      FLOW_DRAFT_HELP,
    inputSchema: {
      type: "object",
      properties: {
        id: { ...str, description: "ID do fluxo" },
        name: { ...str, description: "Novo nome" },
        rascunho: { type: "object", description: "Nova definição { trigger, nodes }" },
      },
      required: ["id"],
    },
    async run(args, call) {
      const id = requireString(args, "id");
      if (!id) return text("Informe o id.", true);
      const body: Record<string, unknown> = {};
      const name = requireString(args, "name");
      if (name) body.name = name;
      if (args.rascunho !== undefined) body.draft = args.rascunho;
      if (Object.keys(body).length === 0) return text("Nada pra alterar.", true);
      const res = await api(call, "PATCH", `/api/flows/${encodeURIComponent(id)}`, body);
      if (!res.ok) return res.result;
      const flow = res.data as { validation?: unknown; isActive?: boolean };
      return text({ editado: true, id, campos: Object.keys(body), ligado: flow.isActive ?? false, oQueFaltaPraPublicar: flow.validation ?? null });
    },
  },
  {
    name: "abrir_campanha_como_fluxo",
    description:
      "Cria um fluxo NOVO e DESLIGADO copiando uma campanha (gatilho, palavras, DM de abertura, link, pedir pra seguir, follow-up, sequência). A campanha continua ligada e intacta.",
    inputSchema: {
      type: "object",
      properties: { automationId: { ...str, description: "ID da campanha" } },
      required: ["automationId"],
    },
    async run(args, call) {
      const automationId = requireString(args, "automationId");
      if (!automationId) return text("Informe o automationId.", true);
      const res = await api(call, "POST", `/api/flows/from-campaign/${encodeURIComponent(automationId)}`);
      if (!res.ok) return res.result;
      const flow = res.data as { id: string; name: string; warnings?: unknown };
      return text({ criado: true, ligado: false, id: flow.id, nome: flow.name, avisos: flow.warnings ?? [] });
    },
  },

  // ─── Etapa 5: escala ───────────────────────────────────────────────────────
  // Pela chave: relatório (só leitura), segmentos (ler) e RASCUNHO de disparo.
  // Enviar ou agendar um disparo é só pela tela, com o Matheus logado.
  {
    name: "ver_relatorio",
    description:
      "Relatório do período (7, 30 ou 90 dias), só leitura: DMs enviadas por origem (campanha, fluxo, disparo, inbox, rascunho aprovado), cliques e CTR por campanha/fluxo/disparo, novos contatos por dia, etiquetas que mais cresceram, posts que mais geraram DM, moderação (escondidos) e o funil comentou → recebeu → clicou.",
    inputSchema: {
      type: "object",
      properties: { dias: { type: "integer", enum: [7, 30, 90], description: "Período em dias (padrão 30)" } },
    },
    async run(args, call) {
      const days = [7, 30, 90].includes(Number(args.dias)) ? Number(args.dias) : 30;
      const res = await api(call, "GET", `/api/reports?days=${days}`);
      if (!res.ok) return res.result;
      const r = res.data as ReportData;
      return text({
        periodo: `${r.days} dias`,
        fusoHorario: r.timezone,
        dmsEnviadas: {
          total: r.dms?.total ?? 0,
          campanha: r.dms?.groups?.campaign ?? 0,
          fluxo: r.dms?.groups?.flow ?? 0,
          disparo: r.dms?.groups?.broadcast ?? 0,
          inbox: r.dms?.groups?.inbox ?? 0,
          rascunhoAprovado: r.dms?.groups?.draft ?? 0,
          aviso: `O registro por origem existe desde ${r.dms?.ledgerSince ?? "2026-10-04"}; antes disso só as campanhas (DmLog: ${r.dms?.campaignsFromDmLog ?? 0} no período).`,
        },
        ctr: {
          campanhas: (r.ctr?.campaigns ?? []).map(ctrRow),
          fluxos: (r.ctr?.flows ?? []).map(ctrRow),
          disparos: (r.ctr?.broadcasts ?? []).map(ctrRow),
        },
        novosContatos: { total: r.newContacts?.total ?? 0, porDia: r.newContacts?.byDay ?? [] },
        etiquetasQueMaisCresceram: (r.topTags ?? []).map((t) => ({ etiqueta: t.tag, saldo: t.net, adicionadas: t.added, removidas: t.removed })),
        postsQueMaisGeraramDm: (r.topPosts ?? []).map((p) => ({ mediaId: p.mediaId, dms: p.dms, pessoas: p.people })),
        moderacao: { escondidos: r.moderation?.hidden ?? 0, esconderia: r.moderation?.wouldHide ?? 0, restaurados: r.moderation?.restored ?? 0 },
        funil: {
          comentou: r.funnel?.commented ?? 0,
          recebeu: r.funnel?.received ?? 0,
          clicou: r.funnel?.clicked ?? 0,
          recebeuPct: r.funnel?.receivedRate ?? 0,
          clicouPct: r.funnel?.clickRate ?? 0,
        },
      });
    },
  },
  {
    name: "listar_segmentos",
    description:
      "Lista os segmentos salvos (filtros do CRM) com a contagem ao vivo: quantos contatos no segmento e quantos estão com conversa aberta agora. Só quem está com conversa aberta (falou com a conta nas últimas 24h), não pediu pra sair e não foi assumido recebe disparo.",
    inputSchema: { type: "object", properties: {} },
    async run(_args, call) {
      const res = await api(call, "GET", "/api/segments?count=1");
      if (!res.ok) return res.result;
      const rows = (res.data as SegmentSummaryRow[]).map((s) => ({
        id: s.id,
        nome: s.name,
        filtros: s.filters,
        contatos: s.count?.total ?? s.lastCount ?? 0,
        comConversaAberta: s.count?.windowOpen ?? null,
        recebemAgora: s.count?.eligible ?? null,
        sairam: s.count?.optedOut ?? null,
        assumidos: s.count?.takeover ?? null,
        noMeioDeFluxo: s.count?.busy ?? null,
      }));
      return text(rows);
    },
  },
  {
    name: "criar_rascunho_disparo",
    description:
      "Cria um RASCUNHO de disparo (mensagem pra um segmento). NÃO envia: enviar ou agendar é só pela tela do Lead Engine, com o dono da conta. " +
      "Regra do Instagram: só recebe quem falou com a conta nas últimas 24h; a lista é decidida na hora do envio. " +
      'Texto até 640 caracteres, com {username} e {first_name}. Botões (até 3): {id,label,kind:"link",url} ou {id,label,kind:"flow",flowId} (fluxo publicado e ligado). ' +
      "A/B opcional: variantes [{key:A|B|C, weight, text}] com pesos somando 100.",
    inputSchema: {
      type: "object",
      properties: {
        name: { ...str, description: "Nome interno do disparo" },
        segmentId: { ...str, description: "ID do segmento (listar_segmentos)" },
        filtros: { type: "object", description: "Filtros na hora, se não usar um segmento salvo" },
        text: { ...str, description: "Mensagem (até 640 caracteres)" },
        buttons: { type: "array", items: { type: "object" }, description: "Até 3 botões" },
        variantes: { type: "array", items: { type: "object" }, description: "A/B: [{key, weight, text}]" },
        instagramAccountId: { ...str, description: "Conta (opcional; padrão a conta conectada)" },
      },
      required: ["name", "text"],
    },
    async run(args, call) {
      const name = requireString(args, "name");
      const message = requireString(args, "text");
      if (!name || !message) return text("Informe name e text.", true);
      const body: Record<string, unknown> = { name, text: message };
      const segmentId = requireString(args, "segmentId");
      if (segmentId) body.segmentId = segmentId;
      if (args.filtros && typeof args.filtros === "object") body.filters = args.filtros;
      if (Array.isArray(args.buttons)) body.buttons = args.buttons;
      if (Array.isArray(args.variantes)) body.variants = args.variantes;
      const account = requireString(args, "instagramAccountId");
      if (account) body.instagramAccountId = account;
      const res = await api(call, "POST", "/api/broadcasts", body);
      if (!res.ok) return res.result;
      const created = res.data as { id: string; name: string; status: string };
      const detail = await api(call, "GET", `/api/broadcasts/${encodeURIComponent(created.id)}`);
      const audience = detail.ok ? (detail.data as { audience?: { total?: number; eligible?: number } }).audience : null;
      return text({
        criado: true,
        status: created.status,
        enviado: false,
        id: created.id,
        nome: created.name,
        contatosNoSegmento: audience?.total ?? null,
        receberiamAgora: audience?.eligible ?? null,
        aviso: "É só um rascunho. Enviar ou agendar é pela tela, com o dono da conta. Só recebe quem estiver com conversa aberta na hora do envio.",
      });
    },
  },

  // ─── Etapa 6: quiz (funis) ─────────────────────────────────────────────────
  // Pela chave: criar e editar RASCUNHO e ler números. Publicar é só pela tela.
  ...FUNNEL_TOOLS,
];

type CtrRowData = { name: string; sent: number; clicks: number; ctr: number };
function ctrRow(r: CtrRowData) {
  return { nome: r.name, enviadas: r.sent, cliques: r.clicks, ctr: r.ctr };
}

type ReportData = {
  days: number;
  timezone?: string;
  dms?: {
    total?: number;
    groups?: Record<string, number>;
    ledgerSince?: string;
    campaignsFromDmLog?: number;
  };
  ctr?: { campaigns?: CtrRowData[]; flows?: CtrRowData[]; broadcasts?: CtrRowData[] };
  newContacts?: { total?: number; byDay?: { day: string; count: number }[] };
  topTags?: { tag: string; added: number; removed: number; net: number }[];
  topPosts?: { mediaId: string; dms: number; people: number }[];
  moderation?: { hidden?: number; wouldHide?: number; restored?: number };
  funnel?: { commented?: number; received?: number; clicked?: number; receivedRate?: number; clickRate?: number };
};

type SegmentSummaryRow = {
  id: string;
  name: string;
  filters: unknown;
  lastCount: number | null;
  count?: { total: number; windowOpen: number; eligible: number; optedOut: number; takeover: number; busy: number };
};

function rpcResult(id: JsonRpcId, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: JsonRpcId, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

/**
 * Handle one JSON-RPC message. Returns null for notifications, which get no
 * response body.
 */
export async function handleMcpMessage(
  message: JsonRpcMessage,
  call: InternalCall
): Promise<Record<string, unknown> | null> {
  const id = message.id ?? null;
  const isNotification = message.id === undefined;

  if (message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return isNotification ? null : rpcError(id, -32600, "Invalid Request");
  }

  if (isNotification) return null;

  switch (message.method) {
    case "initialize": {
      const requested = message.params?.protocolVersion;
      return rpcResult(id, {
        protocolVersion: typeof requested === "string" ? requested : MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions:
          "Lead Engine do @omatheus.ai pela API oficial do Instagram. DM escrita por IA nunca sai sem aprovação humana: use propor_resposta (cria um rascunho, não envia) e espere o Matheus aprovar. Não existe ferramenta pra enviar DM direto. Quem o Matheus assumiu fica fora (listar_dms_sem_resposta não mostra). Automações nascem desligadas; ligar só com o ok do dono da conta. A moderação de comentários nasce no modo observar; esconder comentários só com o ok do dono da conta. Fluxos (construtor visual): pela chave você só lê, cria e edita rascunho; publicar e ligar um fluxo é só pela tela, com o dono da conta. Disparos: pela chave você só cria RASCUNHO (criar_rascunho_disparo); enviar ou agendar é só pela tela, com o dono da conta, e só recebe quem falou com a conta nas últimas 24h. ver_relatorio e listar_segmentos são só leitura. Quiz (funis): pela chave você cria e edita RASCUNHO; publicar é só pela tela, com o dono da conta. Nunca invente preço, depoimento, número ou prazo: deixe [colchetes] e avise o que falta.",
      });
    }
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, {
        tools: TOOLS.map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema,
        })),
      });
    case "tools/call": {
      const name = message.params?.name;
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) return rpcError(id, -32602, `Unknown tool: ${String(name)}`);
      const args = (message.params?.arguments ?? {}) as Record<string, unknown>;
      try {
        return rpcResult(id, await tool.run(args, call));
      } catch (err) {
        const reason = err instanceof Error ? err.message : "Tool failed";
        return rpcResult(id, text(reason, true));
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${message.method}`);
  }
}
