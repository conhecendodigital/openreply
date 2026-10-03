import { NextResponse } from "next/server";
import {
  canManageWorkspace,
  getCurrentWorkspaceContext,
  type WorkspaceContext,
} from "@/lib/workspace-access";

export function ok(data: unknown, status = 200) {
  return NextResponse.json({ success: true, data }, { status });
}

export function fail(error: string, status: number, details?: unknown) {
  return NextResponse.json(
    { success: false, error, ...(details !== undefined ? { details } : {}) },
    { status }
  );
}

/** Workspace of the caller (session or API key), optionally admin-only. */
export async function requireContext(
  options: { manage?: boolean } = {}
): Promise<{ context: WorkspaceContext } | { response: NextResponse }> {
  const context = await getCurrentWorkspaceContext();
  if (!context) return { response: fail("Unauthorized", 401) };
  if (options.manage && !canManageWorkspace(context.role)) {
    return { response: fail("Only owners and admins can change this", 403) };
  }
  return { context };
}

export function intParam(value: string | null, fallback: number, min: number, max: number) {
  const n = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
