"use client";

/**
 * Entrada da página pública do quiz (11/10/2026): escolhe a versão do teste
 * A/B antes de montar o player. Sem tela B, é o player de sempre, sem nada a
 * mais. Com tela B:
 * - ao vivo: a versão sai do visitorId (lib/funnels/ab.ts), que só existe no
 *   navegador; até lá aparece só o fundo do quiz (um instante), pra a capa A
 *   nunca piscar antes da B;
 * - prévia (?preview=1): mostra a A; com &ab=b mostra a B.
 * O player recebe as telas já trocadas e não sabe que existe teste.
 */

import { useMemo, useSyncExternalStore } from "react";
import FunnelPlayer, { type FunnelPlayerProps } from "@/components/funnels/funnel-player";
import { getVisitorId } from "@/components/funnels/player-tracking";
import { abVariantFor, applyAbVariant, hasAbTest, type AbVariant } from "@/lib/funnels/ab";

const subscribeNothing = () => () => {};

export default function QuizEntry(props: FunnelPlayerProps & { abPreview?: AbVariant | null }) {
  const { abPreview, ...playerProps } = props;
  const { funnel, mode } = playerProps;
  const mounted = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const withTest = hasAbTest(funnel.steps);

  const variant: AbVariant | null = !withTest
    ? null
    : mode === "live"
      ? mounted
        ? abVariantFor(getVisitorId(funnel.id), funnel.settings.abPercentB)
        : null
      : abPreview ?? "A";

  const shown = useMemo(
    () => (withTest ? { ...funnel, steps: applyAbVariant(funnel.steps, variant) } : funnel),
    [withTest, funnel, variant]
  );

  if (withTest && mode === "live" && !variant) {
    return <div className="min-h-dvh" style={{ background: funnel.settings.theme.background }} aria-hidden="true" />;
  }
  return <FunnelPlayer key={variant ?? "sem-teste"} {...playerProps} funnel={shown} />;
}
