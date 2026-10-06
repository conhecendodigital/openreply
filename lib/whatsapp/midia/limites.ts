/**
 * Limites e modelos da leitura de mídia do cliente (áudio, foto, PDF).
 *
 * Modelos (conferidos em 06/10/2026 em developers.openai.com e na doc da
 * Anthropic; confira de novo antes de mudar):
 * - Áudio: gpt-4o-mini-transcribe (US$ 1,25 por 1M tokens de áudio, US$ 5 por
 *   1M de texto, uns US$ 0,003 por minuto), o mais barato da OpenAI que ainda
 *   é melhor que o Whisper. Se a conta não tiver ele, cai no whisper-1
 *   (US$ 0,006 por minuto). O gpt-transcribe (US$ 0,0045 por minuto) é o
 *   recomendado novo da OpenAI, mas sai 50% mais caro: fica de fora por ora.
 * - Foto: o modelo barato do mesmo provedor do agente (Claude Haiku 4.5 ou
 *   GPT-5 mini), os dois leem imagem.
 * - PDF: unpdf, sem IA (custo zero).
 */
import { MODEL_GPT_MINI, MODEL_HAIKU } from "@/lib/ai/catalog";
import type { Preco } from "@/lib/whatsapp/agentes/modelos";

export const MODELO_TRANSCRICAO = "gpt-4o-mini-transcribe";
export const MODELO_WHISPER = "whisper-1";
export const MODELO_VISAO_ANTHROPIC = MODEL_HAIKU;
export const MODELO_VISAO_OPENAI = MODEL_GPT_MINI;

/** Áudio: até 20 MB (a OpenAI aceita 25) e até 10 minutos. */
export const AUDIO_MAX_BYTES = 20 * 1024 * 1024;
export const AUDIO_MAX_SEGUNDOS = 10 * 60;
/** Foto: até 5 MB (limite da Anthropic por imagem). */
export const IMAGEM_MAX_BYTES = 5 * 1024 * 1024;
/** PDF: até 20 MB, lê as 20 primeiras páginas e guarda até 8000 caracteres. */
export const PDF_MAX_BYTES = 20 * 1024 * 1024;
export const PDF_MAX_PAGINAS = 20;
export const PDF_MAX_CARACTERES = 8000;
/** Descrição da foto guardada. */
export const DESCRICAO_MAX_CARACTERES = 1500;
/** Transcrição guardada (10 min de fala cabem folgado). */
export const TRANSCRICAO_MAX_CARACTERES = 12000;
/** Quantas mídias lê por vez (por mensagem nova), da mais nova pra mais velha. */
export const MIDIAS_POR_VEZ = 3;
/** Saída máxima da descrição da foto. */
export const VISAO_MAX_TOKENS_SAIDA = 400;
/** Pior caso de tokens de uma foto (Anthropic: ~1600 numa foto grande; OpenAI parecido). */
export const VISAO_TOKENS_IMAGEM_MAX = 1800;

/**
 * Preços dos modelos de transcrição, no formato da tabela do /admin. Entram
 * por baixo da tabela salva (a do /admin ganha quando tem o modelo).
 * whisper-1 cobra por segundo: o uso grava os segundos em tokensIn e o preço
 * é 100 por "1M" (US$ 0,0001 por segundo = US$ 0,006 por minuto).
 */
export const PRECOS_MIDIA: Record<string, Preco> = {
  [MODELO_TRANSCRICAO]: { provider: "openai", entrada: 1.25, saida: 5, cacheLeitura: 0, cacheEscrita: 0 },
  [MODELO_WHISPER]: { provider: "openai", entrada: 100, saida: 0, cacheLeitura: 0, cacheEscrita: 0 },
};

/** Tokens de áudio por segundo no gpt-4o-mini-transcribe (US$ 0,003/min ÷ US$ 1,25/1M ≈ 40/s). */
export const TOKENS_AUDIO_POR_SEGUNDO = 40;
/** Fala: ~3 tokens de texto por segundo. */
export const TOKENS_TEXTO_POR_SEGUNDO = 3;

