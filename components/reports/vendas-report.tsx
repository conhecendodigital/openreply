"use client";

/**
 * "Vendas por origem" (28/10/2026): de qual fluxo/campanha veio cada venda da
 * Hotmart. Só leitura. Textos em português direto (tela do dono).
 */
import { useEffect, useState } from "react";
import { flowApi } from "@/components/flows/flow-shared";
import type { SalesReport } from "@/lib/reports/vendas-data";

const PERIODS = [
  { days: 1, label: "Hoje" },
  { days: 7, label: "7 dias" },
  { days: 30, label: "30 dias" },
  { days: 90, label: "90 dias" },
] as const;

const ESTADO: Record<string, string> = { paga: "Paga", reembolsada: "Reembolsada", cancelada: "Cancelada", pendente: "Pendente" };

function brl(cents: Record<string, number>): string {
  const parts = Object.entries(cents).map(([cur, v]) => {
    try {
      return new Intl.NumberFormat("pt-BR", { style: "currency", currency: cur }).format(v / 100);
    } catch {
      return `${(v / 100).toFixed(2)} ${cur}`;
    }
  });
  return parts.length ? parts.join(" + ") : "R$ 0,00";
}

export function VendasReport() {
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<SalesReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void flowApi<SalesReport>(`/api/reports/vendas?days=${days}`).then((r) => {
      if (!alive) return;
      if (r.success) {
        setData(r.data);
        setError(null);
      } else {
        setData(null);
        setError(typeof r.error === "string" ? r.error : "Não foi possível carregar.");
      }
    });
    return () => {
      alive = false;
    };
  }, [days]);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Vendas por origem</h1>
          <p className="text-xs text-muted">De qual fluxo ou campanha veio cada venda da Hotmart. Horário de Brasília.</p>
        </div>
        <div className="flex gap-1" role="group" aria-label="Período">
          {PERIODS.map((p) => (
            <button
              key={p.days}
              type="button"
              onClick={() => setDays(p.days)}
              aria-pressed={days === p.days}
              className={`rounded-lg border border-border px-3 py-1 text-xs font-semibold ${days === p.days ? "bg-surface-hover text-foreground" : "text-muted"}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="panel rounded-2xl p-4 text-sm">{error}</p>}
      {!data && !error && <p className="text-sm text-muted">Carregando...</p>}

      {data?.nenhumaCompraAindaRecebida && (
        <div className="panel space-y-1 rounded-2xl p-4 text-sm">
          <p className="font-semibold">Nenhuma compra recebida ainda.</p>
          <p>Conferir se o webhook está cadastrado na Hotmart. A URL esperada é:</p>
          <p className="break-all font-mono text-xs">{data.webhookUrl}</p>
        </div>
      )}

      {data && !data.nenhumaCompraAindaRecebida && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <div className="panel rounded-2xl p-4"><p className="text-2xl font-semibold tabular-nums">{data.totais.vendas}</p><p className="text-xs text-muted">Vendas pagas</p></div>
            <div className="panel rounded-2xl p-4"><p className="text-2xl font-semibold tabular-nums">{data.totais.reembolsos}</p><p className="text-xs text-muted">Reembolsos</p></div>
            <div className="panel rounded-2xl p-4"><p className="text-2xl font-semibold tabular-nums">{data.totais.semOrigem}</p><p className="text-xs text-muted">Sem origem</p></div>
          </div>

          {data.vendas.length === 0 && <p className="text-sm text-muted">Nenhuma compra neste período.</p>}

          {data.origens.length > 0 && (
            <section className="panel min-w-0 space-y-3 rounded-2xl p-4">
              <h2 className="text-sm font-semibold">Totais por origem</h2>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="text-xs text-muted">
                    <tr><th className="py-1 pr-3">Origem</th><th className="pr-3">Vendas</th><th className="pr-3">Reembolsos</th><th className="pr-3">Receita</th><th className="pr-3">Entraram</th><th className="pr-3">Clicaram</th><th>Conversão</th></tr>
                  </thead>
                  <tbody>
                    {data.origens.map((o) => (
                      <tr key={o.chave} className="border-t border-border align-top">
                        <td className="py-2 pr-3">
                          <p className="font-medium">{o.origem}</p>
                          {o.etiquetas.length > 0 && <p className="break-all text-[11px] text-muted">{o.tipo === "unknown" ? "etiqueta não reconhecida" : o.etiquetas.join(", ")}</p>}
                        </td>
                        <td className="pr-3 tabular-nums">{o.vendas}</td>
                        <td className="pr-3 tabular-nums">{o.reembolsos}</td>
                        <td className="pr-3 tabular-nums">{brl(o.receitaCents)}</td>
                        <td className="pr-3 tabular-nums">{o.entraram ?? "-"}</td>
                        <td className="pr-3 tabular-nums">{o.clicaram ?? "-"}</td>
                        <td className="tabular-nums">{o.conversaoEntrada === null ? "-" : `${o.conversaoEntrada}% das entradas`}{o.conversaoClique === null ? "" : `, ${o.conversaoClique}% dos cliques`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {data.vendas.length > 0 && (
            <section className="panel min-w-0 space-y-3 rounded-2xl p-4">
              <h2 className="text-sm font-semibold">Compras</h2>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="text-xs text-muted">
                    <tr><th className="py-1 pr-3">Quando</th><th className="pr-3">Produto</th><th className="pr-3">Valor</th><th className="pr-3">Situação</th><th>Origem</th></tr>
                  </thead>
                  <tbody>
                    {data.vendas.map((s) => (
                      <tr key={s.transaction} className="border-t border-border align-top">
                        <td className="py-2 pr-3 whitespace-nowrap">{s.quando}</td>
                        <td className="pr-3">{s.produto}</td>
                        <td className="pr-3 tabular-nums">{s.amountCents == null ? "-" : brl({ [(s.currency ?? "BRL").toUpperCase()]: s.amountCents })}</td>
                        <td className="pr-3">{ESTADO[s.estado] ?? s.estado}</td>
                        <td>{s.origem}{s.lado ? ` (lado ${s.lado})` : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {data.truncado && <p className="text-xs text-muted">Mostrando só as compras mais recentes do período.</p>}
            </section>
          )}
        </>
      )}
    </div>
  );
}
