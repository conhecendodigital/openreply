import { NextRequest } from "next/server";
import { withPainel } from "@/lib/whatsapp/painel-http";
import { removeExample } from "@/lib/whatsapp/regras/painel";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

/** Remove um exemplo aprendido. Só dono ou admin do workspace. */
export async function DELETE(_request: NextRequest, { params }: RouteProps) {
  const { id } = await params;
  return withPainel({ manage: true, action: "change the WhatsApp agents" }, (ctx, deps) => removeExample(ctx, id, deps));
}
