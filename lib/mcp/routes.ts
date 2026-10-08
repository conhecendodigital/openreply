/**
 * Which API route answers each MCP internal call (method + path). Kept out of
 * app/api/mcp/route.ts so it can be tested (a route file may only export
 * route handlers). Static paths go before the [id] patterns that would also
 * match them.
 */
import type { NextRequest } from "next/server";
import * as automationsRoute from "@/app/api/automations/route";
import * as logsRoute from "@/app/api/logs/route";
import * as conversationsRoute from "@/app/api/instagram/conversations/route";
import * as conversationRoute from "@/app/api/instagram/conversations/[id]/route";
import * as overviewRoute from "@/app/api/instagram/overview/route";
import * as postsRoute from "@/app/api/instagram/posts/route";
import * as moderationSettingsRoute from "@/app/api/moderation/settings/route";
import * as moderationLogRoute from "@/app/api/moderation/log/route";
import * as moderationRestoreRoute from "@/app/api/moderation/log/[id]/restore/route";
import * as moderationHideRoute from "@/app/api/moderation/log/[id]/hide/route";
import * as moderationTestRoute from "@/app/api/moderation/test/route";
import * as contactsRoute from "@/app/api/contacts/route";
import * as contactTagsListRoute from "@/app/api/contacts/tags/route";
import * as contactRoute from "@/app/api/contacts/[id]/route";
import * as contactTagsRoute from "@/app/api/contacts/[id]/tags/route";
import * as contactTakeoverRoute from "@/app/api/contacts/[id]/takeover/route";
import * as draftsRoute from "@/app/api/drafts/route";
import * as draftRoute from "@/app/api/drafts/[id]/route";
import * as draftApproveRoute from "@/app/api/drafts/[id]/approve/route";
import * as draftRejectRoute from "@/app/api/drafts/[id]/reject/route";
import * as unansweredRoute from "@/app/api/inbox/unanswered/route";
import * as conversationLinksRoute from "@/app/api/conversation-links/route";
import * as conversationLinkRoute from "@/app/api/conversation-links/[id]/route";
// Etapa 3 (fluxos): the flow tools existed but these routes were missing here,
// so listar_fluxos & co. answered 404 "No route".
import * as flowsRoute from "@/app/api/flows/route";
import * as flowRoute from "@/app/api/flows/[id]/route";
import * as flowReportRoute from "@/app/api/flows/[id]/report/route";
import * as flowFromCampaignRoute from "@/app/api/flows/from-campaign/[automationId]/route";
// Etapa 5 (escala). No send route: an API key only creates DRAFT broadcasts.
import * as segmentsRoute from "@/app/api/segments/route";
import * as segmentRoute from "@/app/api/segments/[id]/route";
import * as segmentCountRoute from "@/app/api/segments/count/route";
import * as broadcastsRoute from "@/app/api/broadcasts/route";
import * as broadcastRoute from "@/app/api/broadcasts/[id]/route";
import * as broadcastCancelRoute from "@/app/api/broadcasts/[id]/cancel/route";
import * as reportsRoute from "@/app/api/reports/route";
// Etapa 6 (quiz). No publish / unpublish / leads route: an API key only
// creates and edits DRAFTS and reads the numbers.
import * as funnelsRoute from "@/app/api/funnels/route";
import * as funnelRoute from "@/app/api/funnels/[id]/route";
import * as funnelDuplicateRoute from "@/app/api/funnels/[id]/duplicate/route";
import * as funnelResultsRoute from "@/app/api/funnels/[id]/results/route";
import * as waProgramadosEnviadosRoute from "@/app/api/whatsapp/programados/enviados/route";

export type Handler = (
  request: NextRequest,
  context: { params: Promise<Record<string, string>> }
) => Promise<Response>;

export function resolveHandler(
  method: string,
  pathname: string
): { handler: Handler; id: string; param: string } | null {
  // Optional third item: the dynamic segment's name when it is not "id".
  const routes: [RegExp, Record<string, unknown>, string?][] = [
    [/^\/api\/automations$/, automationsRoute],
    [/^\/api\/logs$/, logsRoute],
    [/^\/api\/instagram\/conversations$/, conversationsRoute],
    [/^\/api\/instagram\/overview$/, overviewRoute],
    [/^\/api\/instagram\/posts$/, postsRoute],
    [/^\/api\/instagram\/conversations\/([^/]+)$/, conversationRoute],
    [/^\/api\/moderation\/settings$/, moderationSettingsRoute],
    [/^\/api\/moderation\/log$/, moderationLogRoute],
    [/^\/api\/moderation\/test$/, moderationTestRoute],
    [/^\/api\/moderation\/log\/([^/]+)\/restore$/, moderationRestoreRoute],
    [/^\/api\/moderation\/log\/([^/]+)\/hide$/, moderationHideRoute],
    // Static paths before the [id] patterns that would also match them.
    [/^\/api\/contacts$/, contactsRoute],
    [/^\/api\/contacts\/tags$/, contactTagsListRoute],
    [/^\/api\/contacts\/([^/]+)\/tags$/, contactTagsRoute],
    [/^\/api\/contacts\/([^/]+)\/takeover$/, contactTakeoverRoute],
    [/^\/api\/contacts\/([^/]+)$/, contactRoute],
    // Etapa 2. Static paths before the [id] patterns.
    [/^\/api\/drafts$/, draftsRoute],
    [/^\/api\/drafts\/([^/]+)\/approve$/, draftApproveRoute],
    [/^\/api\/drafts\/([^/]+)\/reject$/, draftRejectRoute],
    [/^\/api\/drafts\/([^/]+)$/, draftRoute],
    [/^\/api\/inbox\/unanswered$/, unansweredRoute],
    [/^\/api\/conversation-links$/, conversationLinksRoute],
    [/^\/api\/conversation-links\/([^/]+)$/, conversationLinkRoute],
    // Etapa 3: flows. Static paths before the [id] patterns.
    [/^\/api\/flows$/, flowsRoute],
    [/^\/api\/flows\/from-campaign\/([^/]+)$/, flowFromCampaignRoute, "automationId"],
    [/^\/api\/flows\/([^/]+)\/report$/, flowReportRoute],
    [/^\/api\/flows\/([^/]+)$/, flowRoute],
    // Etapa 5. Static paths before the [id] patterns.
    [/^\/api\/segments$/, segmentsRoute],
    [/^\/api\/segments\/count$/, segmentCountRoute],
    [/^\/api\/segments\/([^/]+)$/, segmentRoute],
    [/^\/api\/broadcasts$/, broadcastsRoute],
    [/^\/api\/broadcasts\/([^/]+)\/cancel$/, broadcastCancelRoute],
    [/^\/api\/broadcasts\/([^/]+)$/, broadcastRoute],
    [/^\/api\/reports$/, reportsRoute],
    // Etapa 6. Static paths before the [id] patterns.
    [/^\/api\/funnels$/, funnelsRoute],
    [/^\/api\/funnels\/([^/]+)\/duplicate$/, funnelDuplicateRoute],
    [/^\/api\/funnels\/([^/]+)\/results$/, funnelResultsRoute],
    [/^\/api\/funnels\/([^/]+)$/, funnelRoute],
    [/^\/api\/whatsapp\/programados\/enviados$/, waProgramadosEnviadosRoute],
  ];
  for (const [pattern, mod, param] of routes) {
    const match = pattern.exec(pathname);
    const handler = mod[method];
    if (match && typeof handler === "function") {
      return { handler: handler as Handler, id: decodeURIComponent(match[1] ?? ""), param: param ?? "id" };
    }
  }
  return null;
}
