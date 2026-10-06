import { withPainel } from "@/lib/whatsapp/painel-http";
import { serverStatus } from "@/lib/whatsapp/painel";

export const dynamic = "force-dynamic";

/** Se o WhatsApp está ligado no servidor, se o gateway e a IA do /admin estão prontos. Nunca devolve chave. */
export async function GET() {
  return withPainel({ action: "read WhatsApp" }, (_ctx, deps) => serverStatus(deps));
}
