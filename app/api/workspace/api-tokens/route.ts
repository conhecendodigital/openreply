import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { generateApiToken } from "@/lib/api-token";
import { API_TOKEN_SCOPES } from "@/lib/api-token-auth";
import { isApiTokenRequest } from "@/lib/auth";
import { getBaseUrl } from "@/lib/env";
import {
  canManageWorkspace,
  getCurrentWorkspaceContext,
} from "@/lib/workspace-access";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  // "drafts:approve" only for deterministic code (e.g. the Telegram bot's
  // approve button), never for the key the AI uses to propose drafts.
  scopes: z.array(z.enum(API_TOKEN_SCOPES)).max(API_TOKEN_SCOPES.length).optional(),
});

// API keys are managed from a signed-in session only: a key must never be able
// to mint or revoke keys, or a leaked one could lock the owner out.
async function requireManager() {
  if (await isApiTokenRequest()) {
    return {
      error: NextResponse.json(
        { success: false, error: "API keys cannot manage API keys" },
        { status: 403 }
      ),
    };
  }
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return {
      error: NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 }),
    };
  }
  if (!canManageWorkspace(context.role)) {
    return {
      error: NextResponse.json(
        { success: false, error: "Only owners and admins can manage API keys" },
        { status: 403 }
      ),
    };
  }
  return { context };
}

export async function GET() {
  const { context, error } = await requireManager();
  if (error) return error;

  const tokens = await prisma.apiToken.findMany({
    where: { workspaceId: context.workspaceId, revokedAt: null },
    select: { id: true, name: true, prefix: true, scopes: true, createdAt: true, lastUsedAt: true },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(
    {
      success: true,
      data: {
        tokens,
        mcpUrl: `${getBaseUrl().replace(/\/$/, "")}/api/mcp`,
        envTokenConfigured: Boolean(process.env.OPENREPLY_API_TOKEN),
        availableScopes: API_TOKEN_SCOPES,
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(request: NextRequest) {
  const { context, error } = await requireManager();
  if (error) return error;

  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Give the key a name (up to 60 characters)" },
      { status: 400 }
    );
  }

  const { token, tokenHash, prefix } = generateApiToken();
  const created = await prisma.apiToken.create({
    data: {
      workspaceId: context.workspaceId,
      name: parsed.data.name,
      tokenHash,
      prefix,
      scopes: [...new Set(parsed.data.scopes ?? [])],
      createdById: context.userId,
    },
    select: { id: true, name: true, prefix: true, scopes: true, createdAt: true, lastUsedAt: true },
  });

  // The only time the full key leaves the server.
  return NextResponse.json({ success: true, data: { ...created, token } }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const { context, error } = await requireManager();
  if (error) return error;

  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ success: false, error: "Missing key ID" }, { status: 400 });
  }

  const result = await prisma.apiToken.updateMany({
    where: { id, workspaceId: context.workspaceId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (result.count === 0) {
    return NextResponse.json({ success: false, error: "Key not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
