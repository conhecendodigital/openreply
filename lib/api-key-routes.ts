/**
 * Which API routes a request carrying `Authorization: Bearer ...` may reach.
 *
 * An API key acts as the workspace owner in every route that reads the caller
 * (lib/auth.ts), so a new route would be open to keys by default. This list
 * flips that: a key only reaches the MCP endpoint, the cron jobs (their own
 * CRON_SECRET) and the routes the MCP server calls (lib/mcp/routes.ts), and
 * never with DELETE. Everything else (members, API keys, channel changes, import,
 * billing, admin...) answers 403 to a key, checked once in proxy.ts.
 *
 * Kept free of imports so proxy.ts stays light. When a new MCP tool needs a
 * route, add it here AND in lib/mcp/routes.ts (a test checks both agree).
 */

const KEY_METHODS = new Set(["GET", "POST", "PATCH"]);

/** Routes the MCP tools call. Same shapes as resolveHandler in lib/mcp/routes.ts. */
export const API_KEY_ROUTES: readonly RegExp[] = [
  /^\/api\/automations$/,
  /^\/api\/logs$/,
  /^\/api\/instagram\/conversations$/,
  /^\/api\/instagram\/conversations\/[^/]+$/,
  /^\/api\/instagram\/overview$/,
  /^\/api\/instagram\/posts$/,
  /^\/api\/moderation\/settings$/,
  /^\/api\/moderation\/log$/,
  /^\/api\/moderation\/test$/,
  /^\/api\/moderation\/log\/[^/]+\/(restore|hide)$/,
  /^\/api\/contacts$/,
  /^\/api\/contacts\/tags$/,
  /^\/api\/contacts\/[^/]+$/,
  /^\/api\/contacts\/[^/]+\/(tags|takeover)$/,
  /^\/api\/drafts$/,
  /^\/api\/drafts\/[^/]+$/,
  /^\/api\/drafts\/[^/]+\/(approve|reject)$/,
  /^\/api\/inbox\/unanswered$/,
  /^\/api\/inbox\/media\/[^/]+$/,
  /^\/api\/conversation-links$/,
  /^\/api\/conversation-links\/[^/]+$/,
  /^\/api\/flows$/,
  /^\/api\/flows\/[^/]+$/,
  /^\/api\/flows\/[^/]+\/report$/,
  /^\/api\/flows\/from-campaign\/[^/]+$/,
  /^\/api\/segments$/,
  /^\/api\/segments\/count$/,
  /^\/api\/segments\/[^/]+$/,
  /^\/api\/broadcasts$/,
  /^\/api\/broadcasts\/[^/]+$/,
  /^\/api\/broadcasts\/[^/]+\/cancel$/,
  // 2026-10-15: quem recebeu o disparo (só GET existe na rota) e testar a conexão do Instagram.
  /^\/api\/broadcasts\/[^/]+\/recipients$/,
  /^\/api\/channels\/instagram\/[^/]+\/test$/,
  /^\/api\/reports$/,
  // ver_canais (MCP, 09/10): só leitura do status dos canais (sem token).
  /^\/api\/channels$/,
  // Etapa 6 (quiz): drafts and numbers. Never publish, unpublish or export leads.
  /^\/api\/funnels$/,
  /^\/api\/funnels\/[^/]+\/duplicate$/,
  /^\/api\/funnels\/[^/]+\/results$/,
  /^\/api\/funnels\/[^/]+$/,
  // 2026-10-08: só leitura do que os textos programados do WhatsApp já mandaram (sem o texto).
  /^\/api\/whatsapp\/programados\/enviados$/,
  // Etapa 7 (completar rotas fora do WhatsApp): só leitura (e contar_segmento, que não salva nada).
  /^\/api\/dashboard\/stats$/,
  /^\/api\/instagram\/accounts$/,
  /^\/api\/instagram\/profile$/,
  /^\/api\/instagram\/stories$/,
  /^\/api\/reports\/export$/,
  /^\/api\/automations\/[^/]+\/ab$/,
  /^\/api\/automations\/[^/]+\/sequence$/,
  // 2026-10-23 (TikTok): o MCP lê e cria RASCUNHO de post. Agendar, publicar, cancelar, apagar e subir vídeo ficam só na tela.
  /^\/api\/posts$/,
  /^\/api\/posts\/(?!upload-url$)[^/]+$/,
];

/**
 * Rotas só de LEITURA (GET) que a chave alcança. O POST/PATCH das mesmas rotas
 * (conectar número, programar texto) nem passa do proxy; e o handler ainda
 * responde 403 human_only (withPainel), então são duas travas.
 */
export const API_KEY_GET_ONLY_ROUTES: readonly RegExp[] = [
  // 2026-10-23: contas do TikTok conectadas (sem token).
  /^\/api\/social-accounts$/,
  // 2026-10-16: leads do quiz só leitura (listar_leads_quiz), a pedido do Matheus. Export CSV segue só na tela.
  /^\/api\/funnels\/[^/]+\/leads$/,
  // 2026-10-14: leitura do WhatsApp pela chave (withPainelLeitura).
  /^\/api\/whatsapp\/conversations$/,
  /^\/api\/whatsapp\/conversations\/[^/]+$/,
  /^\/api\/whatsapp\/sessions$/,
  /^\/api\/whatsapp\/status$/,
  /^\/api\/whatsapp\/leads$/,
  /^\/api\/whatsapp\/programados$/,
  /^\/api\/whatsapp\/agents$/,
];

/** True when a request with an Authorization header may reach this route. */
export function isApiKeyRouteAllowed(method: string, pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  // The MCP endpoint checks the key itself; cron routes check CRON_SECRET.
  if (path === "/api/mcp") return true;
  if (/^\/api\/cron\/[^/]+$/.test(path)) return true;
  if (path === "/api/health") return true;
  if (!KEY_METHODS.has(method.toUpperCase())) return false;
  if (method.toUpperCase() === "GET" && API_KEY_GET_ONLY_ROUTES.some((pattern) => pattern.test(path))) return true;
  return API_KEY_ROUTES.some((pattern) => pattern.test(path));
}
