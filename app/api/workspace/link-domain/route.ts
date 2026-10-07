import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { isApiTokenRequest } from "@/lib/auth";
import { getBaseUrl } from "@/lib/env";
import { hitRateLimit } from "@/lib/http-rate-limit";
import { invalidateLinkDomainCache, linkBaseUrl, normalizeLinkDomain } from "@/lib/links/domain";
import { domainReachesUs } from "@/lib/links/domain-check";
import { canManageWorkspace, getCurrentWorkspaceContext, type WorkspaceContext } from "@/lib/workspace-access";

export const dynamic = "force-dynamic";

/**
 * Domain of the tracked links (07/10/2026), Canais > Conexões e chaves.
 * Owner or admin, signed in. An API key gets 403 (here and in proxy.ts).
 *
 * Saving checks that the domain already reaches this Lead Engine
 * (https://<domain>/r/_ping): links on a domain that does not point here yet
 * would all break. See docs/links-e-previa.md.
 */

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function gate(): Promise<{ error: NextResponse } | { context: WorkspaceContext }> {
  if (await isApiTokenRequest()) {
    return { error: json({ success: false, error: "API keys cannot use this route. Do it in the Lead Engine.", code: "human_only" }, 403) };
  }
  const context = await getCurrentWorkspaceContext();
  if (!context) return { error: json({ success: false, error: "Unauthorized", code: "unauthorized" }, 401) };
  if (!canManageWorkspace(context.role)) {
    return { error: json({ success: false, error: "Only owners and admins can change this", code: "forbidden" }, 403) };
  }
  return { context };
}

function view(domain: string | null) {
  return {
    domain,
    appUrl: getBaseUrl().replace(/\/+$/, ""),
    linkBase: linkBaseUrl(domain),
  };
}

export async function GET() {
  const g = await gate();
  if ("error" in g) return g.error;
  const row = await prisma.workspace.findUnique({ where: { id: g.context.workspaceId }, select: { linkDomain: true } });
  return json({ success: true, data: view(row?.linkDomain ?? null) });
}

export async function PUT(request: NextRequest) {
  const g = await gate();
  if ("error" in g) return g.error;
  const limited = await hitRateLimit("link-domain", g.context.userId, 20, 600);
  if (!limited.allowed) return json({ success: false, error: "Too many changes", code: "rate_limited" }, 429);

  const body = (await request.json().catch(() => null)) as { domain?: unknown } | null;
  const raw = body?.domain;
  const workspaceId = g.context.workspaceId;

  // Empty or null: back to the app's own address.
  if (raw === null || (typeof raw === "string" && !raw.trim())) {
    await prisma.workspace.update({ where: { id: workspaceId }, data: { linkDomain: null } });
    invalidateLinkDomainCache();
    return json({ success: true, data: view(null) });
  }

  const check = normalizeLinkDomain(raw);
  if (!check.ok) return json({ success: false, error: "Invalid domain", code: check.code }, 400);
  const domain = check.domain;

  const taken = await prisma.workspace.findFirst({ where: { linkDomain: domain, NOT: { id: workspaceId } }, select: { id: true } });
  if (taken) return json({ success: false, error: "Domain already in use", code: "domain_taken" }, 409);

  if (!(await domainReachesUs(domain))) {
    return json({ success: false, error: "The domain does not reach the Lead Engine yet", code: "domain_not_pointed" }, 400);
  }

  try {
    await prisma.workspace.update({ where: { id: workspaceId }, data: { linkDomain: domain } });
  } catch {
    // Unique index: another workspace saved it a moment ago.
    return json({ success: false, error: "Domain already in use", code: "domain_taken" }, 409);
  }
  invalidateLinkDomainCache();
  return json({ success: true, data: view(domain) });
}
