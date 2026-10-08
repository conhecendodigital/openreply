import { withPainel } from "@/lib/whatsapp/painel-http";
import { removerProgramado } from "@/lib/whatsapp/programados";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

/** Tira da fila um texto que ainda não saiu (fica marcado, não apaga). */
export async function DELETE(_request: Request, { params }: RouteProps) {
  const { id } = await params;
  return withPainel({ manage: true, action: "schedule WhatsApp messages" }, (ctx, deps) => removerProgramado(ctx, deps, id));
}
