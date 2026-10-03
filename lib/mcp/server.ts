/**
 * Minimal MCP (Model Context Protocol) server over JSON-RPC, served statelessly
 * from /api/mcp. Every tool goes through the existing API routes via `call`, so
 * validation, workspace scoping and Meta error handling stay in one place.
 */

export type InternalCall = (
  method: "GET" | "POST" | "PATCH",
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
// out on purpose: campaigns are created paused and only turned on through
// ativar_automacao, so a human always sees that step.
const campaignFields: Record<string, unknown> = {
  name: { ...str, description: "Nome interno da automação" },
  goal: { ...str, description: "Objetivo, em uma frase" },
  postId: { ...str, description: "ID do post (quando é um post específico)" },
  postUrl: { ...str, description: "Link do post (quando é um post específico)" },
  matchAnyPost: { ...bool, description: "Dispara em qualquer post" },
  pendingNextReel: { ...bool, description: "Dispara no próximo Reel publicado" },
  keywords: { ...strList, description: "Palavras-chave (até 10)" },
  matchAnyWord: { ...bool, description: "Dispara com qualquer comentário" },
  wholeWordMatch: { ...bool, description: "Só palavra inteira (padrão true)" },
  dmTriggerEnabled: { ...bool, description: "Também dispara quando a palavra chega por DM" },
  dmMessage: { ...str, description: "Mensagem que entrega o link. {username} vira o @ da pessoa" },
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
  method: "GET" | "POST" | "PATCH",
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
  analytics?: unknown;
  trackedLinks?: { trackedUrl?: string; destinationUrl: string; _count?: { clicks: number } }[];
};

const campaignKeys = Object.keys(campaignFields);

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
        gatilho: a.matchAnyPost ? "qualquer post" : a.postUrl ?? "próximo reel",
        palavras: a.matchAnyWord ? "qualquer comentário" : a.keywords,
        tambemPorDm: a.dmTriggerEnabled,
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
      "Cria uma automação SEMPRE DESLIGADA. Depois de revisar os textos, ligue com ativar_automacao.",
    inputSchema: {
      type: "object",
      properties: campaignFields,
      required: ["name", "dmMessage"],
    },
    async run(args, call) {
      const body: Record<string, unknown> = { ...pick(args, campaignKeys), isActive: false };
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
      "Altera campos ou textos de uma automação. Não liga nem desliga (use ativar_automacao/desativar_automacao).",
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
      "LIGA uma automação: a partir daí ela responde pessoas reais sozinha. Só use com o ok do dono da conta.",
    inputSchema: {
      type: "object",
      properties: { id: { ...str, description: "ID da automação" } },
      required: ["id"],
    },
    async run(args, call) {
      const id = requireString(args, "id");
      if (!id) return text("Informe o id.", true);
      const res = await api(call, "PATCH", `/api/automations?id=${encodeURIComponent(id)}`, {
        isActive: true,
      });
      if (!res.ok) return res.result;
      return text({ id, ligada: true });
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
    description: "Lista as conversas da DM com a última mensagem de cada uma.",
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
  {
    name: "enviar_dm",
    description:
      "Envia uma DM de texto pela API oficial. Só funciona até 24 h depois da última mensagem da pessoa. Nunca envie sem o ok do dono da conta.",
    inputSchema: {
      type: "object",
      properties: {
        recipientId: { ...str, description: "contact.id da conversa (de listar_conversas)" },
        text: { ...str, description: "Texto da mensagem" },
      },
      required: ["recipientId", "text"],
    },
    async run(args, call) {
      const recipientId = requireString(args, "recipientId");
      const message = requireString(args, "text");
      if (!recipientId || !message) return text("Informe recipientId e text.", true);
      const res = await api(call, "POST", "/api/instagram/conversations", {
        recipientId,
        text: message,
      });
      if (!res.ok) return res.result;
      return text({ enviada: true, resposta: res.data });
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
];

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
          "Lead Engine do @omatheus.ai pela API oficial do Instagram. Automações nascem desligadas; ligar e enviar DM só com o ok do dono da conta. A moderação de comentários nasce no modo observar; esconder comentários só com o ok do dono da conta.",
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
