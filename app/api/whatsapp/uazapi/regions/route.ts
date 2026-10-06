import { NextRequest } from "next/server";
import { withPainel } from "@/lib/whatsapp/painel-http";
import { uazapiRegions } from "@/lib/whatsapp/painel-uazapi";

export const dynamic = "force-dynamic";

/** Países e cidades do proxy da uazapi (?country=br&search=camp). */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  return withPainel({ action: "read WhatsApp" }, (_ctx, deps) =>
    uazapiRegions({ country: params.get("country") ?? undefined, search: params.get("search") ?? undefined }, deps)
  );
}
