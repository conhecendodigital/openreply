/**
 * Vendedor automático do Instagram (28/10/2026): configuração.
 *
 * DESLIGADO por padrão, por conta. Só o dono liga, pela tela (rota humanOnly).
 * VENDEDOR_IG_DISABLED=1 no ambiente desliga tudo, de emergência, sem mexer no banco.
 */

export const LINK_CHECKOUT = "https://pay.hotmart.com/A107839499R?off=hzpjuuco&sck=vendedor-ig";
export const LINK_PAGINA = "https://chatsemfrescura.cloudmatheus.com.br/?utm_source=instagram&utm_medium=dm&utm_campaign=vendedor-ig";

/**
 * Documento de fatos da oferta. O dono edita na tela; o vendedor só afirma o que estiver aqui.
 * Preço confirmado pelo dono em 28/10/2026 (R$ 97). Sem prova social aqui de propósito.
 */
export const DEFAULT_OFFER_FACTS = `PRODUTO: Chat Sem Frescura.
PREÇO: R$ 97.
O QUE A PESSOA APRENDE E RECEBE:
- Usar ChatGPT, Claude, NotebookLM e Gemini.
- Criar vídeo e criar foto com IA.
- Criar e usar habilidades (a habilidade pronta que faz o trabalho pesado) no dia a dia de qualquer negócio, produto ou serviço.
- O Comandos Pro: a biblioteca de Comandos, atualizada sempre.
- Aulas e um grupo com o Matheus no WhatsApp.
LINKS (use exatamente estes, sem mudar nada):
- Comprar direto: ${LINK_CHECKOUT}
- Página com os detalhes: ${LINK_PAGINA}
VOCABULÁRIO: sempre "Comando" (nunca "prompt") e "habilidade" (nunca "skill"). Nunca dizer que a IA "faz por você": a IA é apoio, a pessoa aplica.`;

export type VendedorConfig = {
  instagramAccountId: string;
  workspaceId: string;
  enabled: boolean;
  offerFacts: string;
  socialProof: string;
  minGapSeconds: number;
  maxPerHour: number;
  maxPerDay: number;
  maxPerPersonDay: number;
  replyDelayMinSec: number;
  replyDelayMaxSec: number;
  quietStart: string | null;
  quietEnd: string | null;
};

export function defaultConfig(instagramAccountId: string, workspaceId: string): VendedorConfig {
  return {
    instagramAccountId,
    workspaceId,
    enabled: false,
    offerFacts: "",
    socialProof: "",
    minGapSeconds: 5,
    maxPerHour: 12,
    maxPerDay: 60,
    maxPerPersonDay: 8,
    replyDelayMinSec: 20,
    replyDelayMaxSec: 90,
    quietStart: "23:00",
    quietEnd: "07:00",
  };
}

/** Interruptor de emergência por ambiente: VENDEDOR_IG_DISABLED=1 (ou "true"). */
export function vendedorDesligadoPorEnv(env: Record<string, string | undefined> = process.env): boolean {
  const v = (env.VENDEDOR_IG_DISABLED ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "sim";
}

/** Fatos que valem: o documento do dono, ou o padrão se ele ainda não escreveu nada. */
export function fatosDaOferta(c: Pick<VendedorConfig, "offerFacts">): string {
  return c.offerFacts.trim() ? c.offerFacts : DEFAULT_OFFER_FACTS;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function inteiro(v: unknown, min: number, max: number): number | null {
  const n = typeof v === "number" ? v : Number.NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

export type ConfigPatch = Partial<Omit<VendedorConfig, "instagramAccountId" | "workspaceId">>;

/** Valida o que o dono mandou na tela. Devolve só os campos válidos ou o 1º erro. */
export function validarPatch(body: Record<string, unknown>): { ok: true; patch: ConfigPatch } | { ok: false; error: string } {
  const patch: ConfigPatch = {};
  if ("enabled" in body) {
    if (typeof body.enabled !== "boolean") return { ok: false, error: "enabled deve ser verdadeiro ou falso" };
    patch.enabled = body.enabled;
  }
  for (const k of ["offerFacts", "socialProof"] as const) {
    if (k in body) {
      if (typeof body[k] !== "string" || (body[k] as string).length > 6000) return { ok: false, error: `${k}: texto de até 6000 caracteres` };
      patch[k] = (body[k] as string).trim();
    }
  }
  const nums: [keyof ConfigPatch, number, number][] = [
    ["minGapSeconds", 5, 600],
    ["maxPerHour", 1, 200],
    ["maxPerDay", 1, 1000],
    ["maxPerPersonDay", 1, 50],
    ["replyDelayMinSec", 5, 600],
    ["replyDelayMaxSec", 5, 900],
  ];
  for (const [k, min, max] of nums) {
    if (k in body) {
      const n = inteiro(body[k], min, max);
      if (n === null) return { ok: false, error: `${k}: número inteiro de ${min} a ${max}` };
      (patch as Record<string, unknown>)[k] = n;
    }
  }
  for (const k of ["quietStart", "quietEnd"] as const) {
    if (k in body) {
      const v = body[k];
      if (v === null || v === "") patch[k] = null;
      else if (typeof v === "string" && HHMM.test(v)) patch[k] = v;
      else return { ok: false, error: `${k}: horário HH:MM ou vazio` };
    }
  }
  if (patch.replyDelayMinSec !== undefined && patch.replyDelayMaxSec !== undefined && patch.replyDelayMinSec > patch.replyDelayMaxSec) {
    return { ok: false, error: "a espera mínima não pode ser maior que a máxima" };
  }
  return { ok: true, patch };
}
