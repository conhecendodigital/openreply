"use client";

/** Flow builder (Etapa 3): canvas, side panel, checks, preview and report. */

import { useParams } from "next/navigation";
import FlowEditor from "@/components/flows/flow-editor";

export default function FlowPage() {
  const { id } = useParams<{ id: string }>();
  return <FlowEditor key={id} flowId={id} />;
}
