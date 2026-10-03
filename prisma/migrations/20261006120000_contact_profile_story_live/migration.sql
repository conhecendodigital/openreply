-- Usuários desconhecidos (perfil pela API) + gatilhos de story e live.
-- Só aditiva: toda coluna nova tem default ou é opcional. Campanhas existentes
-- continuam COMMENT (o default), sem mudar nada no que já roda.

-- CreateEnum
CREATE TYPE "AutomationTrigger" AS ENUM ('COMMENT', 'DM', 'STORY_REPLY', 'STORY_MENTION', 'LIVE_COMMENT');

-- AlterTable
ALTER TABLE "Automation" ADD COLUMN     "trigger" "AutomationTrigger" NOT NULL DEFAULT 'COMMENT',
ADD COLUMN     "storyId" TEXT,
ADD COLUMN     "storyUrl" TEXT;

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "profilePicUrl" TEXT,
ADD COLUMN     "profileFetchedAt" TIMESTAMP(3),
ADD COLUMN     "profileStatus" TEXT,
ADD COLUMN     "profileAttempts" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "DirectMessage" ADD COLUMN     "storyKind" TEXT,
ADD COLUMN     "storyId" TEXT;

-- CreateIndex
CREATE INDEX "Automation_instagramAccountId_trigger_isActive_idx" ON "Automation"("instagramAccountId", "trigger", "isActive");
