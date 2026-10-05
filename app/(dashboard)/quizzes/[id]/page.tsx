"use client";

/** Quiz editor (Etapa 6): screens, blocks, properties and the live phone preview. */

import { useParams } from "next/navigation";
import FunnelEditor from "@/components/funnels/funnel-editor";

export default function QuizEditorPage() {
  const { id } = useParams<{ id: string }>();
  return <FunnelEditor key={id} funnelId={id} />;
}
