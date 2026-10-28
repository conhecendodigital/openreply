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
PREÇO: parcelado em 12x de R$ 10,03 ou R$ 97 à vista.
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

/**
 * Preço oficial (dono, 28/10/2026). Vale SEMPRE, mesmo que o documento de fatos salvo na tela não tenha esta linha.
 * Ordem de fala: primeiro o parcelado, depois o à vista, e só no fim da conversa.
 */
export const PRECO_OFICIAL = "PREÇO OFICIAL: 12x de R$ 10,03 no cartão (fale este primeiro) ou R$ 97 à vista (fale depois, ou se a pessoa pedir à vista/Pix).";

/**
 * Base de ferramentas (estudo de 28/10/2026, páginas oficiais lidas). O vendedor SÓ afirma o que está aqui sobre
 * Gemini, ChatGPT, Claude e NotebookLM. Fora daqui: "isso varia, abre a tela de limites/planos pra ver" ou chama o dono.
 */
export const BASE_FERRAMENTAS = `GEMINI:
- Criar vídeo no Gemini exige plano pago do Google (Google AI Plus, Pro ou Ultra). Nas páginas oficiais, o plano grátis não aparece com geração de vídeo. NUNCA prometa vídeo grátis no Gemini.
- Onde fica: no computador, gemini.google.com, abre a barra lateral e toca em "Criar vídeo". No Android, menu no canto superior esquerdo e "Vídeos".
- Não aparece pra: conta sem plano pago, menor de 18 anos, país onde o recurso não chegou, conta de trabalho ou escola sem licença. O Google avisa que recurso varia por plano, aparelho e região.
- Quanto cada plano libera por dia: o Google não publica número. Não cite número de limite. Diga pra pessoa olhar em Configurações, Limites de uso.
- Imagem no Gemini (Nano Banana) aparece em todos os planos, com limite menor no grátis.
- Preço mensal no Brasil (pode ter mudado): AI Plus R$ 24,99; AI Pro R$ 96,99. Só cite se a pessoa perguntar.
CHATGPT: limites e planos mudam toda hora e não foram confirmados. Não afirme limite, preço nem se gera vídeo. Diga que varia e pra pessoa olhar o plano dela.
CLAUDE: ótimo pra texto, roteiro, código e análise. Não gera foto nem ilustração (cria diagramas e gráficos). Pra foto e vídeo, use Gemini ou ChatGPT. Limite do grátis renova a cada 5 horas e varia com o tamanho da conversa. Preço em reais não confirmado.
NOTEBOOKLM: no grátis, até 100 cadernos e 50 fontes por caderno. Limite diário de áudio, vídeo e chat não confirmado: não cite número. Pode estar desligado em conta de trabalho ou escola.
COMANDOS DE BARRA (/comando): são atalhos da comunidade, não oficiais. Não chame de "secreto" nem "oficial", e não garanta que funcionam no plano grátis.`;

export type VendedorConfig = {
  instagramAccountId: string;
  workspaceId: string;
  enabled: boolean;
  offerFacts: string;
  socialProof: string;
  /** Lições do dono (até 2000 caracteres). Vazio = padrão (DEFAULT_LICOES). */
  licoes: string;
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
    licoes: "",
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
  if ("licoes" in body) {
    if (typeof body.licoes !== "string" || body.licoes.length > 2000) return { ok: false, error: "licoes: texto de até 2000 caracteres" };
    patch.licoes = body.licoes.trim();
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
