-- Pixel padrão da conta e API de Conversões da Meta (CAPI). Só aditiva:
-- 1 tabela nova (MetaCapiSettings) e 5 colunas opcionais em FunnelVisit.
-- Nenhuma tabela existente perde nada, nada é apagado nem reescrito (os
-- índices parciais dos fluxos, como FlowRun_one_open_per_contact, ficam como estão).
-- O token de acesso só é guardado criptografado (accessTokenEnc).

-- CreateTable
CREATE TABLE "MetaCapiSettings" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "pixelId" TEXT,
    "accessTokenEnc" TEXT,
    "tokenLast4" TEXT,
    "testEventCode" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetaCapiSettings_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "FunnelVisit" ADD COLUMN     "adConsent" BOOLEAN,
ADD COLUMN     "clientIp" TEXT,
ADD COLUMN     "clientUserAgent" TEXT,
ADD COLUMN     "fbp" TEXT,
ADD COLUMN     "fbc" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "MetaCapiSettings_workspaceId_key" ON "MetaCapiSettings"("workspaceId");

-- AddForeignKey
ALTER TABLE "MetaCapiSettings" ADD CONSTRAINT "MetaCapiSettings_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
