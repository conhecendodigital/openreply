-- Aditiva e segura: coluna nova com padrão vazio (nada é apagado nem reescrito).
-- Guarda o tipo dos anexos da DM (image, video, audio, file, share, story_mention,
-- ig_reel, reel, unsupported) mesmo quando a Meta não manda URL (mídia efêmera).
-- Rollback: ALTER TABLE "public"."DirectMessage" DROP COLUMN IF EXISTS "attachmentKinds";
ALTER TABLE "public"."DirectMessage" ADD COLUMN IF NOT EXISTS "attachmentKinds" TEXT[] DEFAULT ARRAY[]::TEXT[];
