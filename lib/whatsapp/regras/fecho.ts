/**
 * Fecho obrigatório da recusa (pedido do Matheus, 14/10): quem está fora do
 * perfil (obra fora da região ou serviço pequeno e isolado) não recebe um
 * "obrigado pelo contato" seco. A resposta sempre fecha dizendo que a equipe vai
 * analisar o caso e, se vir necessidade, entra em contato o mais breve possível.
 * Sem prazo e sem promessa.
 */
export const FECHO_RECUSA =
  "Vamos analisar o seu caso com calma e, se a gente vir necessidade, entramos em contato com você o mais breve possível.";

/** Texto já normalizado (sem acento, minúsculo): fala em analisar/estudar E em voltar a falar. */
const ANALISA = /\b(analis\w*|estud\w*|avali\w*|olhar com calma|ver com calma)\b/;
const RETORNO = /\b(contato|retorn\w*|te chama\w*|te chamo|chamamos|te procur\w*|falamos com voce|te aviso|avisamos)\b/;

export function temFechoRecusa(textoNormalizado: string): boolean {
  return ANALISA.test(textoNormalizado) && RETORNO.test(textoNormalizado);
}
