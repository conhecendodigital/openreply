-- Canais: desconectar desliga o canal sem apagar nada.
-- Só aditiva: toda coluna nova tem default ou é opcional.

-- CreateEnum
CREATE TYPE "InstagramAccountStatus" AS ENUM ('ACTIVE', 'NEEDS_RECONNECT', 'DISCONNECTED');

-- AlterTable
ALTER TABLE "InstagramAccount" ADD COLUMN     "status" "InstagramAccountStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "disconnectedAt" TIMESTAMP(3),
ADD COLUMN     "disconnectedBy" TEXT,
ADD COLUMN     "reconnectedAt" TIMESTAMP(3),
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "lastErrorAt" TIMESTAMP(3),
ADD COLUMN     "profilePictureUrl" TEXT,
ADD COLUMN     "webhookFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "lastWebhookAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "InstagramAccount_workspaceId_status_idx" ON "InstagramAccount"("workspaceId", "status");

-- Data: an account without a token cannot send; it has to be connected again.
UPDATE "InstagramAccount" SET "status" = 'NEEDS_RECONNECT' WHERE "accessToken" = '';
