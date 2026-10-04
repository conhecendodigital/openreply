import { NextResponse, type NextRequest } from "next/server";
import { isApiKeyRouteAllowed } from "@/lib/api-key-routes";

const PROTECTED_PREFIXES = ["/dashboard", "/automations", "/logs", "/settings"];

function hasSessionCookie(request: NextRequest): boolean {
  return (
    request.cookies.has("authjs.session-token") ||
    request.cookies.has("__Secure-authjs.session-token") ||
    request.cookies.has("next-auth.session-token") ||
    request.cookies.has("__Secure-next-auth.session-token")
  );
}

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // API keys reach only the routes in lib/api-key-routes.ts (MCP, cron and
  // the routes the MCP calls). Requests without an Authorization header (the
  // app itself, the Meta webhook, login) pass untouched. The routes keep
  // their own checks too, so this is a second lock, not the only one.
  if (pathname.startsWith("/api/")) {
    if (
      request.headers.get("authorization") &&
      !isApiKeyRouteAllowed(request.method, pathname)
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "API keys cannot use this route. Do it in the Lead Engine.",
          code: "human_only",
        },
        { status: 403 }
      );
    }
    return NextResponse.next();
  }

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
  const isLogin = pathname === "/login";
  const isAuthenticated = hasSessionCookie(request);

  if (isProtected && !isAuthenticated) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (isLogin && isAuthenticated) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/automations/:path*",
    "/logs/:path*",
    "/settings/:path*",
    "/login",
    "/api/:path*",
  ],
};
