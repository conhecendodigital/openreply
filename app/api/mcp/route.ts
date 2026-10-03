import { NextRequest, NextResponse } from "next/server";
import { resolveApiTokenUserId } from "@/lib/api-token-auth";
import {
  handleMcpMessage,
  type InternalCall,
  type JsonRpcMessage,
} from "@/lib/mcp/server";
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

// MCP over Streamable HTTP, stateless: every POST carries one JSON-RPC message
// (or a batch) and gets a JSON answer. Auth is the same bearer token that the
// session-guarded routes accept (OPENREPLY_API_TOKEN).
export const dynamic = "force-dynamic";

type Handler = (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => Promise<Response>;

function unauthorized() {
  return NextResponse.json(
    { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized" } },
    { status: 401, headers: { "WWW-Authenticate": "Bearer" } }
  );
}

function resolveHandler(method: string, pathname: string): { handler: Handler; id: string } | null {
  const routes: [RegExp, Record<string, unknown>][] = [
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
    [/^\/api\/contacts\/([^/]+)$/, contactRoute],
  ];
  for (const [pattern, mod] of routes) {
    const match = pattern.exec(pathname);
    const handler = mod[method];
    if (match && typeof handler === "function") {
      return { handler: handler as Handler, id: decodeURIComponent(match[1] ?? "") };
    }
  }
  return null;
}

export async function POST(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  if (!(await resolveApiTokenUserId(authorization))) {
    return unauthorized();
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      { status: 400 }
    );
  }

  // Route handlers read the caller from next/headers, which is this request,
  // so the bearer token authenticates the internal call too.
  const call: InternalCall = async (method, path, body) => {
    const url = new URL(path, request.nextUrl.origin);
    const resolved = resolveHandler(method, url.pathname);
    if (!resolved) return { status: 404, json: { success: false, error: "No route" } };

    const internal = new NextRequest(url, {
      method,
      headers: {
        authorization: authorization ?? "",
        "content-type": "application/json",
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const response = await resolved.handler(internal, {
      params: Promise.resolve({ id: resolved.id }),
    });
    const json = await response.json().catch(() => null);
    return { status: response.status, json };
  };

  if (Array.isArray(payload)) {
    const answers = (
      await Promise.all(payload.map((m) => handleMcpMessage(m as JsonRpcMessage, call)))
    ).filter(Boolean);
    return answers.length > 0
      ? NextResponse.json(answers)
      : new NextResponse(null, { status: 202 });
  }

  const answer = await handleMcpMessage(payload as JsonRpcMessage, call);
  return answer ? NextResponse.json(answer) : new NextResponse(null, { status: 202 });
}

// No server-initiated stream: this server only answers requests.
export async function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
