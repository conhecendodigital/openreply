"use client";

/** Quiz results (Etapa 6): visits per screen with drop-off, answers, sources and leads. */

import { useParams } from "next/navigation";
import ResultsView from "@/components/funnels/results-view";

export default function QuizResultsPage() {
  const { id } = useParams<{ id: string }>();
  return <ResultsView key={id} funnelId={id} />;
}
