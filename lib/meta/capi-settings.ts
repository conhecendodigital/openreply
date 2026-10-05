/**
 * Account settings for the Meta Pixel and Conversions API (server-only).
 * Used only by /api/workspace/meta-capi*, which a signed-in owner/admin
 * reaches and an API key never does (proxy.ts + lib/api-key-routes.ts, and
 * the route checks again).
 *
 * The public view NEVER has the token: only whether one is saved and its last
 * 4 characters.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { isApiTokenRequest } from "@/lib/auth";
import { encryptToken } from "@/lib/meta/oauth";
import { CAPI_TOKEN_RE, PIXEL_ID_RE, TEST_EVENT_CODE_RE } from "@/lib/meta/capi";
import { canManageWorkspace, getCurrentWorkspaceContext, type WorkspaceContext } from "@/lib/workspace-access";

export type MetaCapiView = {
  pixelId: string | null;
  tokenSaved: boolean;
  tokenLast4: string | null;
  testEventCode: string | null;
  updatedAt: string | null;
};

const VIEW_SELECT = { pixelId: true, accessTokenEnc: true, tokenLast4: true, testEventCode: true, updatedAt: true } as const;

type Row = {
  pixelId: string | null;
  accessTokenEnc: string | null;
  tokenLast4: string | null;
  testEventCode: string | null;
  updatedAt: Date | null;
} | null;

/** The only shape that leaves the server. No token, no encrypted token. */
export function toMetaCapiView(row: Row): MetaCapiView {
  return {
    pixelId: row?.pixelId ?? null,
    tokenSaved: Boolean(row?.accessTokenEnc),
    tokenLast4: row?.accessTokenEnc ? row.tokenLast4 ?? null : null,
    testEventCode: row?.testEventCode ?? null,
    updatedAt: row?.updatedAt ? new Date(row.updatedAt).toISOString() : null,
  };
}

export function capiJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** Signed-in owner/admin only. API keys get 403 here too (second lock). */
export async function requireCapiManager(): Promise<{ context: WorkspaceContext } | { error: NextResponse }> {
  if (await isApiTokenRequest()) {
    return {
      error: capiJson(
        { success: false, error: "API keys cannot use this route. Do it in the Lead Engine.", code: "human_only" },
        403
      ),
    };
  }
  const context = await getCurrentWorkspaceContext();
  if (!context) return { error: capiJson({ success: false, error: "Unauthorized", code: "unauthorized" }, 401) };
  if (!canManageWorkspace(context.role)) {
    return { error: capiJson({ success: false, error: "Only owners and admins can change this", code: "forbidden" }, 403) };
  }
  return { context };
}

export async function readMetaCapiView(workspaceId: string): Promise<MetaCapiView> {
  const row = await prisma.metaCapiSettings.findUnique({ where: { workspaceId }, select: VIEW_SELECT });
  return toMetaCapiView(row);
}

const optionalText = (max: number) =>
  z
    .union([z.string().max(max), z.null()])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === null ? null : v.trim() || null));

/**
 * pixelId / testEventCode: string (empty = clear), null = clear, missing = keep.
 * accessToken: string = replace, null = remove, missing = keep.
 */
export const metaCapiPatchSchema = z.object({
  pixelId: optionalText(40),
  accessToken: optionalText(2048),
  testEventCode: optionalText(80),
});

export type MetaCapiPatch = z.infer<typeof metaCapiPatchSchema>;

export type PatchError = "pixel_invalid" | "token_invalid" | "test_code_invalid";

export function validateMetaCapiPatch(patch: MetaCapiPatch): PatchError | null {
  if (patch.pixelId && !PIXEL_ID_RE.test(patch.pixelId.replace(/\s/g, ""))) return "pixel_invalid";
  if (patch.accessToken && !CAPI_TOKEN_RE.test(patch.accessToken)) return "token_invalid";
  if (patch.testEventCode && !TEST_EVENT_CODE_RE.test(patch.testEventCode)) return "test_code_invalid";
  return null;
}

export async function saveMetaCapi(context: WorkspaceContext, patch: MetaCapiPatch): Promise<MetaCapiView> {
  const data: Record<string, string | null> = { updatedBy: context.userId };
  if (patch.pixelId !== undefined) data.pixelId = patch.pixelId ? patch.pixelId.replace(/\s/g, "") : null;
  if (patch.testEventCode !== undefined) data.testEventCode = patch.testEventCode;
  if (patch.accessToken !== undefined) {
    if (patch.accessToken === null) {
      data.accessTokenEnc = null;
      data.tokenLast4 = null;
    } else {
      data.accessTokenEnc = encryptToken(patch.accessToken);
      data.tokenLast4 = patch.accessToken.slice(-4);
    }
  }
  const row = await prisma.metaCapiSettings.upsert({
    where: { workspaceId: context.workspaceId },
    create: { workspaceId: context.workspaceId, ...data },
    update: data,
    select: VIEW_SELECT,
  });
  return toMetaCapiView(row);
}
