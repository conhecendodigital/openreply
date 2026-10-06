/**
 * Fase 0 (06/10/2026): rotas do login novo (Better Auth) em /api/auth/*:
 * senha, Google, link mágico, 2FA e sessões.
 */
import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/better-auth";

export async function GET(request: Request) {
  return toNextJsHandler(getAuth()).GET(request);
}

export async function POST(request: Request) {
  return toNextJsHandler(getAuth()).POST(request);
}
