/**
 * Ponte das rotas /api/whatsapp/* (telas) com lib/whatsapp/painel.ts.
 * withPainel: só sessão de pessoa logada. A chave de API recebe 403 aqui
 * (humanOnly) e, fora dos 6 GET de leitura, também no proxy.ts.
 * withPainelLeitura: igual, mas aceita chave de API. Só pros GET de leitura.
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

/**
 * Igual ao withPainel, sem humanOnly e sem manage: serve a chave de API (MCP) e a
 * sessão. Use SÓ em GET de leitura de app/api/whatsapp/. Escrita continua withPainel.
 */
export async function withPainelLeitura(fn: (ctx: Ctx, deps: PainelDeps) => Promise<unknown>) {
  const auth = await requireContext();
  if ("response" in auth) return auth.response;
  try {
    const data = await fn({ userId: auth.context.userId, workspaceId: auth.context.workspaceId }, painelDeps());
    return ok(data);
  } catch (error) {
    if (error instanceof PainelError) return fail(error.message, error.status, { code: error.code });
    console.error("[whatsapp] erro no painel:", (error as Error)?.message?.slice(0, 200));
    return fail("Something went wrong. Try again in a minute.", 500, { code: "internal" });
  }
}
