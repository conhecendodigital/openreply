/**
 * Manda uma lista de partes como DMs seguidas, no ritmo de gente (28/10/2026):
 * a 1ª sai na hora, as outras depois de 1 a 4 s com "digitando" ligado nesse
 * tempo (sender_action typing_on, confirmado na doc da Meta; falha nele é ignorada).
 * Uma de cada vez, nunca em paralelo. Para na primeira falha e devolve o que já saiu.
 * Usado pela aprovação de rascunho e pelo modo automático do vendedor.
 */
import { planejarRitmoInstagram, type Sorteio } from "@/lib/messaging/bolhas";

export type SendPartsResult = { mids: string[]; lastMid: string | null; failure: { index: number; error: unknown } | null };

export async function sendDmParts(input: {
  parts: string[];
  send: (text: string, index: number) => Promise<{ message_id?: string } | null | undefined>;
  typing?: () => Promise<unknown>;
  sleep: (ms: number) => Promise<void>;
  rng?: Sorteio;
}): Promise<SendPartsResult> {
  const plan = planejarRitmoInstagram(input.parts, input.rng);
  const mids: string[] = [];
  let lastMid: string | null = null;
  for (let i = 0; i < plan.length; i++) {
    try {
      if (i > 0) {
        if (input.typing) await input.typing().catch(() => undefined);
        await input.sleep(plan[i].esperaMs);
      }
      const result = await input.send(plan[i].texto, i);
      const mid = result?.message_id ?? null;
      if (mid) mids.push(mid);
      lastMid = mid ?? lastMid;
    } catch (error) {
      return { mids, lastMid, failure: { index: i, error } };
    }
  }
  return { mids, lastMid, failure: null };
}
