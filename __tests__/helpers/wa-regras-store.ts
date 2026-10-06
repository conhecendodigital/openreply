/** StoreMemoria com os métodos opcionais das regras (exemplos, casos, ficha, estágio, memória, aviso). */
import { StoreMemoria } from "./wa-agentes-store";
import { MAX_EXEMPLOS, type ExemploAprendido } from "@/lib/whatsapp/regras/exemplos";
import type { FichaLead } from "@/lib/whatsapp/regras/ficha";
import type { Classificacao, Estagio } from "@/lib/whatsapp/regras/estagio";
import type { CasoAprendizado } from "@/lib/whatsapp/agentes/types";

export class StoreRegras extends StoreMemoria {
  exemplos: ExemploAprendido[] = [];
  casos: CasoAprendizado[] = [];
  fichas = new Map<string, FichaLead>();
  estagios: Array<{ conversationId: string; de: Estagio | null; nova: Classificacao; manual: boolean; porUserId: string | null }> = [];
  memoriaCerebro: Array<{ contactId: string; update: Record<string, unknown> }> = [];
  avisos: Array<{ sessionId: string; telefone: string; texto: string }> = [];
  private n = 0;

  async exemplosAprendidos(sessionId: string) {
    return this.exemplos.filter((e) => e.sessionId === sessionId);
  }
  async registrarExemplo(ex: ExemploAprendido) {
    if (this.exemplos.some((e) => e.sessionId === ex.sessionId && e.origemId === ex.origemId)) return;
    this.exemplos.unshift({ ...ex, id: `ex${++this.n}`, createdAt: new Date(Date.now() + this.n) });
    const doNumero = this.exemplos.filter((e) => e.sessionId === ex.sessionId);
    if (doNumero.length > MAX_EXEMPLOS) {
      const sobra = new Set(doNumero.slice(MAX_EXEMPLOS).map((e) => e.id));
      this.exemplos = this.exemplos.filter((e) => !sobra.has(e.id));
    }
  }
  async registrarCaso(c: CasoAprendizado) {
    if (this.casos.some((x) => x.sessionId === c.sessionId && x.origemId === c.origemId)) return;
    this.casos.push(c);
  }
  async salvarFicha(conversationId: string, ficha: FichaLead) {
    this.fichas.set(conversationId, ficha);
    const ctx = await this.carregarContexto(conversationId);
    if (ctx) ctx.conversation.lead = { ...(ctx.conversation.lead ?? { estagio: null, manual: false, motivo: null }), ficha };
  }
  async salvarEstagio(input: { conversationId: string; sessionId: string; de: Estagio | null; nova: Classificacao; manual: boolean; porUserId: string | null }) {
    this.estagios.push(input);
    const ctx = await this.carregarContexto(input.conversationId);
    if (ctx) {
      ctx.conversation.lead = {
        ficha: ctx.conversation.lead?.ficha ?? { campos: {}, atualizadoEm: null },
        estagio: input.nova.estagio,
        manual: input.manual,
        motivo: input.nova.motivo,
      };
    }
  }
  async gravarMemoriaContato(contactId: string, update: Record<string, unknown>) {
    this.memoriaCerebro.push({ contactId, update });
  }
  async avisarResponsavel(input: { sessionId: string; telefone: string; texto: string }) {
    this.avisos.push(input);
    return { ok: true as const };
  }
}
