/**
 * Ponte das rotas /api/whatsapp/* (telas) com lib/whatsapp/painel.ts.
 * Só sessão de pessoa logada: chave de API recebe 403 no proxy.ts (as rotas
 * não estão em lib/api-key-routes.ts) e de novo aqui (humanOnly).
 */
import { fail, ok, requireContext } from "@/lib/api-helpers";
import { humanOnly } from "@/lib/flows/api";
import { PainelError, type PainelDeps } from "@/lib/whatsapp/painel";
import { bullmqWaQueue } from "@/lib/whatsapp/queue";
import { getWaRepository } from "@/lib/whatsapp/setup";

export function painelDeps(): PainelDeps {
  return { repo: getWaRepository(), queue: bullmqWaQueue };
}

type Ctx = { userId: string; workspaceId: string };

/** Confere a sessão (e, com manage, se é dono ou admin do workspace) e trata os erros do painel. */
export async function withPainel(
  options: { manage?: boolean; action: string },
  fn: (ctx: Ctx, deps: PainelDeps) => Promise<unknown>,
  status = 200
) {
  const auth = await requireContext({ manage: options.manage });
  if ("response" in auth) return auth.response;
  const blocked = await humanOnly(options.action);
  if (blocked) return blocked;
  try {
    const data = await fn({ userId: auth.context.userId, workspaceId: auth.context.workspaceId }, painelDeps());
    return ok(data, status);
  } catch (error) {
    if (error instanceof PainelError) return fail(error.message, error.status, { code: error.code });
    console.error("[whatsapp] erro no painel:", (error as Error)?.message?.slice(0, 200));
    return fail("Something went wrong. Try again in a minute.", 500, { code: "internal" });
  }
}
