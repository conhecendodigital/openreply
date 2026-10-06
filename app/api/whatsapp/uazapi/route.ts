import { withPainel } from "@/lib/whatsapp/painel-http";
import { uazapiOverview } from "@/lib/whatsapp/painel-uazapi";

export const dynamic = "force-dynamic";

/** uazapi configurada? Quantas vagas de dispositivo sobram. Nunca devolve chave nem token. */
export async function GET() {
  return withPainel({ action: "read WhatsApp" }, (ctx, deps) => uazapiOverview(deps, ctx.workspaceId));
}
