-- Aditiva e segura: coluna nova com padrão vazio (nada é apagado nem reescrito).
ALTER TABLE "public"."InstagramAccount" ADD COLUMN IF NOT EXISTS "grantedScopes" TEXT[] DEFAULT ARRAY[]::TEXT[];
