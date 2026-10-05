-- Etapa 6 (quiz): arquivos enviados pelo editor pro armazenamento próprio.
-- Só aditiva: 1 tabela nova (FunnelMedia). Nenhuma tabela existente muda,
-- nada é apagado nem reescrito.

-- CreateTable
CREATE TABLE "FunnelMedia" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "funnelId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "name" TEXT,
    "createdBy" TEXT,
    "uploadedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FunnelMedia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FunnelMedia_key_key" ON "FunnelMedia"("key");

-- CreateIndex
CREATE INDEX "FunnelMedia_workspaceId_funnelId_createdAt_idx" ON "FunnelMedia"("workspaceId", "funnelId", "createdAt");

-- AddForeignKey
ALTER TABLE "FunnelMedia" ADD CONSTRAINT "FunnelMedia_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FunnelMedia" ADD CONSTRAINT "FunnelMedia_funnelId_fkey" FOREIGN KEY ("funnelId") REFERENCES "Funnel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
