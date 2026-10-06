/** AgentStore em memória pros testes do motor de agentes do WhatsApp. */
import type {
  AgenteConfig,
  AgentRunRecord,
  AgentStore,
  AiCredentialRecord,
  ConversaContexto,
  EnvioPlanejado,
  GastoDia,
  MemoriaContato,
} from "@/lib/whatsapp/agentes/types";

export class StoreMemoria implements AgentStore {
  contextos = new Map<string, ConversaContexto>();
  configs: AgenteConfig[] = [];
  credenciais: AiCredentialRecord[] = [];
  runs = new Map<string, AgentRunRecord>();
  envios: Array<{ id: string; runId: string; conversationId: string; envios: EnvioPlanejado[]; cancelado: boolean }> = [];
  memorias = new Map<string, MemoriaContato>();
  /** Gasto extra simulado (além dos runs), por chave "owner:x", "ws:x" ou "session:x". */
  gastoExtra = new Map<string, GastoDia>();
  private seq = 0;

  async carregarContexto(id: string) {
    return this.contextos.get(id) ?? null;
  }
  async configAgentes() {
    return this.configs;
  }
  async credencialAtiva(ownerUserId: string, provider: string) {
    return this.credenciais.find((c) => c.ownerUserId === ownerUserId && c.provider === provider && !c.revokedAt) ?? null;
  }
  async salvarCredencial(rec: Omit<AiCredentialRecord, "id" | "createdAt" | "revokedAt">) {
    const full: AiCredentialRecord = { ...rec, id: `cred${++this.seq}`, createdAt: new Date(), revokedAt: null };
    this.credenciais.push(full);
    return full;
  }
  async revogarCredencial(ownerUserId: string, id: string, now: Date) {
    const c = this.credenciais.find((x) => x.id === id && x.ownerUserId === ownerUserId);
    if (c) c.revokedAt = now;
  }
  async listarCredenciais(ownerUserId: string) {
    return this.credenciais.filter((c) => c.ownerUserId === ownerUserId);
  }
  async gastoDoDia(escopo: { ownerUserId: string } | { workspaceId: string } | { sessionId: string }, desde: Date): Promise<GastoDia> {
    const chave =
      "ownerUserId" in escopo ? `owner:${escopo.ownerUserId}` : "workspaceId" in escopo ? `ws:${escopo.workspaceId}` : `session:${escopo.sessionId}`;
    const extra = this.gastoExtra.get(chave) ?? { custoUsdMicro: 0, respostas: 0, autoEnvios: 0 };
    const doEscopo = [...this.runs.values()].filter(
      (r) =>
        r.createdAt >= desde &&
        ("ownerUserId" in escopo
          ? r.ownerUserId === escopo.ownerUserId
          : "workspaceId" in escopo
            ? r.workspaceId === escopo.workspaceId
            : r.sessionId === escopo.sessionId)
    );
    return {
      custoUsdMicro: extra.custoUsdMicro + doEscopo.reduce((s, r) => s + r.custoUsdMicro, 0),
      respostas: extra.respostas + doEscopo.filter((r) => r.model).length,
      autoEnvios: extra.autoEnvios + doEscopo.filter((r) => r.status === "scheduled" && !r.approvedBy).length,
    };
  }
  async registrarRun(run: AgentRunRecord) {
    const id = `run${++this.seq}`;
    this.runs.set(id, { ...run, id });
    return id;
  }
  async atualizarRun(id: string, patch: Partial<AgentRunRecord>) {
    const r = this.runs.get(id);
    if (r) this.runs.set(id, { ...r, ...patch });
  }
  async buscarRun(id: string) {
    return this.runs.get(id) ?? null;
  }
  async runsPendentes(conversationId: string) {
    return [...this.runs.values()].filter((r) => r.conversationId === conversationId && (r.status === "draft" || r.status === "scheduled"));
  }
  async agendarEnvio(input: { runId: string; conversationId: string; sessionId: string; envios: EnvioPlanejado[] }) {
    const id = `job${++this.seq}`;
    this.envios.push({ id, runId: input.runId, conversationId: input.conversationId, envios: input.envios, cancelado: false });
    return id;
  }
  async cancelarEnvios(conversationId: string) {
    let n = 0;
    for (const e of this.envios) {
      if (e.conversationId === conversationId && !e.cancelado) {
        e.cancelado = true;
        n++;
      }
    }
    return n;
  }
  async definirTakeover(conversationId: string, ate: Date | null) {
    const c = this.contextos.get(conversationId);
    if (c) c.conversation.humanTakeoverUntil = ate;
  }
  async lerMemoria(contactId: string) {
    return this.memorias.get(contactId) ?? null;
  }
  async salvarMemoria(contactId: string, _owner: string, m: MemoriaContato) {
    this.memorias.set(contactId, m);
  }
}
