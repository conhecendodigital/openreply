/**
 * MCP: resgatar_comentarios. Chama /api/resgate pela chave; a rota confere
 * workspace e papel e aplica o interruptor (RESGATE_DISABLED=1 /
 * MCP_FLUXOS_DISABLED=1). Arquivo próprio pra lib/mcp/server.ts só importar e
 * espalhar RESGATE_TOOLS (sem ciclo de import).
 */
import type { InternalCall } from "@/lib/mcp/server";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
export type ResgateTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (args: Record<string, unknown>, call: InternalCall) => Promise<ToolResult>;
};

const text = (value: unknown, isError = false): ToolResult => ({
  content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
  ...(isError ? { isError: true } : {}),
});

export const RESGATE_TOOLS: ResgateTool[] = [
  {
    name: "resgatar_comentarios",
    description:
      "Manda a resposta privada (DM) a quem comentou num post e NÃO recebeu (palavra escrita errada, campanha desligada, falha). Lê os comentários do post pela Meta e tira: comentários da própria conta, respostas dentro de comentário, comentários com mais de 7 dias (a Meta só deixa responder em até 7 dias e UMA vez por comentário; contados em 'vencidos'), quem já recebeu DM deste fluxo/campanha (por comentário e por pessoa: 1 mensagem por pessoa), quem pediu pra parar, quem um humano assumiu e comentário escondido pela moderação. O que sobra entra no MESMO caminho do gatilho (fluxo: o mesmo início de fluxo do webhook; campanha: o mesmo process-comment), com o texto do próprio fluxo. dryRun é true por padrão: só conta e mostra amostra, não envia nada. Com dryRun=false cria uma execução em segundo plano, devagar (1 a cada 2-4 s, teto de 400 por hora, abaixo dos 750/h da Meta), que pausa sozinha se a Meta devolver limite. Nunca apaga nem esconde comentário. O fluxo/campanha precisa estar LIGADO. Use só quando o dono da conta pedir. Passos: 1) rode com dryRun (padrão) e mostre as contagens ao dono; 2) com o ok dele, rode com dryRun=false; 3) acompanhe com execucaoId. Para pegar quem errou a palavra, use tolerarGrafia=true e/ou palavrasExtras (só para fluxo) e confira a amostra 'casouPor' antes. Com 'acao' (pausar, retomar, cancelar) + execucaoId controla uma execução; só com execucaoId lê o andamento do banco (enviados, na fila, falhas por motivo). Interruptor de emergência do servidor: RESGATE_DISABLED=1 ou MCP_FLUXOS_DISABLED=1.",
    inputSchema: {
      type: "object",
      properties: {
        post: { type: "string", description: "Link do Reel/post (ex.: https://www.instagram.com/reel/De0mG9WO7kT/) ou id da mídia. Opcional se o fluxo/campanha já está preso a um post." },
        fluxoId: { type: "string", description: "ID do fluxo (listar_fluxos). Use este OU automacaoId." },
        automacaoId: { type: "string", description: "ID da campanha (listar_automacoes). Use este OU fluxoId." },
        dryRun: { type: "boolean", description: "Padrão true: só conta e amostra. false = cria a execução e envia em lote lento." },
        limite: { type: "integer", description: "Máximo de pessoas desta execução (opcional)." },
        desde: { type: "string", description: "Só comentários a partir desta data ISO com fuso (opcional)." },
        tolerarGrafia: { type: "boolean", description: "Só fluxo/dryRun: aceita palavra-chave com 1-2 letras trocadas (Gmani, Geminni). Confira a amostra." },
        palavrasExtras: { type: "array", items: { type: "string" }, description: "Só fluxo: variações a aceitar além das palavras do gatilho." },
        intervaloMinSegundos: { type: "number", description: "Intervalo mínimo entre envios (padrão 2, piso 1,5)." },
        intervaloMaxSegundos: { type: "number", description: "Intervalo máximo entre envios (padrão 4)." },
        tetoPorHora: { type: "integer", description: "Teto de envios por hora desta execução (padrão 400, máximo 600)." },
        execucaoId: { type: "string", description: "Com ele sozinho: lê o andamento. Com 'acao': controla a execução." },
        acao: { type: "string", enum: ["pausar", "retomar", "cancelar"], description: "Controla a execução de execucaoId." },
      },
    },
    async run(args, call) {
      const execucaoId = typeof args.execucaoId === "string" ? args.execucaoId.trim() : "";
      if (execucaoId && typeof args.acao !== "string") {
        const { status, json } = await call("GET", `/api/resgate?execucaoId=${encodeURIComponent(execucaoId)}`);
        const env = (json ?? {}) as { success?: boolean; data?: unknown; error?: unknown };
        if (status >= 400 || env.success === false) return text({ status, error: env.error ?? "Request failed" }, true);
        return text(env.data);
      }
      const body: Record<string, unknown> = {};
      for (const k of [
        "post", "fluxoId", "automacaoId", "dryRun", "limite", "desde", "tolerarGrafia", "palavrasExtras",
        "intervaloMinSegundos", "intervaloMaxSegundos", "tetoPorHora", "execucaoId", "acao",
      ]) {
        if (args[k] !== undefined) body[k] = args[k];
      }
      const { status, json } = await call("POST", "/api/resgate", body);
      const env = (json ?? {}) as { success?: boolean; data?: unknown; error?: unknown; details?: unknown };
      if (status >= 400 || env.success === false) return text({ status, error: env.error ?? "Request failed", details: env.details }, true);
      return text(env.data);
    },
  },
];
