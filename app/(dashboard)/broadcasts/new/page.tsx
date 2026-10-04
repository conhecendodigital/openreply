"use client";

/** New broadcast (Etapa 5): always saved as a draft; sending is the next step. */

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useT } from "@/components/lang-provider";
import { BroadcastEditor } from "@/components/broadcast-ui";

function NewBroadcast() {
  const params = useSearchParams();
  return <BroadcastEditor broadcast={null} initialSegmentId={params.get("segment")} />;
}

export default function NewBroadcastPage() {
  const t = useT();
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="space-y-1">
        <Link href="/broadcasts" className="text-sm text-muted hover:text-foreground">
          {t("← Broadcasts")}
        </Link>
        <h2 className="text-xl font-semibold">{t("New broadcast")}</h2>
      </div>
      {/* useSearchParams in a prerendered client page needs a Suspense boundary. */}
      <Suspense fallback={<div className="panel h-64 animate-pulse rounded-2xl" />}>
        <NewBroadcast />
      </Suspense>
    </div>
  );
}
