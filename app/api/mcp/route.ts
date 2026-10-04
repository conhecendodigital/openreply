import { NextRequest, NextResponse } from "next/server";
import { resolveApiTokenUserId } from "@/lib/api-token-auth";
import {
  handleMcpMessage,
  type InternalCall,
  type JsonRpcMessage,
} from "@/lib/mcp/server";
import { resolveHandler } from "@/lib/mcp/routes";
import { hitRateLimit, MCP_LIMIT } from "@/lib/http-rate-limit";

// MCP over Streamable HTTP, stateless: every POST carries one JSON-RPC message
// (or a batch) and gets a JSON answer. Auth is the same bearer token that the
// session-guarded routes accept (OPENREPLY_API_TOKEN).
export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json(
    { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized" } },
    { status: 401, headers: { "WWW-Authenticate": "Bearer" } }
  );
}

export async function POST(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  if (!(await resolveApiTokenUserId(authorization))) {
    return unauthorized();
  }
  // Per-key ceiling against a runaway script; fails open if Redis is down.
  const limited = await hitRateLimit("mcp", authorization ?? "", MCP_LIMIT.limit, MCP_LIMIT.windowSeconds);
  if (!limited.allowed) {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32029, message: "Too many requests, try again in a minute" } },
      { status: 429, headers: { "Retry-After": "60" } }
    );
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
      params: Promise.resolve({ [resolved.param]: resolved.id }),
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
