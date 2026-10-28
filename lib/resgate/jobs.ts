/**
 * Job do "Resgatar comentários" na fila "dm-processing". Fora de
 * lib/queue/client.ts de propósito (os testes mockam aquele módulo com uma
 * lista fixa). O job NÃO leva "commentId": um worker antigo que não conhece o
 * nome pula (runJob) em vez de tratar como comentário e responder.
 * Suba o worker antes do web.
 */
export const RESGATE_STEP_JOB_NAME = "resgate-step";

export interface ResgateStepJob {
  /** instagramId da conta (como todo job; noteMetaError). */
  instagramAccountId: string;
  runId: string;
}

export const resgateJobId = (runId: string, tag: string | number) => `rgstep_${runId}_${tag}`;
