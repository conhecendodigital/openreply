"use client";

/** One broadcast (Etapa 5): the draft editor and send step, or its history. */

import { useParams } from "next/navigation";
import { BroadcastScreen } from "@/components/broadcast-ui";

export default function BroadcastPage() {
  const { id } = useParams<{ id: string }>();
  return <BroadcastScreen id={id} />;
}
