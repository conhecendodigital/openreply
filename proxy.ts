import { NextResponse, type NextRequest } from "next/server";
import { isApiKeyRouteAllowed } from "@/lib/api-key-routes";
import { hostOf, isAppHost, listedQuizDomains } from "@/lib/links/hosts";

const PROTECTED_PREFIXES = ["/dashboard", "/automations", "/logs", "/settings", "/quizzes", "/admin", "/account", "/whatsapp"];

/**
 * Fase 0 (06/10/2026): cookie do login novo (Better Auth). Os cookies antigos
 * do NextAuth não contam mais: quem ainda tem um entra de novo uma vez.
 */
export function hasSessionCookie(request: NextRequest): boolean {
  return (
    request.cookies.has("better-auth.session_token") ||
    request.cookies.has("__Secure-better-auth.session_token")
  );
}

/**
 * Quiz domain (owner's request 05/10: "camuflar o link do quiz"): a domain of
 * the owner pointed at this app, like quiz.cloudmatheus.com.br, only shows
 * published quizzes at /<slug>. Listed in QUIZ_DOMAINS (comma separated); when
 * that is empty, any host other than the app's own (NEXTAUTH_URL) and local
 * development hosts counts as a quiz domain.
 */
export function isQuizHost(host: string, env: Record<string, string | undefined> = process.env): boolean {
  if (!host) return false;
  const listed = listedQuizDomains(env);
  if (listed.length) return listed.includes(host);
  // App host, local development and internal service names (Docker/Dokploy,
  // e.g. openreply-web-qsbqgu:3000, used by the cron) are the app. Without
  // NEXTAUTH_URL we cannot tell: behave as the app.
  return !isAppHost(host, env);
}

/**
 * Link domain (07/10/2026): the host a workspace saved for its tracked links
 * (Workspace.linkDomain, e.g. comando.cloudmatheus.com.br). Looked up in the
 * database only for a host that is not the app (cached 60 s). Any error = not
 * a link domain.
 */
async function isLinkDomainHost(host: string): Promise<boolean> {
  try {
    const { workspaceForLinkHost } = await import("@/lib/links/domain");
    return Boolean(await workspaceForLinkHost(host));
  } catch {
    return false;
  }
}

/** A link domain shows /r/* (handled before) and the icons. Nothing else of the app. */
function linkHostResponse(request: NextRequest): NextResponse {
  if (QUIZ_HOST_FILES.has(request.nextUrl.pathname)) return NextResponse.next();
  return new NextResponse("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
}

const QUIZ_HOST_FILES = new Set([
  "/favicon.ico",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
  "/og-lead-engine.png",
  "/manifest.webmanifest",
]);
const SLUG = /^\/([a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?)\/?$/;

/** What a quiz domain may serve. Returns the response, or null to fall through. */
export function quizHostResponse(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/_next/") || QUIZ_HOST_FILES.has(pathname)) return NextResponse.next();
  // The quiz page talks to these (events, leads). Nothing else of the API.
  if (pathname.startsWith("/api/q/")) return NextResponse.next();
  if (pathname.startsWith("/q/")) return NextResponse.next();
  const m = SLUG.exec(pathname);
  if (m) {
    const url = request.nextUrl.clone();
    url.pathname = `/q/${m[1]}`;
    return NextResponse.rewrite(url);
  }
  return new NextResponse("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const pathname = request.nextUrl.pathname;

  const host = hostOf(request.headers.get("host") ?? request.headers.get("x-forwarded-host"));
  if (host && !isAppHost(host)) {
    // Tracked links on a link domain. The route itself refuses a host that is
    // not the link domain of the link's workspace (lib/links/redirect.ts).
    if (pathname.startsWith("/r/")) return NextResponse.next();
    // A link domain only opens /r/*, unless it is also listed in QUIZ_DOMAINS.
    if (!listedQuizDomains().includes(host) && (await isLinkDomainHost(host))) return linkHostResponse(request);
  }
  if (isQuizHost(host)) return quizHostResponse(request);

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
  const isAuthenticated = hasSessionCookie(request);

  if (isProtected && !isAuthenticated) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Quem já está logado e abre /login é mandado pro painel pela própria página
  // de login, depois de conferir a sessão no banco. Fazer isso aqui só pelo
  // cookie dava laço infinito com cookie vencido.

  return NextResponse.next();
}

export const config = {
  // Every path: a quiz domain must not reach any page of the app. On the app's
  // own host the checks above only act on the protected prefixes, /login and /api.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
