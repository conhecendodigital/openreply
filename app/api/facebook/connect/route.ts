import { NextResponse } from "next/server";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { getBaseUrl } from "@/lib/env";
import { createOAuthState } from "@/lib/meta/oauth";
import { getFacebookAuthorizationUrl, getMissingFacebookOAuthEnv } from "@/lib/meta/facebook-oauth";

/** 23/10/2026: connect one or more Facebook Pages (Facebook Login). */
export async function GET() {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.redirect(`${getBaseUrl()}/login`);
  }
  if (!canManageWorkspace(context.role)) {
    return NextResponse.redirect(`${getBaseUrl()}/channels?facebook=forbidden`);
  }

  const missingEnv = getMissingFacebookOAuthEnv();
  if (missingEnv.length > 0) {
    return NextResponse.redirect(
      `${getBaseUrl()}/channels?facebook=misconfigured&missing=${encodeURIComponent(missingEnv.join(","))}`
    );
  }

  const redirectUri = `${getBaseUrl()}/api/facebook/callback`;
  const state = createOAuthState(context.workspaceId);
  return NextResponse.redirect(getFacebookAuthorizationUrl(redirectUri, state));
}
