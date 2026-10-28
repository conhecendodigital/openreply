/**
 * MCP: vendas_por_origem (somente leitura). Chama /api/reports/vendas pela
 * chave; a rota confere workspace e papel. Arquivo próprio pra lib/mcp/server.ts
 * só importar e espalhar VENDAS_TOOLS (sem ciclo de import).
 */
import type { InternalCall } from "@/lib/mcp/server";
import type { SalesReport } from "@/lib/reports/vendas-data";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
export type VendasTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (args: Record<string, unknown>, call: InternalCall) => Promise<ToolResult>;
};

const text = (value: unknown, isError = false): ToolResult => ({
  content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
  ...(isError ? { isError: true } : {}),
});

const money = (cents: Record<string, number>) =>
  Object.fromEntries(Object.entries(cents).map(([cur, v]) => [cur, Number((v / 100).toFixed(2))]));

export const VENDAS_TOOLS: VendasTool[] = [
  {
    name: "vendas_por_origem",
    description:
      "Vendas da Hotmart agrupadas por origem (fluxo, campanha, disparo, quiz ou etiqueta crua sck/utm; compra sem etiqueta aparece como 'Sem origem'). Mostra cada venda (data e hora de Brasília com dia da semana, produto, valor, paga/reembolsada/cancelada) e os totais por origem com entraram, clicaram e % de conversão quando o sistema conta isso. Só leitura, sem e-mail de comprador. Se não chegou nenhuma compra, diz pra conferir o webhook na Hotmart.",
    inputSchema: {
      type: "object",
      properties: {
        dias: { type: "integer", enum: [1, 7, 30, 90], description: "Período (1 = hoje; padrão 30)" },
        origem: { type: "string", description: "Filtrar por nome do fluxo/campanha ou parte da etiqueta (opcional)" },
      },
    },
    async run(args, call) {
      const q = new URLSearchParams();
      if (typeof args.dias === "number") q.set("days", String(args.dias));
      if (typeof args.origem === "string" && args.origem.trim()) q.set("origem", args.origem.trim().slice(0, 120));
      const qs = q.toString();
      const { status, json } = await call("GET", `/api/reports/vendas${qs ? `?${qs}` : ""}`);
      const env = (json ?? {}) as { success?: boolean; data?: SalesReport; error?: unknown };
      if (status >= 400 || env.success === false || !env.data) {
        return text({ status, error: env.error ?? "Request failed" }, true);
      }
      const r = env.data;
      return text({
        dias: r.dias,
        fuso: r.fuso,
        aviso: r.aviso,
        webhookUrl: r.nenhumaCompraAindaRecebida ? r.webhookUrl : undefined,
        totais: { vendasPagas: r.totais.vendas, reembolsos: r.totais.reembolsos, semOrigem: r.totais.semOrigem },
        porOrigem: r.origens.map((o) => ({
          origem: o.origem,
          tipo: o.tipo,
          etiquetas: o.etiquetas,
          vendasPagas: o.vendas,
          reembolsos: o.reembolsos,
          canceladas: o.canceladas,
          receita: money(o.receitaCents),
          entraram: o.entraram,
          clicaram: o.clicaram,
          conversaoSobreEntradasPct: o.conversaoEntrada,
          conversaoSobreCliquesPct: o.conversaoClique,
        })),
        vendas: r.vendas.map((s) => ({
          quando: s.quando,
          produto: s.produto,
          valor: s.amountCents == null ? null : Number((s.amountCents / 100).toFixed(2)),
          moeda: s.currency,
          estado: s.estado,
          origem: s.origem,
          etiqueta: s.etiqueta,
          lado: s.lado,
        })),
        truncado: r.truncado || undefined,
      });
    },
  },
];
